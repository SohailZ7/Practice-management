//! Local transcription. whisper.cpp runs in this process (via whisper-rs), on the 16 kHz mono samples the capture
//! code already holds in memory, one channel at a time so each segment is known to be the provider ("mic") or the
//! other side of the call ("system"). No audio is written to disk. Nothing here logs audio or text.

use std::ops::Range;
use std::path::Path;

use crate::capture::SAMPLE_RATE;
use crate::queue::Segment;

/// Whisper works on windows of up to 30 s; chunks stay a little under that.
pub const CHUNK_SECS: usize = 28;
/// A chunk may end early, at the quietest moment in the last few seconds, so a word is not cut in half.
pub const SEEK_BACK_SECS: usize = 4;
/// Below this peak a chunk is treated as silence and skipped.
pub const SILENCE_PEAK: u16 = 300;

/// Splits `samples` into chunks of at most `max_len`, ending each early at the quietest 100 ms frame within the last
/// `seek_back` samples. The ranges cover the whole input, in order, with no gaps or overlaps.
pub fn plan_chunks(samples: &[i16], max_len: usize, seek_back: usize) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    if samples.is_empty() || max_len == 0 {
        return out;
    }
    let frame = (SAMPLE_RATE as usize / 10).max(1);
    let mut start = 0;
    while start < samples.len() {
        let hard_end = (start + max_len).min(samples.len());
        let mut end = hard_end;
        if hard_end - start == max_len && hard_end < samples.len() && seek_back >= frame {
            let from = hard_end - seek_back.min(hard_end - start);
            let mut best = (u64::MAX, hard_end);
            let mut p = from;
            while p + frame <= hard_end {
                let energy: u64 = samples[p..p + frame].iter().map(|s| s.unsigned_abs() as u64).sum();
                if energy < best.0 {
                    best = (energy, p + frame / 2);
                }
                p += frame;
            }
            if best.1 > start {
                end = best.1;
            }
        }
        out.push(start..end);
        start = end;
    }
    out
}

pub fn is_silent(chunk: &[i16]) -> bool {
    !chunk.iter().any(|s| s.unsigned_abs() > SILENCE_PEAK)
}

/// What the engine returns for one chunk: start and end in centiseconds from the chunk's start, and the text.
pub type RawSegment = (i64, i64, String);

fn display_time(secs: f64) -> String {
    let t = secs.max(0.0) as u64;
    format!("[{:02}:{:02}]", t / 60, t % 60)
}

/// Text that is not speech: whisper emits markers like "[BLANK_AUDIO]" or "(music)" for noise.
fn is_marker(text: &str) -> bool {
    let t = text.trim();
    t.is_empty()
        || (t.starts_with('[') && t.ends_with(']'))
        || (t.starts_with('(') && t.ends_with(')'))
        || (t.starts_with('*') && t.ends_with('*'))
}

/// Turns one chunk's raw segments into queue segments with times relative to the whole recording.
pub fn assemble_chunk(channel: &str, chunk_start_sample: usize, raw: &[RawSegment]) -> Vec<Segment> {
    let offset = chunk_start_sample as f64 / SAMPLE_RATE as f64;
    raw.iter()
        .filter(|(_, _, t)| !is_marker(t))
        .map(|(a, b, t)| {
            let start = offset + *a as f64 / 100.0;
            let end = (offset + *b as f64 / 100.0).max(start);
            Segment {
                id: String::new(),
                text: t.split_whitespace().collect::<Vec<_>>().join(" "),
                timestamp: display_time(start),
                channel: channel.to_string(),
                audio_start_time: Some(start),
                audio_end_time: Some(end),
                sequence_id: 0,
            }
        })
        .collect()
}

/// Orders segments from both channels by start time and numbers them.
pub fn merge_channels(mut all: Vec<Segment>) -> Vec<Segment> {
    all.sort_by(|a, b| {
        a.audio_start_time
            .partial_cmp(&b.audio_start_time)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.channel.cmp(&b.channel))
    });
    for (i, s) in all.iter_mut().enumerate() {
        s.sequence_id = i as u64;
        s.id = format!("seg-{i}");
    }
    all
}

/// Runs the engine over `samples` chunk by chunk. `run_chunk` receives a chunk and returns its raw segments; the
/// real one calls whisper, tests pass a fake.
pub fn transcribe_channel(
    channel: &str,
    samples: &[i16],
    mut run_chunk: impl FnMut(&[i16]) -> Result<Vec<RawSegment>, String>,
) -> Result<Vec<Segment>, String> {
    let mut out = Vec::new();
    for r in plan_chunks(samples, CHUNK_SECS * SAMPLE_RATE as usize, SEEK_BACK_SECS * SAMPLE_RATE as usize) {
        let chunk = &samples[r.clone()];
        if is_silent(chunk) {
            continue;
        }
        out.extend(assemble_chunk(channel, r.start, &run_chunk(chunk)?));
    }
    Ok(out)
}

/// Loads the model and transcribes both channels.
pub fn transcribe(model: &Path, mic: &[i16], system: &[i16]) -> Result<Vec<Segment>, String> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
    let ctx = WhisperContext::new_with_params(
        model.to_str().ok_or("the transcription model path is invalid")?,
        WhisperContextParameters::default(),
    )
    .map_err(|_| "could not load the transcription model".to_string())?;
    let mut state = ctx.create_state().map_err(|_| "could not start the transcriber".to_string())?;

    let mut run = |chunk: &[i16]| -> Result<Vec<RawSegment>, String> {
        let floats: Vec<f32> = chunk.iter().map(|s| *s as f32 / 32768.0).collect();
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_context(true);
        params.set_suppress_blank(true);
        state.full(params, &floats).map_err(|_| "transcription failed".to_string())?;
        Ok(state
            .as_iter()
            .map(|seg| (seg.start_timestamp(), seg.end_timestamp(), seg.to_str_lossy().map(|c| c.into_owned()).unwrap_or_default()))
            .collect())
    };

    let mut all = transcribe_channel("mic", mic, &mut run)?;
    all.extend(transcribe_channel("system", system, &mut run)?);
    Ok(merge_channels(all))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_cover_the_input_without_gaps_and_end_in_quiet_spots() {
        let rate = SAMPLE_RATE as usize;
        // 70 s of loud signal with a quiet gap at 26 s, inside the seek-back window of the first chunk.
        let mut s = vec![5000i16; 70 * rate];
        for x in &mut s[26 * rate..26 * rate + rate / 2] {
            *x = 0;
        }
        let chunks = plan_chunks(&s, 28 * rate, 4 * rate);
        assert_eq!(chunks.first().unwrap().start, 0);
        assert_eq!(chunks.last().unwrap().end, s.len());
        for w in chunks.windows(2) {
            assert_eq!(w[0].end, w[1].start);
        }
        assert!(chunks.iter().all(|c| c.len() <= 28 * rate));
        let first_end = chunks[0].end;
        assert!(first_end > 26 * rate && first_end < 27 * rate, "ended at {first_end}");
        assert!(plan_chunks(&[], 10, 2).is_empty());
    }

    #[test]
    fn silence_is_skipped_and_times_are_absolute() {
        let rate = SAMPLE_RATE as usize;
        let mut s = vec![0i16; 60 * rate];
        for x in &mut s[40 * rate..45 * rate] {
            *x = 4000;
        }
        let mut calls = 0;
        let segs = transcribe_channel("system", &s, |_| {
            calls += 1;
            Ok(vec![(100, 350, " Hello   there ".into()), (400, 450, "[BLANK_AUDIO]".into())])
        })
        .unwrap();
        assert_eq!(calls, 1, "only the chunk with sound is transcribed");
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].text, "Hello there");
        assert_eq!(segs[0].channel, "system");
        let start = segs[0].audio_start_time.unwrap();
        assert!(start > 24.0, "offset by the chunk start, got {start}");
    }

    #[test]
    fn channels_merge_in_time_order_and_are_numbered() {
        let mk = |ch: &str, t: &str, s: f64| Segment {
            id: String::new(), text: t.into(), timestamp: display_time(s), channel: ch.into(),
            audio_start_time: Some(s), audio_end_time: Some(s + 1.0), sequence_id: 0,
        };
        let m = merge_channels(vec![mk("system", "b", 5.0), mk("mic", "a", 1.0), mk("mic", "c", 65.0)]);
        assert_eq!(m.iter().map(|s| s.text.as_str()).collect::<String>(), "abc");
        assert_eq!(m[2].sequence_id, 2);
        assert_eq!(m[2].timestamp, "[01:05]");
        assert_eq!(m[0].id, "seg-0");
    }
}
