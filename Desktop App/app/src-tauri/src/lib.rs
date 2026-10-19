//! Native side of the spike. It does only what a web page cannot: run the local engines (ffmpeg, whisper.cpp, Ollama) and
//! read and write files in the notes folder. Nothing here sends anything beyond 127.0.0.1.
//!
//! PHI rules (desktop spec SEC-1): no patient names, transcript text or note text in logs or error messages.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
}

fn env_or(key: &str, default: impl Into<String>) -> String {
    std::env::var(key).unwrap_or_else(|_| default.into())
}

fn support_dir() -> PathBuf {
    home().join("Library/Application Support/PracticeNotesSpike")
}

fn whisper_cli() -> String {
    env_or("WHISPER_CLI", "/opt/homebrew/bin/whisper-cli")
}
fn whisper_model() -> String {
    env_or("WHISPER_MODEL", support_dir().join("models/ggml-small.en.bin").to_string_lossy())
}
fn ffmpeg() -> String {
    env_or("FFMPEG", "/opt/homebrew/bin/ffmpeg")
}
fn ollama_url() -> String {
    env_or("OLLAMA_URL", "http://127.0.0.1:11434")
}
pub fn notes_root() -> PathBuf {
    match std::env::var("PRACTICE_NOTES_ROOT") {
        Ok(p) => PathBuf::from(p),
        Err(_) => home().join("Documents/Patient Notes (spike)"),
    }
}

/// A path component must be a plain name: no separators, no "..", no control characters.
pub fn safe_component(name: &str) -> Result<&str, String> {
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || name.chars().any(|c| c == '/' || c == '\\' || c == ':' || c.is_control());
    if bad { Err("invalid name".into()) } else { Ok(name) }
}

/// Overwrites a file with zeros, then removes it. Best effort: an SSD may keep old blocks, which is why the folder
/// should sit on a FileVault disk (desktop spec SEC-4).
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
    fs::create_dir_all(&dir).map_err(|_| "cannot create temp folder".to_string())?;
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

/// Audio bytes -> text using ffmpeg and whisper.cpp. The audio and its converted copy are shredded afterwards.
pub fn transcribe_bytes(audio: &[u8], ext: &str) -> Result<String, String> {
    let ext = if ext.chars().all(|c| c.is_ascii_alphanumeric()) && !ext.is_empty() && ext.len() <= 5 { ext } else { "bin" };
    let dir = temp_dir()?;
    let base = unique("rec");
    let input = dir.join(format!("{base}.{ext}"));
    let wav = dir.join(format!("{base}.wav"));
    fs::write(&input, audio).map_err(|_| "cannot write audio".to_string())?;

    let result = (|| -> Result<String, String> {
        let st = Command::new(ffmpeg())
            .args(["-y", "-loglevel", "error", "-i"])
            .arg(&input)
            .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
            .arg(&wav)
            .status()
            .map_err(|_| "ffmpeg is not installed".to_string())?;
        if !st.success() { return Err("could not read the audio".into()); }
        let out = Command::new(whisper_cli())
            .args(["-m", &whisper_model(), "-nt", "-np", "-l", "en", "-f"])
            .arg(&wav)
            .output()
            .map_err(|_| "whisper.cpp is not installed".to_string())?;
        if !out.status.success() { return Err("transcription failed".into()); }
        Ok(String::from_utf8_lossy(&out.stdout).split_whitespace().collect::<Vec<_>>().join(" "))
    })();

    shred(&input);
    shred(&wav);
    result
}

/// One chat turn with the local model. Low temperature, large context. Returns the reply text.
pub fn llm_chat(model: &str, system: &str, prompt: &str) -> Result<String, String> {
    let body = json!({
        "model": model,
        "stream": false,
        "options": { "temperature": 0.1, "num_ctx": 16384 },
        "messages": [ { "role": "system", "content": system }, { "role": "user", "content": prompt } ],
    });
    let resp = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .post(&format!("{}/api/chat", ollama_url()))
        .send_json(body)
        .map_err(|_| "the local language model is not reachable (is Ollama running?)".to_string())?;
    let v: serde_json::Value = resp.into_json().map_err(|_| "unreadable reply from the language model".to_string())?;
    v["message"]["content"].as_str().map(|s| s.to_string()).ok_or_else(|| "empty reply from the language model".to_string())
}

pub fn save_note_bytes(root: &Path, folder: &str, file: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = root.join(safe_component(folder)?);
    let path = dir.join(safe_component(file)?);
    fs::create_dir_all(&dir).map_err(|_| "cannot create the patient folder".to_string())?;
    // Never overwrite silently (desktop spec DOC-4): the caller picks a free name.
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists { "exists".to_string() } else { "cannot save the note".to_string() }
    })?;
    f.write_all(bytes).and_then(|_| f.sync_all()).map_err(|_| "cannot save the note".to_string())?;
    Ok(path)
}

pub fn list_note_names(root: &Path, folder: &str) -> Result<Vec<String>, String> {
    let dir = root.join(safe_component(folder)?);
    let Ok(rd) = fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".docx") && !n.starts_with('.'))
        .collect();
    names.sort();
    Ok(names)
}

#[derive(Serialize)]
pub struct EngineStatus {
    ffmpeg: bool,
    whisper_cli: bool,
    whisper_model: bool,
    ollama: bool,
    models: Vec<String>,
    notes_root: String,
}

pub fn engine_status() -> EngineStatus {
    let models: Vec<String> = ureq::get(&format!("{}/api/tags", ollama_url()))
        .timeout(std::time::Duration::from_secs(3))
        .call()
        .ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .map(|v| v["models"].as_array().map(|a| a.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect()).unwrap_or_default())
        .unwrap_or_default();
    EngineStatus {
        ffmpeg: Path::new(&ffmpeg()).exists(),
        whisper_cli: Path::new(&whisper_cli()).exists(),
        whisper_model: Path::new(&whisper_model()).exists(),
        ollama: !models.is_empty(),
        models,
        notes_root: notes_root().to_string_lossy().to_string(),
    }
}

fn template_path() -> PathBuf {
    match std::env::var("PRACTICE_TEMPLATES_DIR") {
        Ok(d) => PathBuf::from(d).join("Psychiatric_Master_Template_v2.docx"),
        // Spike: the repo's Templates folder. A real build bundles the template or asks the user for its location.
        Err(_) => Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../Templates/Psychiatric_Master_Template_v2.docx"),
    }
}

// ---- Tauri commands. Audio and documents travel as raw bytes, not JSON number arrays. ----

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
async fn engine_status_cmd() -> EngineStatus {
    engine_status()
}

#[tauri::command]
async fn transcribe(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    transcribe_bytes(&raw(&request)?, &header(&request, "x-ext"))
}

#[tauri::command]
async fn llm_complete(model: String, system: String, prompt: String) -> Result<String, String> {
    llm_chat(&model, &system, &prompt)
}

#[tauri::command]
async fn save_note(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let path = save_note_bytes(&notes_root(), &header(&request, "x-folder"), &header(&request, "x-file"), &raw(&request)?)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn list_notes(folder: String) -> Result<Vec<String>, String> {
    list_note_names(&notes_root(), &folder)
}

#[tauri::command]
async fn read_note(folder: String, file: String) -> Result<tauri::ipc::Response, String> {
    let path = notes_root().join(safe_component(&folder)?).join(safe_component(&file)?);
    fs::read(path).map(tauri::ipc::Response::new).map_err(|_| "cannot read the note".to_string())
}

#[tauri::command]
async fn read_template() -> Result<tauri::ipc::Response, String> {
    fs::read(template_path()).map(tauri::ipc::Response::new).map_err(|_| "template not found".to_string())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![engine_status_cmd, transcribe, llm_complete, save_note, list_notes, read_note, read_template])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_components_are_plain_names() {
        assert!(safe_component("Testcase, Alpha").is_ok());
        assert!(safe_component("2026-10-19 Follow-up.docx").is_ok());
        for bad in ["", ".", "..", "../x", "a/b", "a\\b", ".hidden", "a:b", "a\nb"] {
            assert!(safe_component(bad).is_err(), "{bad:?} should be refused");
        }
    }

    #[test]
    fn save_refuses_to_overwrite_and_stays_inside_the_root() {
        let root = std::env::temp_dir().join(unique("notes-test"));
        let p = save_note_bytes(&root, "Testcase, Alpha", "a.docx", b"one").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"one");
        assert_eq!(save_note_bytes(&root, "Testcase, Alpha", "a.docx", b"two").unwrap_err(), "exists");
        assert!(save_note_bytes(&root, "..", "a.docx", b"x").is_err());
        assert!(save_note_bytes(&root, "ok", "../a.docx", b"x").is_err());
        assert_eq!(list_note_names(&root, "Testcase, Alpha").unwrap(), vec!["a.docx".to_string()]);
        assert!(list_note_names(&root, "Nobody, Here").unwrap().is_empty());
        let _ = fs::remove_dir_all(&root);
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
        let model = std::env::var("SPIKE_MODEL").unwrap_or_else(|_| "qwen2.5:7b-instruct".into());
        let reply = llm_chat(&model, "Answer in one short sentence.", "What is two plus two?").unwrap();
        assert!(reply.contains('4') || reply.to_lowercase().contains("four"), "reply was: {reply}");
    }
}
