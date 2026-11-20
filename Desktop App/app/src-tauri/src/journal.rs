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
    /// For an appended recording: the visit's earlier transcript as it was when recording began, and the time line that
    /// goes after it. Kept so a crashed recording can be rebuilt as OLD + separator + NEW instead of NEW alone.
    #[serde(default)]
    pub earlier: String,
    #[serde(default)]
    pub separator: String,
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
        // An appended recording is rebuilt with the earlier text in front, so it can be linked without replacing it with
        // less. A journal with no earlier text (older app, or none could be read) still waits for linking by hand.
        let rebuilt = j.append && !j.earlier.trim().is_empty();
        let safe_id = crate::safe_component(&j.visit_id).is_ok();
        // The queue folder is the visit's own only when nothing else uses it; otherwise it is the recording's id. The
        // folder name never decides the link: a rebuilt append carries the earlier text, so it is linked even when the
        // visit's folder is taken (an earlier sent copy still waits to be swept).
        let own_folder = !folder_taken && safe_id && (!j.append || rebuilt);
        let folder = if own_folder { j.visit_id.clone() } else { j.recording_id.clone() };
        let link = safe_id && (rebuilt || (!j.append && !folder_taken));
        let secs = segs.iter().filter_map(|s| s.audio_end_time).fold(0.0, f64::max);
        let meta = queue::Metadata {
            version: "1.0".into(), visit_id: folder, environment: j.environment.clone(), created_at: j.created_at.clone(),
            duration_seconds: secs, status: queue::Status::Pending, recording_id: Some(j.recording_id.clone()),
            link_visit: if link { Some(j.visit_id.clone()) } else { None }, confirmed_at: None,
        };
        let note = "[Recovered after the app closed unexpectedly; the last seconds may be missing.]\n\n";
        let preface = if rebuilt {
            let sep = if j.separator.is_empty() { "\n\n" } else { j.separator.as_str() };
            format!("{}{}{}", j.earlier.trim_end(), sep, note)
        } else { note.to_string() };
        if queue::save(support, key, &meta, &segs, &preface).is_ok() {
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
            append: false, earlier: String::new(), separator: String::new(), done_mic: 480000, done_sys: 0, seq: 2,
            segments: vec![Segment { id: "s".into(), text: "made-up words".into(), timestamp: "[00:01]".into(), channel: "mic".into(), speaker: String::new(), audio_start_time: Some(1.0), audio_end_time: Some(2.0), sequence_id: 0 }] }
    }

    /// Real-model check (run by hand: needs the downloaded model and /tmp/ckpt/*.wav). Feeds audio in real time like the
    /// microphone, never stops the recording (a kill -9), and reads the journal back: is the EARLY speech kept?
    #[test]
    #[ignore]
    fn early_speech_survives_a_kill_after_a_long_recording() {
        let model = PathBuf::from(std::env::var("CKPT_MODEL").expect("CKPT_MODEL"));
        let secs: usize = std::env::var("CKPT_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(150);
        let read = |p: &str| -> Vec<i16> { hound::WavReader::open(p).unwrap().samples::<i16>().map(|s| s.unwrap()).collect() };
        let (marker, filler) = (read("/tmp/ckpt/marker.wav"), read("/tmp/ckpt/filler.wav"));
        let sr = SAMPLE_RATE as usize;
        let mut audio = vec![0i16; 3 * sr];
        audio.extend(&marker);
        while audio.len() < secs * sr { audio.extend(vec![0i16; 4 * sr]); audio.extend(&filler); }
        let d = tmp("real"); let key = [5u8; 32];
        let id = new_uuid();
        let shared = Arc::new(Mutex::new(Channels { mic: Vec::new(), system: Vec::new() }));
        let live = Arc::new(Live { journal: Mutex::new(Journal { recording_id: id.clone(), visit_id: "v1".into(), environment: "staging".into(),
            created_at: "2026-11-19T00:00:00Z".into(), append: false, earlier: String::new(), separator: String::new(), done_mic: 0, done_sys: 0, segments: Vec::new(), seq: 0 }),
            stop: AtomicBool::new(false) });
        let _h = start(model, d.clone(), key, Arc::clone(&shared), Arc::clone(&live));
        for sec in 0..secs {
            { let mut c = shared.lock().unwrap(); c.mic.extend(&audio[sec * sr..((sec + 1) * sr).min(audio.len())]); }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
        // "kill -9": do not stop; read only what is on disk
        let j = Journal::load(&d, &key, &id).unwrap();
        let first = j.segments.first().map(|s| s.timestamp.clone()).unwrap_or_default();
        println!("RESULT segments={} first={} done_mic_secs={} text_start={:?}", j.segments.len(), first, j.done_mic / sr, j.text().chars().take(160).collect::<String>());
        assert!(j.text().to_lowercase().contains("heron"), "the early marker was lost: {}", j.text());
    }

    /// Real-model check for pause: speech, then a pause (no audio reaches the buffers, exactly what the paused capture
    /// sinks do), then a kill -9 DURING the pause. The speech before the pause must be on disk, and the pause must add
    /// nothing. Run by hand: needs CKPT_MODEL and /tmp/ckpt/*.wav.
    #[test]
    #[ignore]
    fn speech_before_a_pause_survives_a_kill_during_the_pause() {
        let model = PathBuf::from(std::env::var("CKPT_MODEL").expect("CKPT_MODEL"));
        let read = |p: &str| -> Vec<i16> { hound::WavReader::open(p).unwrap().samples::<i16>().map(|s| s.unwrap()).collect() };
        let (marker, filler) = (read("/tmp/ckpt/marker.wav"), read("/tmp/ckpt/filler.wav"));
        let sr = SAMPLE_RATE as usize;
        let mut audio = vec![0i16; 2 * sr];
        audio.extend(&marker);
        while audio.len() < 50 * sr { audio.extend(vec![0i16; 3 * sr]); audio.extend(&filler); }
        let d = tmp("pause"); let key = [6u8; 32];
        let id = new_uuid();
        let shared = Arc::new(Mutex::new(Channels { mic: Vec::new(), system: Vec::new() }));
        let live = Arc::new(Live { journal: Mutex::new(Journal { recording_id: id.clone(), visit_id: "v1".into(), environment: "staging".into(),
            created_at: "2026-11-20T00:00:00Z".into(), append: false, earlier: String::new(), separator: String::new(), done_mic: 0, done_sys: 0, segments: Vec::new(), seq: 0 }),
            stop: AtomicBool::new(false) });
        let _h = start(model, d.clone(), key, Arc::clone(&shared), Arc::clone(&live));
        for sec in 0..50 {   // speaking
            { let mut c = shared.lock().unwrap(); c.mic.extend(&audio[sec * sr..((sec + 1) * sr).min(audio.len())]); }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
        let before = shared.lock().unwrap().mic.len();
        for _ in 0..45 { std::thread::sleep(std::time::Duration::from_secs(1)); }   // paused: the sinks drop audio, buffers do not grow
        assert_eq!(shared.lock().unwrap().mic.len(), before);
        // "kill -9" during the pause: do not stop; read only what is on disk
        let j = Journal::load(&d, &key, &id).unwrap();
        println!("RESULT segments={} done_mic_secs={} text_start={:?}", j.segments.len(), j.done_mic / sr, j.text().chars().take(160).collect::<String>());
        assert!(j.text().to_lowercase().contains("heron"), "speech from before the pause was lost: {}", j.text());
        assert!(j.done_mic <= before, "the journal claims more audio than was recorded");
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
    fn a_crashed_append_is_rebuilt_with_the_earlier_text_and_linked() {
        let d = tmp("app1"); let key = [7u8; 32];
        let id = new_uuid();
        let mut j = sample(&id);
        j.append = true; j.earlier = "Earlier visit text.\n".into(); j.separator = "\n\n--- Added 3:04 PM ---\n\n".into();
        j.save(&d, &key).unwrap();
        assert_eq!(recover(&d, &key, None), 1);
        let m = queue::read_metadata(&d, &key, "v1").unwrap();
        assert_eq!(m.link_visit.as_deref(), Some("v1"), "linkable: it carries the earlier text");
        let t = queue::read_text(&d, &key, "v1").unwrap();
        let (a, b, c) = (t.find("Earlier visit text."), t.find("--- Added 3:04 PM ---"), t.find("made-up words"));
        assert!(a.is_some() && b.is_some() && c.is_some() && a < b && b < c, "OLD, then the time line, then NEW: {t}");
        assert!(t.contains("Recovered after the app closed"));
    }

    #[test]
    fn a_crashed_append_is_rebuilt_and_linked_even_when_the_visit_queue_folder_is_taken() {
        // Real case (item 10b): the visit's earlier copy was sent but its queue folder still waits to be swept.
        let d = tmp("app4"); let key = [7u8; 32];
        let first = new_uuid();
        sample(&first).save(&d, &key).unwrap();
        assert_eq!(recover(&d, &key, None), 1); // leaves the folder "v1" in the queue
        let id = new_uuid();
        let mut j = sample(&id);
        j.append = true; j.earlier = "OLD TEXT".into(); j.separator = "\n\n--- Added 9:00 AM ---\n\n".into();
        j.save(&d, &key).unwrap();
        assert_eq!(recover(&d, &key, None), 1);
        let m = queue::read_metadata(&d, &key, &id).unwrap();
        assert_eq!(m.link_visit.as_deref(), Some("v1"), "must be linked to the visit, not parked");
        let t = queue::read_text(&d, &key, &id).unwrap();
        assert!(t.find("OLD TEXT").unwrap() < t.find("made-up words").unwrap(), "earlier text first: {t}");
        assert!(queue::read_metadata(&d, &key, "v1").is_ok(), "the first item is untouched");
    }

    #[test]
    fn a_crashed_append_without_earlier_text_still_waits_for_linking_by_hand() {
        let d = tmp("app2"); let key = [7u8; 32];
        let id = new_uuid();
        let mut j = sample(&id);
        j.append = true; // an older journal, or the earlier text could not be read
        j.save(&d, &key).unwrap();
        assert_eq!(recover(&d, &key, None), 1);
        let m = queue::read_metadata(&d, &key, &id).unwrap();
        assert_eq!(m.link_visit, None);
        assert!(queue::read_metadata(&d, &key, "v1").is_err());
    }

    #[test]
    fn an_old_journal_file_without_the_new_fields_still_loads() {
        let d = tmp("app3"); let key = [7u8; 32];
        let id = new_uuid();
        let mut v = serde_json::to_value(sample(&id)).unwrap();
        v.as_object_mut().unwrap().remove("earlier"); v.as_object_mut().unwrap().remove("separator");
        let dir_ = dir(&d, &id).unwrap(); fs::create_dir_all(&dir_).unwrap();
        queue::write_private(&dir_.join("journal.json"), &queue::encrypt(&key, &serde_json::to_vec(&v).unwrap()).unwrap()).unwrap();
        let j = Journal::load(&d, &key, &id).unwrap();
        assert!(j.earlier.is_empty() && j.separator.is_empty());
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

    #[test]
    fn a_truncated_or_empty_journal_file_is_refused_and_never_panics() {
        let d = tmp("trunc"); let key = [9u8; 32];
        let id = new_uuid();
        sample(&id).save(&d, &key).unwrap();
        let f = d.join("journal").join(&id).join("journal.json");
        let raw = fs::read(&f).unwrap();
        for cut in [0usize, 1, 11, 12, 20, raw.len() / 2, raw.len() - 1] {
            fs::write(&f, &raw[..cut]).unwrap();
            assert!(Journal::load(&d, &key, &id).is_err(), "cut at {cut}");
        }
        fs::write(&f, b"not even encrypted").unwrap();
        assert!(Journal::load(&d, &key, &id).is_err());
    }

    #[test]
    fn a_journal_that_cannot_be_read_is_left_in_place_by_recovery_not_deleted() {
        let d = tmp("keepbad"); let key = [7u8; 32];
        let id = new_uuid();
        sample(&id).save(&d, &key).unwrap();
        let f = d.join("journal").join(&id).join("journal.json");
        let mut raw = fs::read(&f).unwrap(); let n = raw.len(); raw[n - 1] ^= 1; fs::write(&f, raw).unwrap();
        assert_eq!(recover(&d, &key, None), 0);
        assert_eq!(leftovers(&d), vec![id], "never destroy what could not be read");
    }

    #[test]
    fn saving_twice_replaces_the_checkpoint_and_the_newer_words_win() {
        let d = tmp("twice"); let key = [3u8; 32];
        let id = new_uuid();
        let mut j = sample(&id);
        j.save(&d, &key).unwrap();
        j.seq = 3; j.segments[0].text = "newer words".into();
        j.save(&d, &key).unwrap();
        let back = Journal::load(&d, &key, &id).unwrap();
        assert_eq!(back.seq, 3);
        assert!(back.text().contains("newer words"));
        assert!(!back.text().contains("made-up"));
        assert_eq!(leftovers(&d).len(), 1);
    }

    #[test]
    fn many_crashed_recordings_all_recover_and_none_are_lost() {
        let d = tmp("many"); let key = [5u8; 32];
        let ids: Vec<String> = (0..5).map(|_| new_uuid()).collect();
        for (i, id) in ids.iter().enumerate() {
            let mut j = sample(id); j.visit_id = format!("visit-{i}"); j.save(&d, &key).unwrap();
        }
        assert_eq!(recover(&d, &key, None), 5);
        assert!(leftovers(&d).is_empty());
        for i in 0..5 { assert!(queue::read_metadata(&d, &key, &format!("visit-{i}")).is_ok()); }
    }

    #[test]
    fn a_journal_with_a_hostile_visit_id_waits_unlinked_and_cannot_escape_the_folder() {
        let d = tmp("evil"); let key = [6u8; 32];
        let id = new_uuid();
        let mut j = sample(&id); j.visit_id = "../../outside".into(); j.save(&d, &key).unwrap();
        assert_eq!(recover(&d, &key, None), 1);
        assert!(!d.parent().unwrap().join("outside").exists());
        assert_eq!(queue::read_metadata(&d, &key, &id).unwrap().link_visit, None);
    }

    #[test]
    fn a_foreign_folder_name_in_the_journal_dir_is_ignored() {
        let d = tmp("foreign"); let key = [4u8; 32];
        fs::create_dir_all(d.join("journal").join("not-a-uuid")).unwrap();
        assert!(leftovers(&d).is_empty());
        assert_eq!(recover(&d, &key, None), 0);
    }

    #[test]
    fn windows_never_overlap_or_skip() {
        let r = SAMPLE_RATE as usize;
        let mut done = 0usize; let mut covered = 0usize;
        for avail in (0..200).map(|s| s * r) {
            if let Some(w) = next_window(done, avail) { assert_eq!(w.start, done); covered += w.end - w.start; done = w.end; }
        }
        assert_eq!(covered, done);
        assert!(next_window(done, done).is_none());
        assert!(next_window(10 * r, 5 * r).is_none(), "fewer samples than done must not underflow");
    }

    #[test]
    fn power_loss_mid_write_leaves_the_last_good_checkpoint_readable() {
        let d = tmp("power"); let key = [8u8; 32];
        let id = new_uuid();
        let mut j = sample(&id);
        j.save(&d, &key).unwrap();
        // a write that died half-way leaves a stray, truncated temp file next to the real one
        let dir = d.join("journal").join(&id);
        fs::write(dir.join("journal.tmp"), b"half a checkpoi").unwrap();
        let back = Journal::load(&d, &key, &id).unwrap();
        assert_eq!(back.seq, j.seq);
        assert_eq!(leftovers(&d), vec![id.clone()]);
        // the next save replaces the stray file cleanly
        j.seq = 9; j.save(&d, &key).unwrap();
        assert_eq!(Journal::load(&d, &key, &id).unwrap().seq, 9);
        assert!(recover(&d, &key, None) == 1);
    }

    #[cfg(unix)]
    #[test]
    fn disk_full_or_unwritable_fails_loudly_and_keeps_the_previous_checkpoint() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp("full"); let key = [2u8; 32];
        let id = new_uuid();
        let mut j = sample(&id);
        j.save(&d, &key).unwrap();
        let dir = d.join("journal").join(&id);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        j.seq = 50; j.segments[0].text = "lost words".into();
        let r = j.save(&d, &key);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        if r.is_ok() { return; } // running as a user that ignores permissions (root): nothing to prove
        let back = Journal::load(&d, &key, &id).unwrap();
        assert_eq!(back.seq, 2, "the older checkpoint is untouched");
        assert!(!back.text().contains("lost words"));
    }

    #[test]
    fn two_app_instances_never_mix_up_recordings() {
        let d = tmp("two"); let key = [1u8; 32];
        let (a, b) = (new_uuid(), new_uuid());
        let mut ja = sample(&a); ja.visit_id = "visit-a".into();
        let mut jb = sample(&b); jb.visit_id = "visit-b".into(); jb.segments[0].text = "other instance".into();
        ja.save(&d, &key).unwrap(); jb.save(&d, &key).unwrap();
        // instance 1 recovers while instance 2 is still recording b: b is left alone
        assert_eq!(recover(&d, &key, Some(&b)), 1);
        assert_eq!(leftovers(&d), vec![b.clone()]);
        assert!(queue::read_metadata(&d, &key, "visit-a").is_ok());
        assert!(Journal::load(&d, &key, &b).unwrap().text().contains("other instance"));
    }

    #[test]
    fn sleep_and_wake_a_huge_gap_is_one_window_not_a_loop_or_a_skip() {
        let r = SAMPLE_RATE as usize;
        // the Mac slept: far more audio is "available" than before, in a single step
        let w = next_window(0, 3600 * r).expect("a window");
        assert_eq!(w.start, 0);
        assert!(w.end <= 3600 * r && w.end > w.start);
        // working through an hour of backlog terminates and covers it in order
        let mut done = 0usize; let mut steps = 0;
        while let Some(w) = next_window(done, 3600 * r) { assert_eq!(w.start, done); done = w.end; steps += 1; assert!(steps < 500); }
        assert!(3600 * r - done < 31 * r);
    }

    #[test]
    fn an_update_restart_during_recording_recovers_everything_saved_so_far() {
        let d = tmp("update"); let key = [6u8; 32];
        let id = new_uuid();
        let mut j = sample(&id);
        for n in 1..=4 { j.seq = n; j.segments[0].text = format!("words up to checkpoint {n}"); j.save(&d, &key).unwrap(); }
        // the app is replaced and relaunched: a new process finds the journal and queues it
        assert_eq!(recover(&d, &key, None), 1);
        assert!(queue::read_text(&d, &key, "v1").unwrap().contains("words up to checkpoint 4"));
        assert!(leftovers(&d).is_empty());
        // relaunching again changes nothing and loses nothing
        assert_eq!(recover(&d, &key, None), 0);
        assert!(queue::read_metadata(&d, &key, "v1").is_ok());
    }
}
