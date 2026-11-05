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
}

impl Default for Settings {
    fn default() -> Self {
        Self { environment: "production".into() }
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
    let (access, refresh) = (text("access_token"), text("refresh_token"));
    let legacy = match (&url_env, access.is_empty()) {
        (Some(env), false) => Some(Legacy { env: env.clone(), access: access.clone(), refresh: refresh.clone() }),
        _ => None,
    };
    let dirty = ["practice_url", "access_token", "refresh_token", "whisper_model"].iter().any(|k| v.get(*k).is_some());
    (Settings { environment }, legacy, dirty)
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
    let s = Settings { environment };
    store_settings(&s)?;
    Ok(s)
}

/// Signs in with Google against the named environment and stores the tokens in the Keychain.
#[tauri::command]
async fn sign_in_with_google(environment: String) -> Result<(), String> {
    let url = env_url(&environment)?;
    let tokens = tauri::async_runtime::spawn_blocking(move || google::sign_in(url))
        .await
        .map_err(|_| "sign-in failed".to_string())??;
    keystore::store_tokens(&environment, &keystore::Tokens { access: tokens.access_token, refresh: tokens.refresh_token })
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
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Ends the recording, transcribes it here, and saves the transcript in the encrypted queue under the visit's id.
/// The audio exists only in memory and is dropped when this returns.
#[tauri::command]
async fn stop_recording(app: tauri::AppHandle, visit_id: String, environment: String) -> Result<StopResult, String> {
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
    let summary = StopResult { seconds, system_audio: !channels.system.is_empty(), one_sided: channels.one_sided() };
    let model = find_model(&app).ok_or("the transcription model is missing")?;
    let segments = tauri::async_runtime::spawn_blocking(move || transcribe::transcribe(&model, &channels.mic, &channels.system))
        .await
        .map_err(|_| "transcription failed".to_string())??;
    if segments.is_empty() {
        return Err("The recording produced no text.".into());
    }
    let meta = queue::Metadata {
        version: "1.0".into(),
        visit_id,
        environment,
        created_at: queue::rfc3339_utc(now_unix()),
        duration_seconds: seconds as f64,
        status: queue::Status::Pending,
    };
    queue::save(&support_dir(), &keystore::queue_key()?, &meta, &segments)?;
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
    let segments = queue::read_segments(&support_dir(), &keystore::queue_key()?, &visit_id)?;
    Ok(queue::assemble_text(&segments))
}

/// Called after the server confirmed the upload: marks the folder uploaded and shreds it.
#[tauri::command]
async fn queue_complete(visit_id: String) -> Result<(), String> {
    let support = support_dir();
    let _ = queue::mark_uploaded(&support, &keystore::queue_key()?, &visit_id);
    queue::shred_folder(&support, &visit_id)
}

/// Deletes a queued transcript the provider chose not to send.
#[tauri::command]
async fn queue_discard(visit_id: String) -> Result<(), String> {
    queue::shred_folder(&support_dir(), &visit_id)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            engine_status_cmd, get_settings, set_environment, sign_in_with_google, sign_out, get_access_token,
            refresh_access_token, api_request, start_recording, stop_recording, stop_dictation, cancel_recording,
            queue_list, queue_text, queue_complete, queue_discard
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
            store_settings(&Settings { environment: "staging".into() }).unwrap();
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
