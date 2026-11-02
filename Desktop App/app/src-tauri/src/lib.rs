//! Native side of the recorder. It does the two things a web page cannot on macOS: capture audio (including, in
//! time, the system audio of a telehealth call) and run the transcription engine locally.
//!
//! PHI rules (desktop spec SEC-1): no patient name, transcript or note text is ever logged. Error messages name the kind
//! of failure, never the content. Nothing here talks to anything beyond 127.0.0.1.
//!
//! The recorder holds nothing: it pulls the day's visits from the practice app, records, transcribes here, and pushes
//! the text back. The audio is shredded after transcription and never leaves this Mac.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

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

/// Everything the Setup screen configures. The recorder holds no patient data of its own.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    /// Where the practice app runs.
    pub practice_url: String,
    /// Token issued by the practice app. Treated like a password: never logged.
    pub access_token: String,
    /// Whisper model file used for transcription.
    pub whisper_model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            practice_url: String::new(),
            access_token: String::new(),
            whisper_model: find_whisper_model(),
        }
    }
}

/// Looks for an already-downloaded Whisper model, so a fresh install usually needs no setup for transcription.
/// The first existing file wins; otherwise the default location is offered for the user to download into.
fn find_whisper_model() -> String {
    let app = support_dir().join("models");
    let lib = home().join("Library/Application Support");
    let candidates = [
        app.join("ggml-small.en.bin"),
        lib.join("PracticeNotesSpike/models/ggml-small.en.bin"),
        lib.join("PracticeNotes/models/ggml-small.en.bin"),
        home().join("models/ggml-small.en.bin"),
        PathBuf::from("/opt/homebrew/share/whisper.cpp/models/ggml-small.en.bin"),
    ];
    candidates
        .iter()
        .find(|p| p.exists())
        .unwrap_or(&candidates[0])
        .to_string_lossy()
        .into()
}

pub fn load_settings() -> Settings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
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

// ----------------------------------------------------------------------------- engines

fn env_or(key: &str, default: impl Into<String>) -> String {
    std::env::var(key).unwrap_or_else(|_| default.into())
}
fn whisper_cli() -> String {
    env_or("WHISPER_CLI", "/opt/homebrew/bin/whisper-cli")
}
fn ffmpeg() -> String {
    env_or("FFMPEG", "/opt/homebrew/bin/ffmpeg")
}

/// Overwrites a file with zeros, then removes it. Best effort: an SSD may keep old blocks, which is why the notes
/// folder should sit on a FileVault disk (desktop spec SEC-4).
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

fn temp_dir() -> Result<PathBuf, String> {
    let dir = support_dir().join("tmp");
    fs::create_dir_all(&dir).map_err(|_| "cannot create the temporary folder".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    Ok(dir)
}

fn unique(prefix: &str) -> String {
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{prefix}-{}-{t}", std::process::id())
}

/// Audio bytes to text. Both the audio and its converted copy are shredded afterwards; only the transcript survives.
pub fn transcribe_bytes(audio: &[u8], ext: &str) -> Result<String, String> {
    let ext = if ext.chars().all(|c| c.is_ascii_alphanumeric()) && !ext.is_empty() && ext.len() <= 5 { ext } else { "bin" };
    let dir = temp_dir()?;
    let base = unique("rec");
    let input = dir.join(format!("{base}.{ext}"));
    let wav = dir.join(format!("{base}.wav"));
    fs::write(&input, audio).map_err(|_| "cannot write the audio to disk".to_string())?;

    let model = load_settings().whisper_model;
    let result = (|| -> Result<String, String> {
        let st = Command::new(ffmpeg())
            .args(["-y", "-loglevel", "error", "-i"]).arg(&input)
            .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]).arg(&wav)
            .status().map_err(|_| "ffmpeg is not installed".to_string())?;
        if !st.success() { return Err("could not read the audio".into()); }
        if !Path::new(&model).exists() { return Err("the transcription model is missing; set it in Setup".into()); }
        let out = Command::new(whisper_cli())
            .args(["-m", &model, "-nt", "-np", "-l", "en", "-f"]).arg(&wav)
            .output().map_err(|_| "whisper.cpp is not installed".to_string())?;
        if !out.status.success() { return Err("transcription failed".into()); }
        Ok(String::from_utf8_lossy(&out.stdout).split_whitespace().collect::<Vec<_>>().join(" "))
    })();

    shred(&input);
    shred(&wav);
    result
}

// ----------------------------------------------------------------------------- status

#[derive(Serialize)]
pub struct EngineStatus {
    ffmpeg: bool,
    whisper_cli: bool,
    whisper_model: bool,
    settings: Settings,
}

pub fn engine_status() -> EngineStatus {
    let s = load_settings();
    EngineStatus {
        ffmpeg: Path::new(&ffmpeg()).exists(),
        whisper_cli: Path::new(&whisper_cli()).exists(),
        whisper_model: Path::new(&s.whisper_model).exists(),
        settings: s,
    }
}

// ----------------------------------------------------------------------------- Tauri commands

fn raw(request: &tauri::ipc::Request) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err("expected raw bytes".into()),
    }
}
fn header(request: &tauri::ipc::Request, name: &str) -> String {
    request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string()
}

#[tauri::command]
async fn engine_status_cmd() -> EngineStatus { engine_status() }

#[tauri::command]
async fn get_settings() -> Settings { load_settings() }

#[tauri::command]
async fn set_settings(settings: Settings) -> Result<Settings, String> {
    store_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
async fn transcribe(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    transcribe_bytes(&raw(&request)?, &header(&request, "x-ext"))
}

/// Names the patient's most recent earlier note. The caller then reads it with read_visit_file; a Tauri command
/// cannot return raw bytes inside a tuple, so the two steps stay separate.
/// Drops the DRAFT marker from a file name once the provider has reviewed it (change request 6).
/// Shows a file in Finder. Only paths inside the notes folder are allowed.
/// Opens a file with its default application (Word for a .docx). Restricted to the notes folder.
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            engine_status_cmd, get_settings, set_settings, transcribe
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each test gets its own app directory and notes folder, so none of them touch a real one.
    /// The settings path comes from a process-wide environment variable, so these tests must not run at the same
    /// time as each other; Rust runs tests in parallel threads by default, which otherwise mixes their folders up.
    static ROOT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn with_temp_root<T>(f: impl FnOnce() -> T) -> T {
        let guard = ROOT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let root = std::env::temp_dir().join(unique("notes-test"));
        std::env::set_var("PRACTICE_APP_DIR", root.join("app").to_string_lossy().to_string());
        store_settings(&Settings::default()).unwrap();
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
    fn settings_round_trip_and_fall_back_to_defaults() {
        with_temp_root(|| {
            let mut s = load_settings();
            s.practice_url = "https://notes.example.test".into();
            s.access_token = "secret".into();
            store_settings(&s).unwrap();
            let back = load_settings();
            assert_eq!(back.practice_url, "https://notes.example.test");
            assert_eq!(back.access_token, "secret");
            assert!(!back.whisper_model.is_empty());
        })
    }

    #[test]
    fn shred_removes_the_file() {
        let p = std::env::temp_dir().join(unique("shred"));
        fs::write(&p, vec![7u8; 100_000]).unwrap();
        shred(&p);
        assert!(!p.exists());
    }

    /// Real engines, synthetic speech. Run with: cargo test -- --ignored
    #[test]
    #[ignore]
    fn real_transcription_and_model() {
        let wav = std::env::var("SPIKE_AUDIO").expect("set SPIKE_AUDIO to a synthetic audio file");
        let text = transcribe_bytes(&fs::read(wav).unwrap(), "aiff").unwrap();
        assert!(text.to_lowercase().contains("sleep"), "transcript was: {text}");
    }
}
