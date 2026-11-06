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
        Err(_) => home().join("Library/Application Support/PracticeNotes"),
    };
    let _ = fs::create_dir_all(&dir);
    dir
}

fn settings_path() -> PathBuf {
    support_dir().join("settings.json")
}

/// The three servers the app can talk to. There is deliberately no free-text address.
pub const ENVIRONMENTS: [(&str, &str); 3] = [
    ("production", "https://practice-mgmt-802176721153.us-east4.run.app"),
    ("staging", "https://practice-mgmt-321509350517.us-east4.run.app"),
    ("localhost", "http://localhost:3000"),
];

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
        Self { environment: "production".into(), transcript_copy_dir: None }
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
        if env_url(&e).is_ok() { e } else { url_env.clone().unwrap_or_else(|| "production".into()) }
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

/// Where the Whisper model may be, best first: the bundled resource, the app's own folder, then the spike's folder
/// used during development.
fn model_candidates(resource: Option<PathBuf>) -> Vec<PathBuf> {
    let lib = home().join("Library/Application Support");
    let mut v = Vec::new();
    if let Some(r) = resource {
        v.push(r);
    }
    v.push(support_dir().join("models/ggml-small.en.bin"));
    v.push(lib.join("PracticeNotesSpike/models/ggml-small.en.bin"));
    v
}

fn find_model(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource = app.path().resolve("models/ggml-small.en.bin", tauri::path::BaseDirectory::Resource).ok();
    model_candidates(resource).into_iter().find(|p| p.exists())
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
}

/// Begins recording the microphone and, for a telehealth visit, the system audio.
#[tauri::command]
async fn start_recording(with_system_audio: bool) -> Result<StartResult, String> {
    let mut slot = RECORDER.lock().map_err(|_| "the recorder is busy".to_string())?;
    if slot.is_some() {
        return Err("a recording is already running".into());
    }
    let (recorder, warning) = capture::Session::start(with_system_audio)?;
    *slot = Some(recorder);
    Ok(StartResult { warning })
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
    if !channels.has_sound() {
        return Err("the recording is silent; check the microphone and try again".into());
    }
    let seconds = channels.mic.len().max(channels.system.len()) as f32 / capture::SAMPLE_RATE as f32;
    let summary = StopResult { seconds, system_audio: !channels.system.is_empty(), one_sided: channels.one_sided(), voices: 0, needs_speaker_choice: false, speakers: Vec::new() };
    let model = find_model(&app).ok_or("the transcription model is missing")?;
    // Two channels (a video call: the mic is the provider, the call audio is the patient) are labelled by channel. One
    // microphone (in person, or on speaker) is separated into two voices here on the Mac; those labels are unconfirmed.
    let (segments, voices) = tauri::async_runtime::spawn_blocking(move || {
        let mut segs = transcribe::transcribe(&model, &channels.mic, &channels.system)?;
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
    let meta = queue::Metadata {
        version: "1.0".into(),
        visit_id,
        environment,
        created_at: queue::rfc3339_utc(now_unix()),
        duration_seconds: seconds as f64,
        status: queue::Status::Pending,
    };
    // Adding to an earlier transcript: the earlier text (held by the app until now) goes in front, with a time line.
    let preface = match previous.as_deref().map(str::trim_end).filter(|p| !p.is_empty()) {
        Some(p) => format!("{p}{}", separator.unwrap_or_else(|| "\n\n".into())),
        None => String::new(),
    };
    queue::save(&support_dir(), &keystore::queue_key()?, &meta, &segments, &preface)?;
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
    if let Ok(mut slot) = RECORDER.lock() {
        slot.take();
    }
    Ok(())
}

// ----------------------------------------------------------------------------- the queue

#[derive(Serialize)]
pub struct QueueItem {
    visit_id: String,
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
        status: queue::Status::Pending,
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

/// Called after the server confirmed the upload: marks the folder uploaded and shreds it.
#[tauri::command]
async fn queue_complete(visit_id: String) -> Result<(), String> {
    let support = support_dir();
    let _ = queue::mark_uploaded(&support, &keystore::queue_key()?, &visit_id);
    queue::shred_folder(&support, &visit_id)
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            engine_status_cmd, get_settings, set_environment, sign_in_with_google, mfa_step, mfa_finish, mfa_cancel, sign_out, get_access_token,
            refresh_access_token, api_request, start_recording, stop_recording, stop_dictation, cancel_recording,
            queue_list, queue_text, queue_set_text, queue_relabel, queue_complete, queue_discard, choose_transcript_dir, set_transcript_copy_dir, save_transcript_copy, download_document_pdf,
            updater::check_update, updater::install_update, diag_context
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

#[cfg(test)]
mod tests {
    use super::*;

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
            assert_eq!(load_settings().environment, "production");
            store_settings(&Settings { environment: "staging".into(), transcript_copy_dir: None }).unwrap();
            assert_eq!(load_settings().environment, "staging");
            assert!(!fs::read_to_string(settings_path()).unwrap().contains("token"));
        })
    }

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
        assert_eq!(s.environment, "production");
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
