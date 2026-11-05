//! Recording a visit: the provider's microphone and, for a telehealth call, the audio coming out of the speakers.
//!
//! macOS does not let a web page capture system audio, which is why this is native. ScreenCaptureKit is the API that
//! allows it (macOS 13 and later); the microphone comes through cpal. The two are kept on **separate channels** of
//! one WAV file, so a later transcription knows which voice is which rather than guessing.
//!
//! Nothing here logs audio or anything derived from it.

use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

/// Both sides of a visit, at 16 kHz mono each: what Whisper wants, and what keeps the file small.
pub const SAMPLE_RATE: u32 = 16_000;

#[derive(Default)]
pub struct Channels {
    /// The provider, from the microphone.
    pub mic: Vec<i16>,
    /// The other side of a call, from the system audio. Empty for an in-person visit.
    pub system: Vec<i16>,
}

impl Channels {
    /// True when one side recorded nothing. A telehealth visit that captured only the provider produces a note
    /// missing everything the patient said, so the caller refuses rather than writing from half a conversation.
    pub fn one_sided(&self) -> bool {
        let loud = |v: &Vec<i16>| v.iter().any(|s| s.unsigned_abs() > 300);
        loud(&self.mic) != loud(&self.system)
    }

    pub fn has_sound(&self) -> bool {
        self.mic.iter().chain(self.system.iter()).any(|s| s.unsigned_abs() > 300)
    }

    /// One stereo WAV: the microphone on the left, the system audio on the right. Transcribing each channel on its
    /// own is what makes speaker attribution a fact rather than a guess.
    pub fn to_stereo_wav(&self) -> Result<Vec<u8>, String> {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut w = hound::WavWriter::new(&mut cursor, spec).map_err(|_| "cannot build the recording".to_string())?;
            let frames = self.mic.len().max(self.system.len());
            for i in 0..frames {
                w.write_sample(*self.mic.get(i).unwrap_or(&0)).map_err(|_| "cannot build the recording".to_string())?;
                w.write_sample(*self.system.get(i).unwrap_or(&0)).map_err(|_| "cannot build the recording".to_string())?;
            }
            w.finalize().map_err(|_| "cannot finish the recording".to_string())?;
        }
        Ok(cursor.into_inner())
    }
}

/// Averages interleaved frames down to mono and resamples to 16 kHz by taking the nearest sample. Crude, but a
/// transcriber is unbothered by it and it avoids pulling in a resampling library.
pub fn to_mono_16k(input: &[f32], channels: u16, rate: u32) -> Vec<i16> {
    if channels == 0 || rate == 0 || input.is_empty() {
        return Vec::new();
    }
    let frames = input.len() / channels as usize;
    let out_len = (frames as u64 * SAMPLE_RATE as u64 / rate as u64) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = (i as u64 * rate as u64 / SAMPLE_RATE as u64) as usize;
        if src >= frames {
            break;
        }
        let start = src * channels as usize;
        let sum: f32 = input[start..start + channels as usize].iter().sum();
        let avg = (sum / channels as f32).clamp(-1.0, 1.0);
        out.push((avg * i16::MAX as f32) as i16);
    }
    out
}

/// A recording in progress. Dropping it stops both streams.
pub struct Recorder {
    channels: Arc<Mutex<Channels>>,
    _mic: Option<cpal::Stream>,
    #[cfg(target_os = "macos")]
    system: Option<SystemCapture>,
}

/// The other party's audio. A Core Audio process tap by default (no Screen Recording permission); ScreenCaptureKit
/// only when PRACTICE_SYSTEM_AUDIO=sck is set, as a fallback.
#[cfg(target_os = "macos")]
enum SystemCapture {
    Tap(#[allow(dead_code)] system_tap::Capture),
    Sck(#[allow(dead_code)] system_audio::Capture),
}

#[cfg(target_os = "macos")]
fn start_system(channels: Arc<Mutex<Channels>>) -> Result<SystemCapture, String> {
    if std::env::var("PRACTICE_SYSTEM_AUDIO").ok().as_deref() == Some("sck") {
        system_audio::Capture::start(channels).map(SystemCapture::Sck)
    } else {
        system_tap::Capture::start(channels).map(SystemCapture::Tap)
    }
}

impl Recorder {
    /// Starts the microphone, and the system audio when it is available. A telehealth call needs both; an in-person
    /// visit only needs the microphone, so a failure to capture system audio is reported but does not stop the
    /// recording.
    pub fn start(with_system_audio: bool) -> Result<(Self, Option<String>), String> {
        let channels = Arc::new(Mutex::new(Channels::default()));

        let host = cpal::default_host();
        let device = host.default_input_device().ok_or("no microphone is available")?;
        let config = device.default_input_config().map_err(|_| "cannot read the microphone settings".to_string())?;
        let rate = config.sample_rate().0;
        let chans = config.channels();
        let sink = Arc::clone(&channels);
        let stream = device
            .build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let converted = to_mono_16k(data, chans, rate);
                    if let Ok(mut c) = sink.lock() {
                        c.mic.extend_from_slice(&converted);
                    }
                },
                |_| { /* a dropped buffer costs a moment of audio; never log, it may describe the room */ },
                None,
            )
            .map_err(|_| "cannot open the microphone".to_string())?;
        stream.play().map_err(|_| "cannot start the microphone".to_string())?;

        #[cfg(target_os = "macos")]
        {
            let (system, warning) = if with_system_audio {
                match start_system(Arc::clone(&channels)) {
                    Ok(c) => (Some(c), None),
                    Err(e) => (None, Some(e)),
                }
            } else {
                (None, None)
            };
            return Ok((Self { channels, _mic: Some(stream), system }, warning));
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = with_system_audio;
            Ok((Self { channels, _mic: Some(stream) }, Some("system audio is only captured on macOS".into())))
        }
    }

    /// Stops both streams and returns what was recorded.
    pub fn stop(mut self) -> Channels {
        self._mic = None;
        #[cfg(target_os = "macos")]
        {
            self.system = None;
        }
        Arc::try_unwrap(self.channels)
            .map(|m| m.into_inner().unwrap_or_default())
            .unwrap_or_else(|arc| arc.lock().map(|c| Channels { mic: c.mic.clone(), system: c.system.clone() }).unwrap_or_default())
    }
}

#[cfg(target_os = "macos")]
pub mod system_audio;
#[cfg(target_os = "macos")]
pub mod system_tap;

/// A recording, owned by a thread of its own.
///
/// Audio streams are tied to the thread that opened them and cannot be moved between threads, so the recorder lives
/// on a dedicated thread and the rest of the app talks to it through channels. This type holds only the channel, so
/// it can sit in a global and be reached from any command.
pub struct Session {
    stop: std::sync::mpsc::Sender<std::sync::mpsc::Sender<Channels>>,
}

impl Session {
    /// Starts recording. The warning, when there is one, says system audio could not be captured, so a telehealth
    /// visit would record only the provider.
    pub fn start(with_system_audio: bool) -> Result<(Self, Option<String>), String> {
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<Option<String>, String>>();
        let (stop_tx, stop_rx) = std::sync::mpsc::channel::<std::sync::mpsc::Sender<Channels>>();

        std::thread::spawn(move || match Recorder::start(with_system_audio) {
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
            Ok((recorder, warning)) => {
                let _ = ready_tx.send(Ok(warning));
                // Hold the streams open until a stop arrives. If the other end goes away, drop them and finish.
                if let Ok(reply) = stop_rx.recv() {
                    let _ = reply.send(recorder.stop());
                }
            }
        });

        let warning = ready_rx
            .recv_timeout(std::time::Duration::from_secs(20))
            .map_err(|_| "the recorder did not start".to_string())??;
        Ok((Self { stop: stop_tx }, warning))
    }

    pub fn stop(self) -> Result<Channels, String> {
        let (tx, rx) = std::sync::mpsc::channel();
        self.stop.send(tx).map_err(|_| "the recorder had already stopped".to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(30))
            .map_err(|_| "the recorder did not finish".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_conversion_mixes_channels_and_changes_rate() {
        // Two channels at 32 kHz: one frame becomes one sample, and 32 kHz halves to 16 kHz.
        let stereo = vec![1.0, -1.0, 0.5, 0.5, 0.0, 0.0, 1.0, 1.0];
        let out = to_mono_16k(&stereo, 2, 32_000);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], 0); // 1.0 and -1.0 average to silence
    }

    #[test]
    fn mono_conversion_copes_with_nothing_to_convert() {
        assert!(to_mono_16k(&[], 2, 16_000).is_empty());
        assert!(to_mono_16k(&[0.5], 0, 16_000).is_empty());
        assert!(to_mono_16k(&[0.5], 1, 0).is_empty());
    }

    #[test]
    fn a_visit_with_only_one_voice_is_recognised() {
        let loud = vec![5_000i16; 100];
        let quiet = vec![0i16; 100];
        assert!(Channels { mic: loud.clone(), system: quiet.clone() }.one_sided());
        assert!(Channels { mic: quiet.clone(), system: loud.clone() }.one_sided());
        assert!(!Channels { mic: loud.clone(), system: loud.clone() }.one_sided());
        // Silence on both sides is not one-sided; it is simply empty, and has_sound catches it.
        assert!(!Channels { mic: quiet.clone(), system: quiet.clone() }.one_sided());
        assert!(!Channels { mic: quiet, system: vec![] }.has_sound());
        assert!(Channels { mic: loud, system: vec![] }.has_sound());
    }

    #[test]
    fn the_two_sides_become_the_two_channels_of_one_wav() {
        let c = Channels { mic: vec![100, 200, 300], system: vec![-100, -200] };
        let wav = c.to_stereo_wav().unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        let r = hound::WavReader::new(std::io::Cursor::new(&wav)).unwrap();
        assert_eq!(r.spec().channels, 2);
        assert_eq!(r.spec().sample_rate, SAMPLE_RATE);
        let samples: Vec<i16> = r.into_samples::<i16>().map(|s| s.unwrap()).collect();
        // Interleaved, and the shorter side is padded with silence rather than truncating the longer one.
        assert_eq!(samples, vec![100, -100, 200, -200, 300, 0]);
    }
}
