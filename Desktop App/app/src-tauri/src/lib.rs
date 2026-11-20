//! Native side of the recorder. It does the two things a web page cannot on macOS: capture audio (including the
//! system audio of a telehealth call) and transcribe it locally, in this process, with whisper.cpp.
//!
//! PHI rules (desktop spec SEC-1): no patient name, transcript or note text is ever logged. Error messages name the
//! kind of failure, never the content. No audio is ever written to disk. The only network traffic is to the practice
//! app (https, or http to localhost) and Google's sign-in.
//!
//! The recorder holds nothing of its own: it pulls the day's visits from the practice app, records, transcribes here,
//! saves the transcript in an encrypted on-disk queue, and pushes the text to the practice app (where a cloud model
//! writes the note). The queue folder is shredded only after the server confirms the upload.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub mod capture;
pub mod google;
mod updater;
mod model;
mod journal;
mod diarize;
pub mod keystore;
pub mod queue;
pub mod transcribe;

use serde::{Deserialize, Serialize};
use tauri::Manager;

// ----------------------------------------------------------------------------- paths and settings

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
}

fn support_dir() -> PathBuf {
    let dir = match std::env::var("PRACTICE_APP_DIR") {
        Ok(d) => PathBuf::from(d),
        // The staging TEST build keeps everything (queue, settings, key) apart from the real app.
        Err(_) => home().join(if cfg!(feature = "staging-test") { "Library/Application Support/PracticeNotesStagingTest" } else { "Library/Application Support/PracticeNotes" }),
    };
    let _ = fs::create_dir_all(&dir);
    dir
}

fn settings_path() -> PathBuf {
    support_dir().join("settings.json")
}

/// The servers this build can talk to. There is deliberately no free-text address. The released app talks to
/// PRODUCTION ONLY (Sohail, 2026-11-18); staging and localhost exist only in the separate "Staging TEST" build
/// (`--features staging-test`), which has its own bundle id, Keychain item and data folder.
#[cfg(not(feature = "staging-test"))]
pub const ENVIRONMENTS: [(&str, &str); 1] = [
    ("production", "https://practice-mgmt-802176721153.us-east4.run.app"),
];
#[cfg(feature = "staging-test")]
pub const ENVIRONMENTS: [(&str, &str); 2] = [
    ("staging", "https://practice-mgmt-321509350517.us-east4.run.app"),
    ("localhost", "http://localhost:3000"),
];
pub const DEFAULT_ENV: &str = ENVIRONMENTS[0].0;

pub fn env_url(env: &str) -> Result<&'static str, String> {
    ENVIRONMENTS.iter().find(|(k, _)| *k == env).map(|(_, u)| *u).ok_or_else(|| "unknown environment".to_string())
}

/// What the Setup screen configures. Tokens are not here: they live in the Keychain, per environment.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub environment: String,
    /// Optional folder where a plain-text copy of each transcript is written after the upload is confirmed. Off
    /// (None) by default. That copy is patient information on this Mac, outside the encrypted queue.
    pub transcript_copy_dir: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { environment: DEFAULT_ENV.into(), transcript_copy_dir: None }
    }
}

/// Plaintext tokens an older version left in settings.json.
struct Legacy {
    env: String,
    access: String,
    refresh: String,
}

/// Reads a settings file's JSON, including the old shape (practice_url, access_token, refresh_token, whisper_model).
/// Returns the settings, any legacy tokens to move into the Keychain, and whether the file needs rewriting.
fn parse_settings(v: &serde_json::Value) -> (Settings, Option<Legacy>, bool) {
    let text = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let url = text("practice_url");
    let url_env = ENVIRONMENTS
        .iter()
        .find(|(_, u)| !url.is_empty() && u.trim_end_matches('/') == url.trim_end_matches('/'))
        .map(|(k, _)| k.to_string());
    let environment = {
        let e = text("environment");
        if env_url(&e).is_ok() { e } else { url_env.clone().unwrap_or_else(|| DEFAULT_ENV.into()) }
    };
    let transcript_copy_dir = v.get("transcript_copy_dir").and_then(|x| x.as_str()).filter(|d| !d.is_empty()).map(String::from);
    let (access, refresh) = (text("access_token"), text("refresh_token"));
    let legacy = match (&url_env, access.is_empty()) {
        (Some(env), false) => Some(Legacy { env: env.clone(), access: access.clone(), refresh: refresh.clone() }),
        _ => None,
    };
    let dirty = ["practice_url", "access_token", "refresh_token", "whisper_model"].iter().any(|k| v.get(*k).is_some());
    (Settings { environment, transcript_copy_dir }, legacy, dirty)
}

pub fn load_settings() -> Settings {
    let Some(v) = fs::read_to_string(settings_path()).ok().and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()) else {
        return Settings::default();
    };
    let (settings, legacy, dirty) = parse_settings(&v);
    if dirty {
        // Move any plaintext token into the Keychain, then scrub the file. If the Keychain write fails the file is
        // left alone so the sign-in is not lost, but the failure is silent: the user can sign in again.
        let moved = match legacy {
            Some(l) if keystore::load_tokens(&l.env).is_none() => {
                keystore::store_tokens(&l.env, &keystore::Tokens { access: l.access, refresh: l.refresh }).is_ok()
            }
            _ => true,
        };
        if moved {
            let _ = store_settings(&settings);
        }
    }
    settings
}

fn store_settings(s: &Settings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(s).map_err(|_| "could not prepare the settings".to_string())?;
    fs::write(settings_path(), text).map_err(|_| "could not save the settings".to_string())
}

// ----------------------------------------------------------------------------- safe paths

/// A path component must be a plain name: no separators, no "..", no control characters, not hidden.
pub fn safe_component(name: &str) -> Result<&str, String> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || name.chars().any(|c| c == '/' || c == '\\' || c == ':' || c.is_control());
    if bad { Err("invalid name".into()) } else { Ok(name) }
}

#[cfg(test)]
fn unique(prefix: &str) -> String {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{prefix}-{}-{t}", std::process::id())
}

/// Overwrites a file with zeros, then removes it. Best effort: an SSD may keep old blocks, which is why the notes
/// folder should sit on a FileVault disk (desktop spec SEC-4).
#[allow(dead_code)]
fn shred(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        if let Ok(mut f) = fs::OpenOptions::new().write(true).open(path) {
            let zeros = vec![0u8; 64 * 1024];
            let mut left = meta.len();
            while left > 0 {
                let n = left.min(zeros.len() as u64) as usize;
                if f.write_all(&zeros[..n]).is_err() { break; }
                left -= n as u64;
            }
            let _ = f.sync_all();
        }
    }
    let _ = fs::remove_file(path);
}

// ----------------------------------------------------------------------------- the transcription model

/// Where the Whisper model may be, best first: the kept folder (survives updates), the bundled resource (old builds),
/// then the spike's folder used during development.
fn model_candidates(resource: Option<PathBuf>) -> Vec<PathBuf> {
    let lib = home().join("Library/Application Support");
    let mut v = vec![support_dir().join("models").join(model::NAME)];
    if let Some(r) = resource {
        v.push(r);
    }
    v.push(lib.join("PracticeNotesSpike/models").join(model::NAME));
    v
}

/// The first candidate that is the right size. A partial or damaged file is ignored, so it shows as missing.
fn find_model(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource = app.path().resolve("models/ggml-small.en.bin", tauri::path::BaseDirectory::Resource).ok();
    let found = model_candidates(resource).into_iter().find(|p| model::is_valid(p))?;
    // A model that only exists inside the app bundle would vanish with the next update: copy it to the kept folder once.
    let kept = support_dir().join("models");
    if !found.starts_with(&kept) {
        static ADOPTING: std::sync::Once = std::sync::Once::new();
        let src = found.clone();
        ADOPTING.call_once(move || { std::thread::spawn(move || { let _ = model::adopt(&src, &kept); }); });
    }
    Some(found)
}

#[tauri::command]
fn model_download() {
    model::start(support_dir().join("models"));
}

#[tauri::command]
fn model_download_status() -> model::Progress {
    model::PROGRESS.lock().map(|p| p.clone()).unwrap_or_default()
}

// ----------------------------------------------------------------------------- status

#[derive(Serialize)]
pub struct EngineStatus {
    whisper_model: bool,
    settings: Settings,
    /// Which environments have a stored sign-in.
    signed_in: std::collections::BTreeMap<String, bool>,
}

fn signed_in_map() -> std::collections::BTreeMap<String, bool> {
    ENVIRONMENTS.iter().map(|(k, _)| (k.to_string(), keystore::load_tokens(k).is_some())).collect()
}

// ----------------------------------------------------------------------------- Tauri commands

/// OS version and CPU for the diagnostics report. Nothing about the person or the machine's name.
#[tauri::command]
fn diag_context() -> serde_json::Value {
    let ver = std::process::Command::new("sw_vers").arg("-productVersion").output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    serde_json::json!({ "os": format!("macOS {ver}"), "arch": std::env::consts::ARCH })
}

#[tauri::command]
async fn engine_status_cmd(app: tauri::AppHandle) -> EngineStatus {
    EngineStatus { whisper_model: find_model(&app).is_some(), settings: load_settings(), signed_in: signed_in_map() }
}

#[tauri::command]
async fn get_settings() -> Settings { load_settings() }

/// The recording in progress, if there is one. Only one visit is recorded at a time.
static RECORDER: std::sync::Mutex<Option<capture::Session>> = std::sync::Mutex::new(None);
/// The background checkpoint of the recording in progress (None for a dictation).
static LIVE: std::sync::Mutex<Option<(std::sync::Arc<journal::Live>, std::thread::JoinHandle<()>)>> = std::sync::Mutex::new(None);

/// Stops the checkpoint thread and returns the journal it kept.
fn finish_live() -> Option<journal::Journal> {
    if let Ok(mut g) = LIVE_SHARED.lock() { *g = None; }
    let (live, handle) = LIVE.lock().ok()?.take()?;
    live.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = handle.join();
    let j = live.journal.lock().ok().map(|j| j.clone());
    j
}

fn recording_running() -> bool {
    RECORDER.lock().map(|s| s.is_some()).unwrap_or(true)
}

/// Switches environment. Refused while a recording is running.
#[tauri::command]
async fn set_environment(environment: String) -> Result<Settings, String> {
    env_url(&environment)?;
    if recording_running() {
        return Err("Stop the recording before switching environment.".into());
    }
    let s = Settings { environment, ..load_settings() };
    store_settings(&s)?;
    Ok(s)
}

/// What the front end learns from the first sign-in step. Tokens never leave Rust.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignInOutcome {
    /// "enroll" or "verify" when a two-factor step is still to do; None when signed in.
    mfa: Option<String>,
    mfa_token: Option<String>,
}

/// Tokens waiting for the person to confirm they saved their recovery codes. Memory only.
static PENDING_TOKENS: std::sync::Mutex<Option<(String, keystore::Tokens)>> = std::sync::Mutex::new(None);

/// Signs in with Google against the named environment. With two-factor on, returns the step to do next; otherwise
/// the tokens are stored in the Keychain.
#[tauri::command]
async fn sign_in_with_google(environment: String) -> Result<SignInOutcome, String> {
    let url = env_url(&environment)?;
    let reply = tauri::async_runtime::spawn_blocking(move || google::sign_in(url))
        .await
        .map_err(|_| "sign-in failed".to_string())??;
    match reply {
        google::SignInReply::Mfa { mode, token } => Ok(SignInOutcome { mfa: Some(mode), mfa_token: Some(token) }),
        google::SignInReply::Tokens(t) => {
            keystore::store_tokens(&environment, &keystore::Tokens { access: t.access_token, refresh: t.refresh_token })?;
            Ok(SignInOutcome { mfa: None, mfa_token: None })
        }
    }
}

/// The two-factor steps. Returns (status, body); any tokens in the reply are kept in Rust (and removed from the body).
/// `hold` keeps them in memory until `mfa_finish` (used after enrollment, so recovery codes are seen first).
#[tauri::command]
async fn mfa_step(environment: String, step: String, body: String) -> Result<(u16, String), String> {
    let url = env_url(&environment)?;
    let (path, hold) = match step.as_str() {
        "enroll_start" => ("/api/desktop/v1/auth/mfa/enroll/start", false),
        "enroll_confirm" => ("/api/desktop/v1/auth/mfa/enroll/confirm", true),
        "verify" => ("/api/desktop/v1/auth/mfa/verify", false),
        _ => return Err("Unknown step.".into()),
    };
    let (status, text) = tauri::async_runtime::spawn_blocking(move || google::api_request(url, "POST", path, None, Some(&body)))
        .await
        .map_err(|_| "request failed".to_string())??;
    Ok((status, take_tokens(&environment, status, text, hold)?))
}

/// Pulls accessToken/refreshToken out of a successful reply and stores (or holds) them.
fn take_tokens(environment: &str, status: u16, text: String, hold: bool) -> Result<String, String> {
    if status != 200 && status != 201 {
        return Ok(text);
    }
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&text) else { return Ok(text) };
    let (Some(a), Some(r)) = (
        v.get("accessToken").and_then(|x| x.as_str()).map(String::from),
        v.get("refreshToken").and_then(|x| x.as_str()).map(String::from),
    ) else { return Ok(text) };
    let tokens = keystore::Tokens { access: a, refresh: r };
    if hold {
        *PENDING_TOKENS.lock().unwrap_or_else(|e| e.into_inner()) = Some((environment.to_string(), tokens));
    } else {
        keystore::store_tokens(environment, &tokens)?;
    }
    if let Some(o) = v.as_object_mut() {
        o.remove("accessToken");
        o.remove("refreshToken");
    }
    Ok(v.to_string())
}

/// Completes sign-in after the recovery codes were saved: moves the held tokens into the Keychain.
#[tauri::command]
async fn mfa_finish(environment: String) -> Result<(), String> {
    env_url(&environment)?;
    let held = PENDING_TOKENS.lock().unwrap_or_else(|e| e.into_inner()).take();
    match held {
        Some((env, t)) if env == environment => keystore::store_tokens(&environment, &t),
        _ => Err("Sign-in expired. Sign in again.".into()),
    }
}

/// Abandons a two-factor flow: forgets any held tokens.
#[tauri::command]
fn mfa_cancel() {
    *PENDING_TOKENS.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

#[tauri::command]
async fn sign_out(environment: String) -> Result<(), String> {
    env_url(&environment)?;
    keystore::clear_tokens(&environment);
    Ok(())
}

/// The access token for an environment, if signed in there.
#[tauri::command]
async fn get_access_token(environment: String) -> Result<Option<String>, String> {
    env_url(&environment)?;
    Ok(keystore::load_tokens(&environment).map(|t| t.access))
}

static REFRESH_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Called after a 401. `stale` is the access token that was rejected. Returns the new access token, or None when the
/// refresh was refused (the stored sign-in is then removed and the UI shows the sign-in screen).
#[derive(Serialize)]
struct ApiReply {
    status: u16,
    body: String,
}

/// Makes one practice-app API call from Rust (see `google::api_request`). Carries no patient data of its own.
#[tauri::command]
async fn api_request(
    base_url: String, method: String, path: String, token: Option<String>, body: Option<String>,
) -> Result<ApiReply, String> {
    tauri::async_runtime::spawn_blocking(move || {
        google::api_request(&base_url, &method, &path, token.as_deref(), body.as_deref())
            .map(|(status, body)| ApiReply { status, body })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn refresh_access_token(environment: String, stale: String) -> Result<Option<String>, String> {
    let url = env_url(&environment)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _g = REFRESH_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let Some(current) = keystore::load_tokens(&environment) else { return Ok(None) };
        // Another call already refreshed while this one waited.
        if current.access != stale {
            return Ok(Some(current.access));
        }
        match google::refresh(url, &current.refresh)? {
            Some(t) => {
                keystore::store_tokens(&environment, &keystore::Tokens { access: t.access_token.clone(), refresh: t.refresh_token })?;
                Ok(Some(t.access_token))
            }
            None => {
                keystore::clear_tokens(&environment);
                Ok(None)
            }
        }
    })
    .await
    .map_err(|_| "refresh failed".to_string())?
}

#[derive(Serialize)]
pub struct StartResult {
    /// Set when system audio could not be captured, so the UI can say the patient may not be recorded.
    warning: Option<String>,
    /// The recording's permanent id (None for a dictation).
    recording_id: Option<String>,
}

/// Begins recording the microphone and, for a telehealth visit, the system audio.
#[tauri::command]
async fn start_recording(
    app: tauri::AppHandle, with_system_audio: bool, visit_id: Option<String>, environment: Option<String>, append: Option<bool>, earlier_text: Option<String>, separator: Option<String>,
) -> Result<StartResult, String> {
    let mut slot = RECORDER.lock().map_err(|_| "the recorder is busy".to_string())?;
    if slot.is_some() {
        return Err("a recording is already running".into());
    }
    let (recorder, warning) = capture::Session::start(with_system_audio)?;
    if let Ok(mut g) = LIVE_SHARED.lock() { *g = Some(recorder.shared()); }
    if let Ok(mut w) = MIC_WATCH.lock() { *w = None; }
    let mut recording_id = None;
    // A visit recording keeps a local journal (checkpoints every ~30 s); a dictation keeps nothing.
    if let (Some(v), Some(e)) = (visit_id, environment) {
        if safe_component(&v).is_ok() && env_url(&e).is_ok() {
            if let (Some(model), Ok(key)) = (find_model(&app), keystore::queue_key()) {
                let id = journal::new_uuid();
                let live = std::sync::Arc::new(journal::Live {
                    journal: std::sync::Mutex::new(journal::Journal {
                        recording_id: id.clone(), visit_id: v, environment: e, created_at: queue::rfc3339_utc(now_unix()),
                        append: append.unwrap_or(false), earlier: earlier_text.unwrap_or_default(), separator: separator.unwrap_or_default(), done_mic: 0, done_sys: 0, segments: Vec::new(), seq: 0,
                    }),
                    stop: std::sync::atomic::AtomicBool::new(false),
                });
                let h = journal::start(model, support_dir(), key, recorder.shared(), std::sync::Arc::clone(&live));
                if let Ok(mut l) = LIVE.lock() { *l = Some((live, h)); }
                recording_id = Some(id);
            }
        }
    }
    *slot = Some(recorder);
    Ok(StartResult { warning, recording_id })
}

/// What the app can send to the server while still recording: the words so far (decrypted from memory only).
#[derive(Serialize)]
pub struct Checkpoint { recording_id: String, seq: u32, text: String, seconds: f64 }

/// The audio buffers of the recording in progress, for the microphone health check (dictations too).
static LIVE_SHARED: std::sync::Mutex<Option<std::sync::Arc<std::sync::Mutex<capture::Channels>>>> = std::sync::Mutex::new(None);
static MIC_WATCH: std::sync::Mutex<Option<(usize, std::time::Instant)>> = std::sync::Mutex::new(None);

/// Is the microphone still delivering audio? `lost` is the stream error flag; `silent` is no new audio for 10 s.
#[derive(serde::Serialize)]
pub struct MicHealth { lost: bool, silent: bool }

/// Pause or resume the recording in progress. Paused audio is dropped; the recording and transcript stay one.
#[tauri::command]
async fn set_recording_paused(paused: bool) -> Result<(), String> {
    if !recording_running() { return Err("no recording is running".into()); }
    capture::PAUSED.store(paused, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut w) = MIC_WATCH.lock() { *w = None; }
    Ok(())
}

#[tauri::command]
async fn recording_health() -> MicHealth {
    if capture::paused() { return MicHealth { lost: false, silent: false }; }
    let lost = capture::MIC_LOST.load(std::sync::atomic::Ordering::SeqCst);
    let len = LIVE_SHARED.lock().ok().and_then(|g| g.as_ref().and_then(|c| c.lock().ok().map(|c| c.mic.len())));
    let mut silent = false;
    if let (Some(len), Ok(mut w)) = (len, MIC_WATCH.lock()) {
        let now = std::time::Instant::now();
        let (prev, at) = w.unwrap_or((0, now));
        if len > prev || w.is_none() { *w = Some((len, now)); } else { silent = capture::stalled(prev, len, now.duration_since(at).as_secs_f64(), 10.0); }
    }
    MicHealth { lost, silent }
}

#[tauri::command]
async fn recording_checkpoint() -> Option<Checkpoint> {
    let g = LIVE.lock().ok()?;
    let (live, _) = g.as_ref()?;
    let j = live.journal.lock().ok()?;
    if j.seq == 0 { return None; }
    let seconds = j.segments.iter().filter_map(|s| s.audio_end_time).fold(0.0, f64::max);
    Some(Checkpoint { recording_id: j.recording_id.clone(), seq: j.seq, text: j.text(), seconds })
}

#[derive(Serialize)]
pub struct StopResult {
    /// Seconds of audio captured, for the UI only.
    seconds: f32,
    system_audio: bool,
    /// Only one side of a telehealth call was heard: a note written from this would be missing the other voice.
    one_sided: bool,
    /// Voices found on a single microphone (1 or 2); 2 when both sides of a call were captured on their own channels.
    voices: usize,
    /// True when the provider still has to say which of "Speaker 1" / "Speaker 2" is the patient.
    needs_speaker_choice: bool,
    /// The first words each unconfirmed speaker said, only to help the provider choose (never stored or logged).
    speakers: Vec<SpeakerSample>,
}

#[derive(Serialize)]
pub struct SpeakerSample {
    label: String,
    sample: String,
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Ends the recording, transcribes it here, and saves the transcript in the encrypted queue under the visit's id.
/// The audio exists only in memory and is dropped when this returns.
#[tauri::command]
async fn stop_recording(
    app: tauri::AppHandle,
    visit_id: String,
    environment: String,
    previous: Option<String>,
    separator: Option<String>,
) -> Result<StopResult, String> {
    safe_component(&visit_id)?;
    env_url(&environment)?;
    let recorder = RECORDER
        .lock()
        .map_err(|_| "the recorder is busy".to_string())?
        .take()
        .ok_or("no recording is running")?;
    let channels = recorder.stop()?;
    let journal = finish_live();
    if !channels.has_sound() {
        if let Some(j) = &journal { journal::Journal::remove(&support_dir(), &j.recording_id); }
        return Err("the recording is silent; check the microphone and try again".into());
    }
    let seconds = channels.mic.len().max(channels.system.len()) as f32 / capture::SAMPLE_RATE as f32;
    let summary = StopResult { seconds, system_audio: !channels.system.is_empty(), one_sided: channels.one_sided(), voices: 0, needs_speaker_choice: false, speakers: Vec::new() };
    let model = find_model(&app).ok_or("the transcription model is missing")?;
    // Two channels (a video call: the mic is the provider, the call audio is the patient) are labelled by channel. One
    // microphone (in person, or on speaker) is separated into two voices here on the Mac; those labels are unconfirmed.
    // Whatever the checkpoints already transcribed is kept; only the tail after them is transcribed now.
    let (prior, done_mic, done_sys) = journal.as_ref().map(|j| (j.segments.clone(), j.done_mic, j.done_sys)).unwrap_or_default();
    let (segments, voices) = tauri::async_runtime::spawn_blocking(move || {
        let tail = transcribe::transcribe_tail(&model, &channels.mic, done_mic.min(channels.mic.len()), &channels.system, done_sys.min(channels.system.len()))?;
        let mut segs = transcribe::merge_channels(prior.into_iter().chain(tail).collect());
        let loud = |v: &Vec<i16>| v.iter().any(|s| s.unsigned_abs() > 300);
        let voices = if loud(&channels.system) {
            for s in segs.iter_mut() {
                s.speaker = (if s.channel == "mic" { "Provider" } else { "Patient" }).into();
            }
            2
        } else {
            diarize::diarize(&channels.mic, &mut segs)
        };
        Ok::<_, String>((segs, voices))
    })
    .await
    .map_err(|_| "transcription failed".to_string())??;
    if segments.is_empty() {
        return Err("The recording produced no text.".into());
    }
    let needs_choice = segments.iter().any(|s| s.speaker == "Speaker 1" || s.speaker == "Speaker 2");
    let speakers: Vec<SpeakerSample> = if needs_choice {
        ["Speaker 1", "Speaker 2"].iter().map(|l| SpeakerSample {
            label: (*l).to_string(),
            sample: segments.iter().find(|s| s.speaker == *l).map(|s| s.text.split_whitespace().take(14).collect::<Vec<_>>().join(" ")).unwrap_or_default(),
        }).collect()
    } else {
        Vec::new()
    };
    let summary = StopResult { voices, needs_speaker_choice: needs_choice, speakers, ..summary };
    let recording_id = journal.as_ref().map(|j| j.recording_id.clone());
    let meta = queue::Metadata {
        version: "1.0".into(),
        visit_id: visit_id.clone(),
        environment,
        created_at: queue::rfc3339_utc(now_unix()),
        duration_seconds: seconds as f64,
        status: queue::Status::Pending, link_visit: recording_id.as_ref().map(|_| visit_id), recording_id: recording_id.clone(), confirmed_at: None,
    };
    // Adding to an earlier transcript: the earlier text (held by the app until now) goes in front, with a time line.
    let preface = match previous.as_deref().map(str::trim_end).filter(|p| !p.is_empty()) {
        Some(p) => format!("{p}{}", separator.unwrap_or_else(|| "\n\n".into())),
        None => String::new(),
    };
    queue::save(&support_dir(), &keystore::queue_key()?, &meta, &segments, &preface)?;
    // The queue copy is safely on disk: the journal has done its job.
    if let Some(id) = recording_id { journal::Journal::remove(&support_dir(), &id); }
    Ok(summary)
}

/// Ends a dictation (microphone only), transcribes it here and returns the text. Nothing is written to disk: the
/// audio and the text exist only in memory and the caller keeps the text only until the feedback is saved.
#[tauri::command]
async fn stop_dictation(app: tauri::AppHandle) -> Result<String, String> {
    let recorder = RECORDER
        .lock()
        .map_err(|_| "the recorder is busy".to_string())?
        .take()
        .ok_or("no recording is running")?;
    let channels = recorder.stop()?;
    if !channels.has_sound() {
        return Err("the recording is silent; check the microphone and try again".into());
    }
    let model = find_model(&app).ok_or("the transcription model is missing")?;
    let mic = channels.mic;
    let segments = tauri::async_runtime::spawn_blocking(move || transcribe::transcribe(&model, &mic, &[]))
        .await
        .map_err(|_| "transcription failed".to_string())??;
    let text = queue::assemble_text(&segments);
    if text.trim().is_empty() {
        return Err("The recording produced no text.".into());
    }
    Ok(text)
}

/// Throws away a recording without transcribing it.
#[tauri::command]
async fn cancel_recording() -> Result<(), String> {
    if let Ok(mut g) = LIVE_SHARED.lock() { *g = None; }
    if let Ok(mut slot) = RECORDER.lock() {
        slot.take();
    }
    if let Some(j) = finish_live() { journal::Journal::remove(&support_dir(), &j.recording_id); }
    Ok(())
}

// ----------------------------------------------------------------------------- the queue

#[derive(Serialize)]
pub struct QueueItem {
    visit_id: String,
    recording_id: Option<String>,
    /// The visit to link on the server; None means "Needs link" (the recording is safe in the inbox either way).
    link_visit: Option<String>,
    confirmed_at: Option<String>,
    environment: String,
    created_at: String,
    duration_seconds: f64,
    status: queue::Status,
}

#[tauri::command]
async fn queue_list() -> Result<Vec<QueueItem>, String> {
    let key = keystore::queue_key()?;
    Ok(queue::list(&support_dir(), &key)
        .into_iter()
        .map(|m| QueueItem {
            visit_id: m.visit_id, environment: m.environment, created_at: m.created_at,
            duration_seconds: m.duration_seconds, status: m.status,
            // Items saved before recording ids existed link to their own visit through the old upload.
            recording_id: m.recording_id, link_visit: m.link_visit, confirmed_at: m.confirmed_at,
        })
        .collect())
}

/// The text to upload for a queued visit.
#[tauri::command]
async fn queue_text(visit_id: String) -> Result<String, String> {
    queue::read_text(&support_dir(), &keystore::queue_key()?, &visit_id)
}

/// Puts a visit's saved transcript back to exactly `text` (used to undo an addition the provider decided against).
#[tauri::command]
async fn queue_set_text(visit_id: String, environment: String, text: String) -> Result<(), String> {
    env_url(&environment)?;
    let meta = queue::Metadata {
        version: "1.0".into(),
        visit_id,
        environment,
        created_at: queue::rfc3339_utc(now_unix()),
        duration_seconds: 0.0,
        status: queue::Status::Pending, recording_id: None, link_visit: None, confirmed_at: None,
    };
    queue::save(&support_dir(), &keystore::queue_key()?, &meta, &[], &text)
}

/// The provider said who is who: renames "Speaker 1" / "Speaker 2" in this visit's saved transcript before it is sent.
#[tauri::command]
async fn queue_relabel(visit_id: String, mapping: std::collections::HashMap<String, String>) -> Result<(), String> {
    let allowed = |l: &str| matches!(l, "Provider" | "Patient" | "Speaker 1" | "Speaker 2");
    if mapping.iter().any(|(a, b)| !allowed(a) || !allowed(b)) {
        return Err("Unknown speaker label.".into());
    }
    queue::relabel(&support_dir(), &keystore::queue_key()?, &visit_id, &mapping)
}

/// Permanent consent log: one JSON line per recording start. Kept apart from the transcript queue, never swept or shredded.
fn consent_log(dir: &Path) -> PathBuf { dir.join("consents.jsonl") }

fn consent_append(dir: &Path, event: &str) -> Result<(), String> {
    use std::io::Write;
    let v: serde_json::Value = serde_json::from_str(event).map_err(|_| "unreadable consent record".to_string())?;
    if v.get("visitId").and_then(|x| x.as_str()).map_or(true, |x| x.is_empty()) { return Err("consent record has no visit".into()); }
    let _ = fs::create_dir_all(dir);
    let mut f = fs::OpenOptions::new().create(true).append(true).open(consent_log(dir)).map_err(|_| "could not save the consent record".to_string())?;
    writeln!(f, "{}", serde_json::to_string(&v).unwrap_or_default()).map_err(|_| "could not save the consent record".to_string())?;
    f.sync_all().map_err(|_| "could not save the consent record".to_string())
}

fn consent_latest(dir: &Path, visit_id: &str) -> Option<String> {
    let text = fs::read_to_string(consent_log(dir)).ok()?;
    text.lines().rev().find(|l| serde_json::from_str::<serde_json::Value>(l).ok().and_then(|v| v.get("visitId").and_then(|x| x.as_str().map(|s| s == visit_id))).unwrap_or(false)).map(|l| l.to_string())
}

#[tauri::command]
async fn consent_record(event: String) -> Result<(), String> { consent_append(&support_dir(), &event) }

#[tauri::command]
async fn consent_for(visit_id: String) -> Result<Option<String>, String> { Ok(consent_latest(&support_dir(), &visit_id)) }

/// Called after the server confirmed the upload: marks the folder uploaded and shreds it.
#[tauri::command]
async fn queue_complete(visit_id: String) -> Result<(), String> {
    let support = support_dir();
    let key = keystore::queue_key()?;
    // A recording with an id keeps its encrypted copy 24 hours after the server confirmed the checksum (a safety net);
    // `queue_sweep` shreds it then. Older items are shredded now, as before.
    match queue::read_metadata(&support, &key, &visit_id) {
        Ok(m) if m.recording_id.is_some() => queue::mark_confirmed(&support, &key, &visit_id, &queue::rfc3339_utc(now_unix())),
        _ => {
            let _ = queue::mark_uploaded(&support, &key, &visit_id);
            queue::shred_folder(&support, &visit_id)
        }
    }
}

/// Shreds confirmed copies older than 24 hours. Called at launch and now and then.
#[tauri::command]
async fn queue_sweep() -> Result<usize, String> {
    Ok(queue::sweep_confirmed(&support_dir(), &keystore::queue_key()?, now_unix(), 24 * 3600))
}

/// Writes a recovered recording from a crash into the queue (called at launch).
#[tauri::command]
async fn recover_recordings() -> Result<usize, String> {
    let active = LIVE.lock().ok().and_then(|g| g.as_ref().and_then(|(l, _)| l.journal.lock().ok().map(|j| j.recording_id.clone())));
    Ok(journal::recover(&support_dir(), &keystore::queue_key()?, active.as_deref()))
}

/// Opens the macOS folder chooser and returns the chosen folder, or None if cancelled.
#[tauri::command]
async fn choose_transcript_dir() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let out = std::process::Command::new("osascript")
            .args(["-e", "POSIX path of (choose folder with prompt \"Save a copy of each transcript to:\")"])
            .output()
            .map_err(|_| "could not open the folder chooser".to_string())?;
        if !out.status.success() {
            return Ok(None); // cancelled
        }
        let p = String::from_utf8_lossy(&out.stdout).trim().trim_end_matches('/').to_string();
        Ok(if p.is_empty() { None } else { Some(p) })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Turns the transcript copy on (a folder) or off (None).
#[tauri::command]
async fn set_transcript_copy_dir(dir: Option<String>) -> Result<Settings, String> {
    if let Some(d) = dir.as_deref() {
        if !std::path::Path::new(d).is_dir() {
            return Err("That folder does not exist.".into());
        }
    }
    let s = Settings { transcript_copy_dir: dir.filter(|d| !d.is_empty()), ..load_settings() };
    store_settings(&s)?;
    Ok(s)
}

/// A file name made of letters, digits, dash, underscore and dot only.
fn clean_file_stem(label: &str) -> String {
    let s: String = label.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
    let s = s.trim_matches(|c| c == '.' || c == '_').to_string();
    if s.is_empty() { "transcript".into() } else { s.chars().take(80).collect() }
}

/// Writes a plain-text copy of a queued transcript to the chosen folder, if one is set. Called after the server
/// confirmed the upload and before the queue copy is shredded. Returns whether a file was written. No audio, and
/// nothing is logged.
#[tauri::command]
async fn save_transcript_copy(visit_id: String, label: String) -> Result<bool, String> {
    let Some(dir) = load_settings().transcript_copy_dir else { return Ok(false) };
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        return Err("The folder for transcript copies is missing. Choose it again in Setup.".into());
    }
    let text = queue::read_text(&support_dir(), &keystore::queue_key()?, &visit_id)?;
    let stem = clean_file_stem(&label);
    let mut path = dir.join(format!("{stem}.txt"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem}-{n}.txt"));
        n += 1;
    }
    fs::write(&path, text).map_err(|_| "could not save the transcript copy".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(true)
}

/// Writes one saved (unsent) transcript to the Downloads folder as plain text so it can never be stranded, and returns
/// the file's path. The queued copy is left exactly as it was. The file name carries no patient information.
#[tauri::command]
async fn export_queued_transcript(visit_id: String) -> Result<String, String> {
    let text = queue::read_text(&support_dir(), &keystore::queue_key()?, &visit_id)?;
    let dir = home().join("Downloads");
    if !dir.is_dir() {
        return Err("The Downloads folder was not found.".into());
    }
    let stem = clean_file_stem(&format!("Unsent-transcript-{}", visit_id.chars().take(8).collect::<String>()));
    let mut out = dir.join(format!("{stem}.txt"));
    let mut n = 2;
    while out.exists() {
        out = dir.join(format!("{stem}-{n}.txt"));
        n += 1;
    }
    fs::write(&out, text).map_err(|_| "Could not save the transcript file.".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&out, fs::Permissions::from_mode(0o600));
    }
    Ok(out.to_string_lossy().into_owned())
}

/// Saves a document's PDF (the latest version, as the practice app renders it) into the Downloads folder and returns
/// the file's path. Nothing is logged; the file is a document the provider is entitled to keep.
#[tauri::command]
async fn download_document_pdf(base_url: String, path: String, token: String, label: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bare = path.split('?').next().unwrap_or("");
        if !bare.contains("/documents/") || !bare.ends_with("/pdf") {
            return Err("Not a document address.".to_string());
        }
        let (status, bytes) = google::download(&base_url, &path, &token)?;
        if status == 401 {
            return Err("Signed out. Sign in again in Setup.".into());
        }
        if status != 200 {
            return Err(format!("The practice app returned {status}."));
        }
        if !bytes.starts_with(b"%PDF") {
            return Err("The practice app did not send a PDF.".into());
        }
        let dir = home().join("Downloads");
        if !dir.is_dir() {
            return Err("The Downloads folder was not found.".into());
        }
        let stem = clean_file_stem(&label);
        let mut out = dir.join(format!("{stem}.pdf"));
        let mut n = 2;
        while out.exists() {
            out = dir.join(format!("{stem}-{n}.pdf"));
            n += 1;
        }
        fs::write(&out, bytes).map_err(|_| "Could not save the PDF.".to_string())?;
        Ok(out.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "Could not save the PDF.".to_string())?
}

/// Deletes a queued transcript the provider chose not to send.
#[tauri::command]
async fn queue_discard(visit_id: String) -> Result<(), String> {
    queue::shred_folder(&support_dir(), &visit_id)
}

/// `Practice Recorder --selfcheck [--transcribe]`: used by scripts/release-gate.sh. Prints one JSON line about where the
/// model was found (and, with --transcribe, whether it really transcribes a generated tone) and exits. No window, no patient data.
fn selfcheck(transcribe_too: bool) -> i32 {
    let exe = std::env::current_exe().unwrap_or_default();
    let resource = exe.parent().and_then(|p| p.parent()).map(|p| p.join("Resources/models").join(model::NAME));
    let kept = support_dir().join("models");
    let found = model_candidates(resource.clone()).into_iter().find(|p| model::is_valid(p));
    let where_ = match &found {
        Some(p) if p.starts_with(&kept) => "kept",
        Some(p) if Some(p) == resource.as_ref() => "bundled",
        Some(_) => "other",
        None => "missing",
    };
    let mut ok_transcribe = serde_json::Value::Null;
    if let (true, Some(p)) = (transcribe_too, &found) {
        let tone: Vec<i16> = (0..16000 * 3).map(|i| ((i as f32 * 0.05).sin() * 3000.0) as i16).collect();
        ok_transcribe = serde_json::json!(transcribe::transcribe(p, &tone, &[]).is_ok());
    }
    println!("{}", serde_json::json!({ "model": where_, "transcribe_ok": ok_transcribe, "version": env!("CARGO_PKG_VERSION") }));
    if where_ == "missing" { 3 } else if ok_transcribe == serde_json::json!(false) { 4 } else { 0 }
}

/// Headless check of the BUILT app's own Rust paths (used by the release gate): every HTTP method and a 300 KB upload
/// through the real api_request to `base`, then an encrypted journal -> recovery -> queue -> confirm -> sweep round trip.
fn selfcheck_net(base: &str) -> i32 {
    let mut fails: Vec<String> = Vec::new();
    let id = journal::new_uuid();
    let route = format!("/api/desktop/v1/notes/inbox/{id}");
    for m in ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] {
        let body = if matches!(m, "GET" | "HEAD" | "DELETE") { None } else { Some("{\"x\":1}") };
        match google::api_request(base, m, &route, Some("selfcheck"), body) {
            Ok((200, _)) => {}
            Ok((st, _)) => fails.push(format!("{m}: status {st}")),
            Err(e) => fails.push(format!("{m}: {e}")),
        }
    }
    let big = format!("{{\"seq\":1000000,\"final\":true,\"text\":\"{}\"}}", "word ".repeat(60_000));
    match google::api_request(base, "PUT", &route, Some("selfcheck"), Some(&big)) {
        Ok((200, r)) if r.contains(&big.len().to_string()) => {}
        Ok((st, _)) => fails.push(format!("large PUT: status {st} or size not echoed")),
        Err(e) => fails.push(format!("large PUT: {e}")),
    }
    let support = support_dir();
    let key = [7u8; 32];
    let j = journal::Journal { recording_id: id.clone(), visit_id: "selfcheck-visit".into(), environment: "production".into(), created_at: queue::rfc3339_utc(1_700_000_000),
        append: false, earlier: String::new(), separator: String::new(), done_mic: 0, done_sys: 0, seq: 1,
        segments: vec![queue::Segment { id: "s1".into(), text: "hello".into(), timestamp: "[00:00]".into(), channel: "mic".into(), speaker: "Provider".into(), audio_start_time: Some(0.0), audio_end_time: Some(1.0), sequence_id: 1 }] };
    if let Err(e) = j.save(&support, &key) { fails.push(format!("journal save: {e}")); }
    if journal::recover(&support, &key, None) != 1 { fails.push("journal recovery did not produce one queue item".into()); }
    let listed = queue::list(&support, &key);
    if !listed.iter().any(|m| m.recording_id.as_deref() == Some(id.as_str())) { fails.push("recovered item missing from the queue".into()); }
    if let Some(m) = listed.first() {
        if queue::read_text(&support, &key, &m.visit_id).map(|t| t.contains("hello")).unwrap_or(false) == false { fails.push("encrypted text did not read back".into()); }
        if queue::mark_confirmed(&support, &key, &m.visit_id, &queue::rfc3339_utc(1_700_000_000)).is_err() { fails.push("mark confirmed".into()); }
        if queue::sweep_confirmed(&support, &key, 1_700_000_000 + 25 * 3600, 24 * 3600) != 1 { fails.push("24 h sweep did not remove the item".into()); }
    } else { fails.push("queue empty after recovery".into()); }
    if !queue::list(&support, &key).is_empty() { fails.push("queue not empty after the sweep".into()); }
    if wrong_key_reads(&support) { fails.push("a wrong key read data".into()); }
    println!("{}", serde_json::json!({ "version": env!("CARGO_PKG_VERSION"), "ok": fails.is_empty(), "failures": fails }));
    if fails.is_empty() { 0 } else { 5 }
}


/// STAGING TEST BUILD ONLY. `--selfcheck-staging`: runs the real inbox contract against staging with the sign-in already
/// stored in THIS build's Keychain item, entirely inside the process (no token is printed or written anywhere).
#[cfg(feature = "staging-test")]
fn selfcheck_staging() -> i32 {
    use sha2::{Digest, Sha256};
    let base = "https://practice-mgmt-321509350517.us-east4.run.app";
    let mut steps: Vec<serde_json::Value> = Vec::new();
    let mut fails: Vec<String> = Vec::new();
    let mut rec = |name: &str, ok: bool, detail: String| { if !ok { fails.push(format!("{name}: {detail}")); } steps.push(serde_json::json!({"step": name, "ok": ok, "detail": detail})); };
    let tok = match keystore::load_tokens("staging") { Some(t) => t.access, None => { println!("{}", serde_json::json!({"ok": false, "failures": ["no staging sign-in stored in this build's Keychain item"]})); return 5; } };
    let id = journal::new_uuid();
    let route = format!("/api/desktop/v1/notes/inbox/{id}");
    let text = format!("SELFCHECK recording {id}. Safe to delete. {}", "word ".repeat(2000));
    let sha = format!("{:x}", Sha256::digest(text.as_bytes()));
    let put = |seq: u64, fin: bool, tk: &str, t: &str, h: &str| google::api_request(base, "PUT", &route, Some(tk), Some(&serde_json::json!({"seq": seq, "final": fin, "text": t, "sha256": h, "durationSeconds": 1.0, "recordedAt": "2026-11-18T12:00:00Z"}).to_string()));
    // 1 checkpoint then final, echo must carry final:true and the same sha
    match put(1, false, &tok, &text, &sha) { Ok((200, r)) => rec("checkpoint PUT", r.contains("\"ok\":true") || r.contains("\"ok\": true"), "200".into()), Ok((st, r)) => rec("checkpoint PUT", false, format!("status {st} {}", &r.chars().take(120).collect::<String>())), Err(e) => rec("checkpoint PUT", false, e) }
    match put(1_000_000, true, &tok, &text, &sha) { Ok((200, r)) => rec("final PUT echoes final and sha", r.contains("\"final\":true") && r.contains(&sha), "200".into()), Ok((st, r)) => rec("final PUT", false, format!("status {st} {}", &r.chars().take(120).collect::<String>())), Err(e) => rec("final PUT", false, e) }
    match put(1_000_000, true, &tok, &text, &sha) { Ok((200, _)) => rec("identical resend is idempotent", true, "200".into()), Ok((st, _)) => rec("identical resend", false, format!("status {st}")), Err(e) => rec("identical resend", false, e) }
    match put(2, false, &tok, &text, &"0".repeat(64)) { Ok((422, _)) => rec("bad checksum refused", true, "422".into()), Ok((st, _)) => rec("bad checksum refused", false, format!("status {st}")), Err(e) => rec("bad checksum refused", false, e) }
    match google::api_request(base, "GET", "/api/desktop/v1/notes/inbox?linked=false", Some(&tok), None) { Ok((200, r)) => rec("appears in Needs link list", r.contains(&id), "200".into()), Ok((st, _)) => rec("Needs link list", false, format!("status {st}")), Err(e) => rec("Needs link list", false, e) }
    match google::api_request(base, "POST", &format!("{route}/link"), Some(&tok), Some("{\"visitId\":\"does-not-exist\"}")) { Ok((404, _)) => rec("link to missing visit = 404, stays in inbox", true, "404".into()), Ok((st, _)) => rec("link to missing visit", false, format!("status {st}")), Err(e) => rec("link to missing visit", false, e) }
    match google::api_request(base, "GET", "/api/desktop/v1/notes/inbox?linked=false", Some(&tok), None) { Ok((200, r)) => rec("still in Needs link after failed link", r.contains(&id), "200".into()), Ok((st, _)) => rec("still in Needs link", false, format!("status {st}")), Err(e) => rec("still in Needs link", false, e) }
    match put(1_000_000, true, "expired-or-bad-token", &text, &sha) { Ok((401, _)) => rec("bad/expired token = 401", true, "401".into()), Ok((st, _)) => rec("bad token", false, format!("status {st}")), Err(e) => rec("bad token", false, e) }
    match google::api_request("http://127.0.0.1:1", "PUT", &route, Some(&tok), Some("{}")) { Err(_) => rec("offline = network error, not a rule failure", true, "unreachable".into()), Ok((st, _)) => rec("offline", false, format!("status {st}")) }
    println!("{}", serde_json::json!({"ok": fails.is_empty(), "uuid": id, "failures": fails, "steps": steps}));
    if fails.is_empty() { 0 } else { 5 }
}

fn wrong_key_reads(support: &Path) -> bool {
    let id = journal::new_uuid();
    let j = journal::Journal { recording_id: id.clone(), visit_id: "k".into(), environment: "production".into(), created_at: queue::rfc3339_utc(1_700_000_000), append: false, earlier: String::new(), separator: String::new(), done_mic: 0, done_sys: 0, seq: 1, segments: vec![] };
    let _ = j.save(support, &[1u8; 32]);
    let r = journal::Journal::load(support, &[2u8; 32], &id).is_ok();
    journal::Journal::remove(support, &id);
    r
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    #[cfg(feature = "staging-test")]
    if args.iter().any(|a| a == "--selfcheck-staging") { std::process::exit(selfcheck_staging()); }
    if let Some(i) = args.iter().position(|a| a == "--selfcheck-net") {
        std::process::exit(selfcheck_net(args.get(i + 1).map(|s| s.as_str()).unwrap_or("http://127.0.0.1:1")));
    }
    if args.iter().any(|a| a == "--selfcheck") {
        std::process::exit(selfcheck(args.iter().any(|a| a == "--transcribe")));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            engine_status_cmd, recording_checkpoint, recording_health, set_recording_paused, queue_sweep, recover_recordings, model_download, model_download_status, get_settings, set_environment, sign_in_with_google, mfa_step, mfa_finish, mfa_cancel, sign_out, get_access_token,
            refresh_access_token, api_request, start_recording, stop_recording, stop_dictation, cancel_recording,
            queue_list, queue_text, queue_set_text, queue_relabel, queue_complete, consent_record, consent_for, queue_discard, choose_transcript_dir, set_transcript_copy_dir, save_transcript_copy, export_queued_transcript, download_document_pdf,
            updater::check_update, updater::install_update, diag_context
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consent_log_keeps_every_event_and_finds_the_latest_per_visit() {
        let d = std::env::temp_dir().join(format!("consent-{}", journal::new_uuid()));
        assert!(consent_append(&d, "{\"visitId\":\"v1\",\"consentGiven\":true,\"textVersion\":\"a\"}").is_ok());
        assert!(consent_append(&d, "{\"visitId\":\"v2\",\"consentGiven\":true,\"textVersion\":\"a\"}").is_ok());
        assert!(consent_append(&d, "{\"visitId\":\"v1\",\"consentGiven\":true,\"textVersion\":\"b\"}").is_ok());
        assert!(consent_latest(&d, "v1").unwrap().contains("\"b\""));
        assert!(consent_latest(&d, "v2").unwrap().contains("\"a\""));
        assert!(consent_latest(&d, "v3").is_none());
        assert!(consent_append(&d, "not json").is_err());
        assert!(consent_append(&d, "{\"consentGiven\":true}").is_err());
        assert_eq!(fs::read_to_string(consent_log(&d)).unwrap().lines().count(), 3);
        let _ = fs::remove_dir_all(&d);
    }

    /// Each test gets its own app directory. The path comes from a process-wide environment variable, so these tests
    /// must not run at the same time as each other.
    static ROOT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_temp_root<T>(f: impl FnOnce() -> T) -> T {
        let guard = ROOT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = std::env::temp_dir().join(unique("notes-test"));
        std::env::set_var("PRACTICE_APP_DIR", root.join("app").to_string_lossy().to_string());
        let out = f();
        let _ = fs::remove_dir_all(&root);
        drop(guard);
        out
    }

    #[test]
    fn path_components_are_plain_names() {
        assert!(safe_component("Testcase, Alpha").is_ok());
        assert!(safe_component("2026-10-29").is_ok());
        for bad in ["", ".", "..", "../x", "a/b", "a\\b", ".hidden", "a:b", "a\nb"] {
            assert!(safe_component(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn settings_round_trip_and_default_to_production() {
        with_temp_root(|| {
            assert_eq!(load_settings().environment, DEFAULT_ENV);
            store_settings(&Settings { environment: DEFAULT_ENV.into(), transcript_copy_dir: None }).unwrap();
            assert_eq!(load_settings().environment, DEFAULT_ENV);
            // An environment this build does not have (a settings file from a build that had a staging switch) falls
            // back to the default; it never selects another server.
            store_settings(&Settings { environment: "elsewhere".into(), transcript_copy_dir: None }).unwrap();
            assert_eq!(load_settings().environment, DEFAULT_ENV);
            assert!(!fs::read_to_string(settings_path()).unwrap().contains("token"));
        })
    }

    #[cfg(not(feature = "staging-test"))]
    #[test]
    fn the_release_build_knows_only_production() {
        assert_eq!(ENVIRONMENTS.len(), 1);
        assert_eq!(ENVIRONMENTS[0].0, "production");
        assert!(env_url("staging").is_err() && env_url("localhost").is_err());
        // A settings file left by the old build that pointed at staging or this Mac now means production.
        for old in ["staging", "localhost"] {
            let (s, _, _) = parse_settings(&serde_json::json!({ "environment": old }));
            assert_eq!(s.environment, "production");
        }
        let (s, legacy, _) = parse_settings(&serde_json::json!({ "practice_url": "https://practice-mgmt-321509350517.us-east4.run.app", "access_token": "a" }));
        assert_eq!(s.environment, "production");
        assert!(legacy.is_none());
    }

    #[cfg(feature = "staging-test")]
    #[test]
    fn old_settings_files_are_read_and_their_tokens_found() {
        let old = serde_json::json!({
            "practice_url": "https://practice-mgmt-321509350517.us-east4.run.app/",
            "access_token": "a", "refresh_token": "r", "whisper_model": "/x.bin"
        });
        let (s, legacy, dirty) = parse_settings(&old);
        assert_eq!(s.environment, "staging");
        assert!(dirty);
        let l = legacy.unwrap();
        assert_eq!((l.env.as_str(), l.access.as_str(), l.refresh.as_str()), ("staging", "a", "r"));
        // A custom address maps to no environment: tokens are dropped, the default is production.
        let (s, legacy, dirty) = parse_settings(&serde_json::json!({ "practice_url": "https://other.example", "access_token": "a" }));
        assert_eq!(s.environment, DEFAULT_ENV);
        assert!(legacy.is_none() && dirty);
        let (_, _, dirty) = parse_settings(&serde_json::json!({ "environment": "localhost" }));
        assert!(!dirty);
    }

    #[test]
    fn built_in_environments_use_allowed_addresses() {
        for (k, u) in ENVIRONMENTS {
            assert!(google::check_base_url(u).is_ok(), "{k}");
        }
        assert!(env_url("elsewhere").is_err());
    }

    #[test]
    fn shred_removes_the_file() {
        let p = std::env::temp_dir().join(unique("shred"));
        fs::write(&p, vec![7u8; 100_000]).unwrap();
        shred(&p);
        assert!(!p.exists());
    }
}

#[cfg(test)]
mod mfa_tests {
    use super::*;

    #[test]
    fn replies_without_tokens_pass_through_and_failures_are_untouched() {
        let body = r#"{"secret":"S","otpauthUri":"otpauth://x"}"#.to_string();
        assert_eq!(take_tokens("staging", 200, body.clone(), false).unwrap(), body);
        let err = r#"{"error":"bad_code"}"#.to_string();
        assert_eq!(take_tokens("staging", 400, err.clone(), true).unwrap(), err);
    }

    #[test]
    fn held_tokens_are_removed_from_the_reply_but_recovery_codes_stay() {
        let body = r#"{"accessToken":"a","refreshToken":"r","recoveryCodes":["c1","c2"]}"#.to_string();
        let out = take_tokens("staging", 200, body, true).unwrap();
        assert!(!out.contains("accessToken") && !out.contains("refreshToken") && out.contains("c1"));
        assert!(PENDING_TOKENS.lock().unwrap().is_some());
        mfa_cancel();
        assert!(PENDING_TOKENS.lock().unwrap().is_none());
    }
}
