//! The transcript queue: one folder per visit under Application Support/PracticeNotes/queue/<visit id>/, holding
//! transcripts.json and metadata.json. The layout follows Meetily's per-meeting folders, without any audio fields:
//! no audio is ever written to disk.
//!
//! Both files are encrypted with AES-256-GCM. The key is random and lives in the macOS Keychain. A folder is kept
//! until the server confirms the upload, then shredded. Transcript text is never logged.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use serde::{Deserialize, Serialize};

const MAGIC: &[u8; 4] = b"PNQ1";
const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Segment {
    pub id: String,
    pub text: String,
    /// Display time from the start of the recording, like "[02:15]".
    pub timestamp: String,
    /// "mic" (the provider) or "system" (the other side of a call).
    pub channel: String,
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub sequence_id: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TranscriptFile {
    pub version: String,
    pub total_segments: usize,
    pub segments: Vec<Segment>,
    /// Text recorded earlier for the same visit (and the separator line), kept in front of the new segments.
    #[serde(default)]
    pub preface: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Pending,
    Uploaded,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Metadata {
    pub version: String,
    pub visit_id: String,
    pub environment: String,
    pub created_at: String,
    pub duration_seconds: f64,
    pub status: Status,
}

pub fn key_to_hex(k: &[u8; 32]) -> String {
    k.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn key_from_hex(s: &str) -> Option<[u8; 32]> {
    let s = s.trim();
    if s.len() != 64 || !s.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// nonce || ciphertext, behind a 4-byte magic.
pub fn encrypt(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "bad key".to_string())?;
    let nonce_bytes = crate::google::random_bytes(NONCE_LEN)?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain)
        .map_err(|_| "could not encrypt the transcript".to_string())?;
    let mut out = Vec::with_capacity(4 + NONCE_LEN + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 4 + NONCE_LEN || &data[..4] != MAGIC {
        return Err("the saved transcript is unreadable".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "bad key".to_string())?;
    cipher
        .decrypt(Nonce::from_slice(&data[4..4 + NONCE_LEN]), &data[4 + NONCE_LEN..])
        .map_err(|_| "the saved transcript could not be decrypted".to_string())
}

pub fn queue_dir(support: &Path) -> PathBuf {
    support.join("queue")
}

fn visit_dir(support: &Path, visit_id: &str) -> Result<PathBuf, String> {
    crate::safe_component(visit_id)?;
    Ok(queue_dir(support).join(visit_id))
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|_| "could not save the transcript on this Mac".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, path).map_err(|_| "could not save the transcript on this Mac".to_string())
}

/// Saves (or replaces) a visit's folder.
pub fn save(support: &Path, key: &[u8; 32], meta: &Metadata, segments: &[Segment], preface: &str) -> Result<(), String> {
    let dir = visit_dir(support, &meta.visit_id)?;
    fs::create_dir_all(&dir).map_err(|_| "could not create the queue folder".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    let tf = TranscriptFile { version: "1.0".into(), total_segments: segments.len(), segments: segments.to_vec(), preface: preface.to_string() };
    let t = serde_json::to_vec_pretty(&tf).map_err(|_| "could not prepare the transcript".to_string())?;
    let m = serde_json::to_vec_pretty(meta).map_err(|_| "could not prepare the transcript".to_string())?;
    write_private(&dir.join("transcripts.json"), &encrypt(key, &t)?)?;
    write_private(&dir.join("metadata.json"), &encrypt(key, &m)?)?;
    Ok(())
}

pub fn read_metadata(support: &Path, key: &[u8; 32], visit_id: &str) -> Result<Metadata, String> {
    let dir = visit_dir(support, visit_id)?;
    let data = fs::read(dir.join("metadata.json")).map_err(|_| "no saved transcript for that visit".to_string())?;
    serde_json::from_slice(&decrypt(key, &data)?).map_err(|_| "the saved transcript is unreadable".to_string())
}

/// The whole saved transcript: any earlier text followed by the newly transcribed segments.
pub fn read_text(support: &Path, key: &[u8; 32], visit_id: &str) -> Result<String, String> {
    let dir = visit_dir(support, visit_id)?;
    let data = fs::read(dir.join("transcripts.json")).map_err(|_| "no saved transcript for that visit".to_string())?;
    let tf: TranscriptFile =
        serde_json::from_slice(&decrypt(key, &data)?).map_err(|_| "the saved transcript is unreadable".to_string())?;
    Ok(format!("{}{}", tf.preface, assemble_text(&tf.segments)))
}

pub fn read_segments(support: &Path, key: &[u8; 32], visit_id: &str) -> Result<Vec<Segment>, String> {
    let dir = visit_dir(support, visit_id)?;
    let data = fs::read(dir.join("transcripts.json")).map_err(|_| "no saved transcript for that visit".to_string())?;
    let tf: TranscriptFile =
        serde_json::from_slice(&decrypt(key, &data)?).map_err(|_| "the saved transcript is unreadable".to_string())?;
    Ok(tf.segments)
}

/// Every folder that has readable metadata, oldest first. Unreadable folders are skipped, not deleted.
pub fn list(support: &Path, key: &[u8; 32]) -> Vec<Metadata> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(queue_dir(support)) {
        for e in rd.flatten() {
            if let Some(name) = e.file_name().to_str() {
                if let Ok(m) = read_metadata(support, key, name) {
                    out.push(m);
                }
            }
        }
    }
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    out
}

pub fn mark_uploaded(support: &Path, key: &[u8; 32], visit_id: &str) -> Result<(), String> {
    let mut m = read_metadata(support, key, visit_id)?;
    m.status = Status::Uploaded;
    let dir = visit_dir(support, visit_id)?;
    let bytes = serde_json::to_vec_pretty(&m).map_err(|_| "could not update the transcript".to_string())?;
    write_private(&dir.join("metadata.json"), &encrypt(key, &bytes)?)
}

/// Overwrites each file with zeros, then removes the folder.
pub fn shred_folder(support: &Path, visit_id: &str) -> Result<(), String> {
    let dir = visit_dir(support, visit_id)?;
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            shred_file(&e.path());
        }
    }
    let _ = fs::remove_dir(&dir);
    Ok(())
}

fn shred_file(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        if let Ok(mut f) = fs::OpenOptions::new().write(true).open(path) {
            let zeros = vec![0u8; 64 * 1024];
            let mut left = meta.len();
            while left > 0 {
                let n = left.min(zeros.len() as u64) as usize;
                if f.write_all(&zeros[..n]).is_err() {
                    break;
                }
                left -= n as u64;
            }
            let _ = f.sync_all();
        }
    }
    let _ = fs::remove_file(path);
}

/// The text sent to the practice app. When both sides of a call were heard the lines are labelled so the note
/// writer knows who spoke; with one channel the text is plain.
pub fn assemble_text(segments: &[Segment]) -> String {
    let both = segments.iter().any(|s| s.channel == "mic") && segments.iter().any(|s| s.channel == "system");
    let mut lines: Vec<String> = Vec::new();
    let mut last: Option<&str> = None;
    for s in segments {
        let text = s.text.trim();
        if text.is_empty() {
            continue;
        }
        if both {
            if last == Some(s.channel.as_str()) {
                if let Some(l) = lines.last_mut() {
                    l.push(' ');
                    l.push_str(text);
                    continue;
                }
            }
            let who = if s.channel == "mic" { "Provider" } else { "Other party" };
            lines.push(format!("{who}: {text}"));
            last = Some(s.channel.as_str());
        } else {
            lines.push(text.to_string());
        }
    }
    lines.join(if both { "\n" } else { " " })
}

/// UTC time as RFC 3339, without pulling in a date crate.
pub fn rfc3339_utc(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, text: &str, ch: &str, s: f64) -> Segment {
        Segment {
            id: id.into(), text: text.into(), timestamp: "[00:00]".into(), channel: ch.into(),
            audio_start_time: Some(s), audio_end_time: Some(s + 1.0), sequence_id: 0,
        }
    }

    fn tmp() -> PathBuf {
        let p = std::env::temp_dir().join(format!("q-test-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn encryption_round_trips_and_rejects_tampering_and_wrong_keys() {
        let key = [7u8; 32];
        let ct = encrypt(&key, b"hello").unwrap();
        assert!(!ct.windows(5).any(|w| w == b"hello"));
        assert_eq!(decrypt(&key, &ct).unwrap(), b"hello");
        assert!(decrypt(&[8u8; 32], &ct).is_err());
        let mut bad = ct.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(decrypt(&key, &bad).is_err());
    }

    #[test]
    fn an_added_recording_keeps_the_earlier_text_in_front() {
        let dir = tmp();
        let key = [4u8; 32];
        let meta = Metadata {
            version: "1.0".into(), visit_id: "v2".into(), environment: "staging".into(),
            created_at: rfc3339_utc(0), duration_seconds: 1.0, status: Status::Pending,
        };
        save(&dir, &key, &meta, &[seg("a", "second part", "mic", 0.0)], "first part\n\n--- added ---\n\n").unwrap();
        assert_eq!(read_text(&dir, &key, "v2").unwrap(), "first part\n\n--- added ---\n\nsecond part");
        save(&dir, &key, &meta, &[], "only earlier text").unwrap();
        assert_eq!(read_text(&dir, &key, "v2").unwrap(), "only earlier text");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_visit_folder_saves_lists_and_is_shredded() {
        let dir = tmp();
        let key = [3u8; 32];
        let meta = Metadata {
            version: "1.0".into(), visit_id: "v1".into(), environment: "staging".into(),
            created_at: rfc3339_utc(0), duration_seconds: 12.5, status: Status::Pending,
        };
        save(&dir, &key, &meta, &[seg("a", "secret words", "mic", 0.0)], "").unwrap();
        let raw = fs::read(dir.join("queue/v1/transcripts.json")).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("secret"));
        let items = list(&dir, &key);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].environment, "staging");
        assert_eq!(read_segments(&dir, &key, "v1").unwrap()[0].text, "secret words");
        mark_uploaded(&dir, &key, "v1").unwrap();
        assert_eq!(read_metadata(&dir, &key, "v1").unwrap().status, Status::Uploaded);
        shred_folder(&dir, "v1").unwrap();
        assert!(!dir.join("queue/v1").exists());
        assert!(save(&dir, &key, &Metadata { visit_id: "../x".into(), ..meta }, &[], "").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn text_is_labelled_only_when_both_sides_spoke() {
        let one = [seg("1", "hello", "mic", 0.0), seg("2", "there", "mic", 2.0)];
        assert_eq!(assemble_text(&one), "hello there");
        let two = [seg("1", "How are you?", "mic", 0.0), seg("2", "Fine.", "system", 2.0), seg("3", "Good.", "system", 3.0)];
        assert_eq!(assemble_text(&two), "Provider: How are you?\nOther party: Fine. Good.");
    }

    #[test]
    fn keys_and_dates_format() {
        let k = [0xabu8; 32];
        assert_eq!(key_from_hex(&key_to_hex(&k)), Some(k));
        assert_eq!(key_from_hex("zz"), None);
        assert_eq!(rfc3339_utc(1_700_000_000), "2023-11-14T22:13:20Z");
    }
}
