//! Local-first recording. While a visit is recorded, the words spoken so far are transcribed in the background every
//! ~30 seconds and written (encrypted) to `journal/<recording id>/journal.json`. Audio is never written. If the app,
//! the Mac or the connection dies mid-visit, at most the last half minute is lost and the rest is recovered at the next
//! launch. Finish then only transcribes the tail and closes the file; it needs no network.
use crate::capture::{Channels, SAMPLE_RATE};
use crate::queue::{self, Segment};
use crate::transcribe;
use serde::{Deserialize, Serialize};
use std::fs;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Journal {
    pub recording_id: String,
    /// The visit the recording was started on (a folder name for the queue, and the link on the server).
    pub visit_id: String,
    pub environment: String,
    pub created_at: String,
    /// True when this recording adds to an earlier transcript of the visit: a recovered one is not linked automatically,
    /// because linking would replace the earlier text.
    pub append: bool,
    pub done_mic: usize,
    pub done_sys: usize,
    pub segments: Vec<Segment>,
    pub seq: u32,
}

/// A version 4 UUID from the operating system's random source.
pub fn new_uuid() -> String {
    let mut b = [0u8; 16];
    let ok = fs::File::open("/dev/urandom").and_then(|mut f| std::io::Read::read_exact(&mut f, &mut b)).is_ok();
    if !ok {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        for (i, x) in b.iter_mut().enumerate() { *x = ((n >> ((i % 16) * 8)) as u8) ^ (i as u8).wrapping_mul(37); }
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

pub fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().enumerate().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

fn dir(support: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_uuid(id) { return Err("bad recording id".into()); }
    Ok(support.join("journal").join(id))
}

impl Journal {
    pub fn save(&self, support: &Path, key: &[u8; 32]) -> Result<(), String> {
        let d = dir(support, &self.recording_id)?;
        fs::create_dir_all(&d).map_err(|_| "could not save the recording on this Mac".to_string())?;
        let bytes = serde_json::to_vec(self).map_err(|_| "could not save the recording on this Mac".to_string())?;
        queue::write_private(&d.join("journal.json"), &queue::encrypt(key, &bytes)?)
    }

    pub fn load(support: &Path, key: &[u8; 32], id: &str) -> Result<Self, String> {
        let data = fs::read(dir(support, id)?.join("journal.json")).map_err(|_| "no such recording".to_string())?;
        serde_json::from_slice(&queue::decrypt(key, &data)?).map_err(|_| "the saved recording is unreadable".to_string())
    }

    pub fn remove(support: &Path, id: &str) {
        if let Ok(d) = dir(support, id) {
            if let Ok(rd) = fs::read_dir(&d) { for e in rd.flatten() { let _ = fs::write(e.path(), []); } }
            let _ = fs::remove_dir_all(d);
        }
    }

    /// Plain text of what is known so far (provisional speaker labels by channel).
    pub fn text(&self) -> String {
        let mut segs = self.segments.clone();
        for s in segs.iter_mut() { s.speaker = (if s.channel == "mic" { "Provider" } else { "Patient" }).into(); }
        queue::assemble_text(&segs)
    }
}

/// Ids of journals left on disk (a crash, a power cut, a force-quit), oldest first.
pub fn leftovers(support: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(support.join("journal")).map(|rd| rd.flatten().filter_map(|e| e.file_name().into_string().ok()).filter(|n| is_uuid(n)).collect()).unwrap_or_default();
    v.sort();
    v
}

/// The next part of a channel worth transcribing: whole chunks only, never the still-growing end. None until a full
/// chunk (CHUNK_SECS) plus a little more has arrived.
pub fn next_window(done: usize, available: usize) -> Option<Range<usize>> {
    let need = (transcribe::CHUNK_SECS + 2) * SAMPLE_RATE as usize;
    if available < done + need { return None; }
    Some(done..available)
}

/// Turns every leftover journal (except the one being recorded now) into a pending queue item so it uploads like any
/// other recording. Returns how many were recovered. Speakers are labelled by channel (a single microphone: Provider).
pub fn recover(support: &Path, key: &[u8; 32], active: Option<&str>) -> usize {
    let mut n = 0;
    for id in leftovers(support) {
        if active == Some(id.as_str()) { continue; }
        let Ok(j) = Journal::load(support, key, &id) else { continue }; // unreadable: left alone, never deleted
        if j.segments.is_empty() { Journal::remove(support, &id); continue; }
        let mut segs = j.segments.clone();
        for s in segs.iter_mut() { s.speaker = (if s.channel == "mic" { "Provider" } else { "Patient" }).into(); }
        let folder_taken = queue::queue_dir(support).join(&j.visit_id).exists();
        let by_hand = j.append || folder_taken || crate::safe_component(&j.visit_id).is_err();
        let folder = if by_hand { j.recording_id.clone() } else { j.visit_id.clone() };
        let secs = segs.iter().filter_map(|s| s.audio_end_time).fold(0.0, f64::max);
        let meta = queue::Metadata {
            version: "1.0".into(), visit_id: folder, environment: j.environment.clone(), created_at: j.created_at.clone(),
            duration_seconds: secs, status: queue::Status::Pending, recording_id: Some(j.recording_id.clone()),
            link_visit: if by_hand { None } else { Some(j.visit_id.clone()) }, confirmed_at: None,
        };
        let note = "[Recovered after the app closed unexpectedly; the last seconds may be missing.]\n\n";
        if queue::save(support, key, &meta, &segs, note).is_ok() {
            Journal::remove(support, &id);
            n += 1;
        }
    }
    n
}

/// What the checkpoint thread shares with the commands.
pub struct Live {
    pub journal: Mutex<Journal>,
    pub stop: AtomicBool,
}

pub fn start(app_model: PathBuf, support: PathBuf, key: [u8; 32], shared: Arc<Mutex<Channels>>, live: Arc<Live>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut engine: Option<transcribe::Engine> = None;
        let _ = live.journal.lock().map(|j| j.save(&support, &key));
        while !live.stop.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if live.stop.load(Ordering::SeqCst) { break; }
            for channel in ["mic", "system"] {
                let (done, window) = {
                    let j = match live.journal.lock() { Ok(j) => j, Err(_) => return };
                    let done = if channel == "mic" { j.done_mic } else { j.done_sys };
                    let avail = match shared.lock() { Ok(c) => if channel == "mic" { c.mic.len() } else { c.system.len() }, Err(_) => return };
                    (done, next_window(done, avail))
                };
                let Some(range) = window else { continue };
                // Cut the window at the planned chunk end, so a word is not split; only the first chunk per round.
                let samples: Vec<i16> = match shared.lock() { Ok(c) => { let src = if channel == "mic" { &c.mic } else { &c.system }; src[range.clone()].to_vec() }, Err(_) => return };
                let chunks = transcribe::plan_chunks(&samples, transcribe::CHUNK_SECS * SAMPLE_RATE as usize, transcribe::SEEK_BACK_SECS * SAMPLE_RATE as usize);
                let Some(first) = chunks.first().cloned() else { continue };
                if engine.is_none() { engine = transcribe::Engine::load(&app_model).ok(); }
                let Some(eng) = engine.as_mut() else { continue };
                let part = &samples[first.clone()];
                let new = transcribe::transcribe_channel_at(channel, part, range.start, |c| eng.run(c));
                let Ok(new) = new else { continue };
                if let Ok(mut j) = live.journal.lock() {
                    if channel == "mic" { j.done_mic = range.start + first.end; } else { j.done_sys = range.start + first.end; }
                    j.segments.extend(new);
                    j.segments = transcribe::merge_channels(std::mem::take(&mut j.segments));
                    j.seq += 1;
                    let _ = j.save(&support, &key);
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(n: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bbc-journal-{n}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn sample(id: &str) -> Journal {
        Journal { recording_id: id.into(), visit_id: "v1".into(), environment: "production".into(), created_at: "2026-11-18T10:00:00Z".into(),
            append: false, done_mic: 480000, done_sys: 0, seq: 2,
            segments: vec![Segment { id: "s".into(), text: "made-up words".into(), timestamp: "[00:01]".into(), channel: "mic".into(), speaker: String::new(), audio_start_time: Some(1.0), audio_end_time: Some(2.0), sequence_id: 0 }] }
    }

    #[test]
    fn uuid_is_v4_and_unique() {
        let a = new_uuid(); let b = new_uuid();
        assert!(is_uuid(&a)); assert_ne!(a, b);
        assert_eq!(a.as_bytes()[14], b'4');
        assert!(!is_uuid("../../etc")); assert!(!is_uuid("not-a-uuid"));
    }

    #[test]
    fn a_killed_app_leaves_a_journal_that_reads_back_and_is_encrypted() {
        let d = tmp("kill"); let key = [9u8; 32];
        let id = new_uuid();
        sample(&id).save(&d, &key).unwrap();
        // "restart": nothing in memory, only the folder
        assert_eq!(leftovers(&d), vec![id.clone()]);
        let j = Journal::load(&d, &key, &id).unwrap();
        assert_eq!(j.segments[0].text, "made-up words");
        assert!(j.text().contains("Provider: made-up words"));
        let raw = fs::read(d.join("journal").join(&id).join("journal.json")).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("made-up"));
        Journal::remove(&d, &id);
        assert!(leftovers(&d).is_empty());
    }

    #[test]
    fn a_corrupted_or_foreign_journal_is_refused_not_trusted() {
        let d = tmp("bad"); let key = [9u8; 32];
        let id = new_uuid();
        sample(&id).save(&d, &key).unwrap();
        let f = d.join("journal").join(&id).join("journal.json");
        let mut raw = fs::read(&f).unwrap(); let n = raw.len(); raw[n - 3] ^= 0xff; fs::write(&f, raw).unwrap();
        assert!(Journal::load(&d, &key, &id).is_err());
        assert!(Journal::load(&d, &[1u8; 32], &id).is_err());
        assert!(Journal::load(&d, &key, "../x").is_err());
    }

    #[test]
    fn recovery_makes_a_pending_queue_item_and_clears_the_journal() {
        let d = tmp("rec"); let key = [7u8; 32];
        let id = new_uuid();
        sample(&id).save(&d, &key).unwrap();
        assert_eq!(recover(&d, &key, Some(&id)), 0, "the recording in progress is left alone");
        assert_eq!(recover(&d, &key, None), 1);
        assert!(leftovers(&d).is_empty());
        let m = queue::read_metadata(&d, &key, "v1").unwrap();
        assert_eq!(m.recording_id.as_deref(), Some(id.as_str()));
        assert_eq!(m.link_visit.as_deref(), Some("v1"));
        assert!(queue::read_text(&d, &key, "v1").unwrap().contains("Recovered after the app closed"));
        // a second crashed recording for the same visit must not overwrite the first: it waits for linking by hand
        let id2 = new_uuid();
        sample(&id2).save(&d, &key).unwrap();
        assert_eq!(recover(&d, &key, None), 1);
        let m2 = queue::read_metadata(&d, &key, &id2).unwrap();
        assert_eq!(m2.link_visit, None);
        assert!(queue::read_metadata(&d, &key, "v1").is_ok());
    }

    #[test]
    fn windows_wait_for_a_full_chunk() {
        let r = SAMPLE_RATE as usize;
        assert!(next_window(0, 10 * r).is_none());
        assert!(next_window(0, 31 * r).is_some());
        assert!(next_window(31 * r, 40 * r).is_none());
    }
}
