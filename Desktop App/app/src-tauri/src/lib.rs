//! Native side of the app. It does only what a web page cannot: run the local engines (whisper.cpp, the language model)
//! and read and write files under the practice's notes folder.
//!
//! PHI rules (desktop spec SEC-1): no patient name, transcript or note text is ever logged. Error messages name the kind
//! of failure, never the content. Nothing here talks to anything beyond 127.0.0.1.
//!
//! Files are laid out as <master folder>/<Last, First>/<YYYY-MM-DD>/ holding the transcript and the generated documents.
//! The audio recording is shredded after transcription (change request 8).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;

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

/// Everything the Setup screen configures (change request 7).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    /// Where notes are written: <master folder>/<Last, First>/<date>/
    pub master_folder: String,
    /// Whose rows to keep from a pasted schedule.
    pub provider_name: String,
    /// The model that writes the notes.
    pub model: String,
    /// Whisper model file used for transcription.
    pub whisper_model: String,
    /// Folder holding the Word templates.
    pub templates_dir: String,
    pub ollama_url: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            master_folder: home().join("Documents/Patient Notes").to_string_lossy().into(),
            provider_name: String::new(),
            model: String::new(),
            whisper_model: support_dir().join("models/ggml-small.en.bin").to_string_lossy().into(),
            templates_dir: default_templates_dir().to_string_lossy().into(),
            ollama_url: "http://127.0.0.1:11434".into(),
        }
    }
}

fn default_templates_dir() -> PathBuf {
    match std::env::var("PRACTICE_TEMPLATES_DIR") {
        Ok(d) => PathBuf::from(d),
        // Development: the repo's Templates folder. A shipped build bundles the templates instead.
        Err(_) => Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../Templates"),
    }
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

fn visit_dir(folder: &str, date: &str) -> Result<PathBuf, String> {
    let s = load_settings();
    if s.master_folder.trim().is_empty() {
        return Err("no notes folder is set".into());
    }
    Ok(PathBuf::from(&s.master_folder).join(safe_component(folder)?).join(safe_component(date)?))
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

/// One chat turn with the local model. Low temperature; the model is kept resident between calls so a long run of
/// section prompts does not pay a reload each time.
pub fn llm_chat(model: &str, system: &str, prompt: &str) -> Result<String, String> {
    let body = json!({
        "model": model,
        "stream": false,
        "think": false,
        "keep_alive": "30m",
        "options": { "temperature": 0.1, "num_ctx": 16384 },
        "messages": [ { "role": "system", "content": system }, { "role": "user", "content": prompt } ],
    });
    let url = format!("{}/api/chat", load_settings().ollama_url);
    let resp = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .post(&url)
        .send_json(body)
        .map_err(|_| "the language model is not reachable (is it running?)".to_string())?;
    let v: serde_json::Value = resp.into_json().map_err(|_| "unreadable reply from the language model".to_string())?;
    v["message"]["content"].as_str().map(|s| s.to_string()).ok_or_else(|| "empty reply from the language model".to_string())
}

// ----------------------------------------------------------------------------- visit files

pub fn write_visit_file(folder: &str, date: &str, file: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = visit_dir(folder, date)?;
    let path = dir.join(safe_component(file)?);
    fs::create_dir_all(&dir).map_err(|_| "cannot create the visit folder".to_string())?;
    // Never overwrite silently: the caller picks a free name.
    let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists { "exists".to_string() } else { "cannot save the file".to_string() }
    })?;
    f.write_all(bytes).and_then(|_| f.sync_all()).map_err(|_| "cannot save the file".to_string())?;
    Ok(path)
}

#[derive(Serialize)]
pub struct VisitFile {
    name: String,
    path: String,
    /// Still marked DRAFT, so it has not been reviewed.
    draft: bool,
}

pub fn list_visit_files(folder: &str, date: &str) -> Result<Vec<VisitFile>, String> {
    let dir = match visit_dir(folder, date) { Ok(d) => d, Err(_) => return Ok(vec![]) };
    let Ok(rd) = fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut out: Vec<VisitFile> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| !n.starts_with('.'))
        .map(|n| VisitFile { draft: n.contains("DRAFT"), path: dir.join(&n).to_string_lossy().into(), name: n })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// The patient's most recent earlier note, for the carry-forward in follow-ups and discharges. Searches the date
/// folders under the patient and takes the newest one before `before`.
#[derive(Serialize, Debug, PartialEq)]
pub struct PriorNote {
    pub date: String,
    pub file: String,
}

pub fn latest_prior_note(folder: &str, before: &str) -> Result<Option<PriorNote>, String> {
    let s = load_settings();
    let patient_dir = PathBuf::from(&s.master_folder).join(safe_component(folder)?);
    let Ok(rd) = fs::read_dir(&patient_dir) else { return Ok(None) };
    let mut dates: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|d| d.len() == 10 && d.as_str() < before)
        .collect();
    dates.sort();
    for date in dates.iter().rev() {
        let mut files: Vec<String> = fs::read_dir(patient_dir.join(date))
            .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".docx")).collect())
            .unwrap_or_default();
        files.sort();
        if let Some(name) = files.first() {
            return Ok(Some(PriorNote { date: date.clone(), file: name.clone() }));
        }
    }
    Ok(None)
}

// ----------------------------------------------------------------------------- schedules

fn schedule_path(date: &str) -> Result<PathBuf, String> {
    let dir = support_dir().join("schedules");
    fs::create_dir_all(&dir).map_err(|_| "cannot create the schedule folder".to_string())?;
    Ok(dir.join(format!("{}.json", safe_component(date)?)))
}

// ----------------------------------------------------------------------------- status

#[derive(Serialize)]
pub struct EngineStatus {
    ffmpeg: bool,
    whisper_cli: bool,
    whisper_model: bool,
    models: Vec<String>,
    settings: Settings,
}

pub fn engine_status() -> EngineStatus {
    let s = load_settings();
    let models: Vec<String> = ureq::get(&format!("{}/api/tags", s.ollama_url))
        .timeout(std::time::Duration::from_secs(3))
        .call().ok()
        .and_then(|r| r.into_json::<serde_json::Value>().ok())
        .map(|v| v["models"].as_array().map(|a| a.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect()).unwrap_or_default())
        .unwrap_or_default();
    EngineStatus {
        ffmpeg: Path::new(&ffmpeg()).exists(),
        whisper_cli: Path::new(&whisper_cli()).exists(),
        whisper_model: Path::new(&s.whisper_model).exists(),
        models,
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

#[tauri::command]
async fn llm_complete(model: String, system: String, prompt: String) -> Result<String, String> {
    llm_chat(&model, &system, &prompt)
}

#[tauri::command]
async fn save_visit_file(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let path = write_visit_file(&header(&request, "x-folder"), &header(&request, "x-date"), &header(&request, "x-file"), &raw(&request)?)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn visit_files(folder: String, date: String) -> Result<Vec<VisitFile>, String> {
    list_visit_files(&folder, &date)
}

#[tauri::command]
async fn read_visit_file(folder: String, date: String, file: String) -> Result<tauri::ipc::Response, String> {
    let path = visit_dir(&folder, &date)?.join(safe_component(&file)?);
    fs::read(path).map(tauri::ipc::Response::new).map_err(|_| "cannot read the file".to_string())
}

/// Names the patient's most recent earlier note. The caller then reads it with read_visit_file; a Tauri command
/// cannot return raw bytes inside a tuple, so the two steps stay separate.
#[tauri::command]
async fn prior_note(folder: String, before: String) -> Result<Option<PriorNote>, String> {
    latest_prior_note(&folder, &before)
}

/// Drops the DRAFT marker from a file name once the provider has reviewed it (change request 6).
#[tauri::command]
async fn mark_reviewed(folder: String, date: String, file: String) -> Result<String, String> {
    let dir = visit_dir(&folder, &date)?;
    let from = dir.join(safe_component(&file)?);
    let renamed = file.replace(" DRAFT", "").replace("DRAFT ", "").replace("DRAFT", "");
    let to = dir.join(safe_component(renamed.trim())?);
    if to.exists() { return Err("a reviewed file of that name already exists".into()); }
    fs::rename(&from, &to).map_err(|_| "could not rename the file".to_string())?;
    Ok(to.to_string_lossy().to_string())
}

#[tauri::command]
async fn read_template(name: String) -> Result<tauri::ipc::Response, String> {
    let file = match name.as_str() {
        "master" => "Psychiatric_Master_Template_v2.docx",
        "progress" => "forms/Psychiatrist_Progress_Note_v1.docx",
        "discharge" => "forms/Physician_Discharge_Order_v1.docx",
        "admit" => "forms/Admit_Outpatient_Program_Order_v1.docx",
        _ => return Err("unknown template".into()),
    };
    let path = PathBuf::from(load_settings().templates_dir).join(file);
    fs::read(path).map(tauri::ipc::Response::new).map_err(|_| format!("template not found: {name}"))
}

#[tauri::command]
async fn save_schedule(date: String, json: String) -> Result<(), String> {
    fs::write(schedule_path(&date)?, json).map_err(|_| "could not save the schedule".to_string())
}

#[tauri::command]
async fn load_schedule(date: String) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(schedule_path(&date)?).ok())
}

/// Shows a file in Finder. Only paths inside the notes folder are allowed.
#[tauri::command]
async fn reveal(path: String) -> Result<(), String> {
    let root = PathBuf::from(load_settings().master_folder);
    let p = PathBuf::from(&path);
    if !p.starts_with(&root) { return Err("that file is outside the notes folder".into()); }
    Command::new("open").arg("-R").arg(&p).status().map_err(|_| "could not open Finder".to_string())?;
    Ok(())
}

/// Opens a file with its default application (Word for a .docx). Restricted to the notes folder.
#[tauri::command]
async fn open_file(path: String) -> Result<(), String> {
    let root = PathBuf::from(load_settings().master_folder);
    let p = PathBuf::from(&path);
    if !p.starts_with(&root) { return Err("that file is outside the notes folder".into()); }
    Command::new("open").arg(&p).status().map_err(|_| "could not open the file".to_string())?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            engine_status_cmd, get_settings, set_settings, transcribe, llm_complete,
            save_visit_file, visit_files, read_visit_file, prior_note, mark_reviewed,
            read_template, save_schedule, load_schedule, reveal, open_file
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
        let s = Settings { master_folder: root.join("notes").to_string_lossy().into(), ..Settings::default() };
        store_settings(&s).unwrap();
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
    fn visit_files_live_under_patient_and_date_and_are_never_overwritten() {
        with_temp_root(|| {
            let p = write_visit_file("Testcase, Alpha", "2026-10-29", "note.docx", b"one").unwrap();
            assert!(p.to_string_lossy().contains("Testcase, Alpha/2026-10-29/note.docx"));
            assert_eq!(write_visit_file("Testcase, Alpha", "2026-10-29", "note.docx", b"two").unwrap_err(), "exists");
            assert!(write_visit_file("..", "2026-10-29", "a.docx", b"x").is_err());
            assert!(write_visit_file("ok", "../2026", "a.docx", b"x").is_err());

            let files = list_visit_files("Testcase, Alpha", "2026-10-29").unwrap();
            assert_eq!(files.len(), 1);
            assert!(!files[0].draft);
            assert!(list_visit_files("Nobody, Here", "2026-10-29").unwrap().is_empty());
        })
    }

    #[test]
    fn a_draft_file_is_marked_as_one() {
        with_temp_root(|| {
            write_visit_file("Testcase, Alpha", "2026-10-29", "Testcase, Alpha 2026-10-29 Follow-up DRAFT.docx", b"x").unwrap();
            let files = list_visit_files("Testcase, Alpha", "2026-10-29").unwrap();
            assert!(files[0].draft);
        })
    }

    #[test]
    fn prior_note_finds_the_newest_earlier_visit() {
        with_temp_root(|| {
            write_visit_file("Testcase, Alpha", "2026-10-01", "a.docx", b"older").unwrap();
            write_visit_file("Testcase, Alpha", "2026-10-15", "b.docx", b"newer").unwrap();
            write_visit_file("Testcase, Alpha", "2026-10-29", "c.docx", b"today").unwrap();
            let prior = latest_prior_note("Testcase, Alpha", "2026-10-29").unwrap().unwrap();
            assert_eq!(prior, PriorNote { date: "2026-10-15".into(), file: "b.docx".into() });
            // Nothing earlier than the first visit, and nothing at all for an unknown patient.
            assert!(latest_prior_note("Testcase, Alpha", "2026-10-01").unwrap().is_none());
            assert!(latest_prior_note("Nobody, Here", "2026-10-29").unwrap().is_none());
        })
    }

    #[test]
    fn settings_round_trip_and_fall_back_to_defaults() {
        with_temp_root(|| {
            let mut s = load_settings();
            s.provider_name = "Dr. Example".into();
            s.model = "qwen2.5:14b-instruct".into();
            store_settings(&s).unwrap();
            let back = load_settings();
            assert_eq!(back.provider_name, "Dr. Example");
            assert_eq!(back.model, "qwen2.5:14b-instruct");
            assert!(!back.master_folder.is_empty());
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
        let model = std::env::var("SPIKE_MODEL").unwrap_or_else(|_| "qwen2.5:14b-instruct".into());
        let reply = llm_chat(&model, "Answer in one short sentence.", "What is two plus two?").unwrap();
        assert!(reply.contains('4') || reply.to_lowercase().contains("four"), "reply was: {reply}");
    }
}
