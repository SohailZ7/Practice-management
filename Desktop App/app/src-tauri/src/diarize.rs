//! Separating two voices on one microphone, entirely on this Mac. For every transcribed segment it measures how the
//! voice sounds (a short vector of spectral shape and pitch computed from the audio held in memory) and sorts the
//! segments into two groups. The vectors are discarded straight away: nothing is stored, nothing is matched against a
//! person, no voiceprint is kept. It is a rough tool, so the labels it gives ("Speaker 1", "Speaker 2") are always shown
//! to the provider to confirm.

use crate::capture::SAMPLE_RATE;
use crate::queue::Segment;

const FRAME: usize = 400; // 25 ms
const HOP: usize = 160; // 10 ms
const NFFT: usize = 512;
const MELS: usize = 26;
const COEFS: usize = 12;
const MIN_FRAMES: usize = 12; // a segment needs about 120 ms of voiced sound to be measured

fn fft(buf: &mut [(f32, f32)]) {
    let n = buf.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            buf.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * std::f32::consts::PI / len as f32;
        for start in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (wr, wi) = ((ang * k as f32).cos(), (ang * k as f32).sin());
                let (a, b) = (buf[start + k], buf[start + k + len / 2]);
                let t = (b.0 * wr - b.1 * wi, b.0 * wi + b.1 * wr);
                buf[start + k] = (a.0 + t.0, a.1 + t.1);
                buf[start + k + len / 2] = (a.0 - t.0, a.1 - t.1);
            }
        }
        len <<= 1;
    }
}

fn hz_to_mel(f: f32) -> f32 {
    2595.0 * (1.0 + f / 700.0).log10()
}
fn mel_to_hz(m: f32) -> f32 {
    700.0 * (10f32.powf(m / 2595.0) - 1.0)
}

fn filterbank() -> Vec<Vec<f32>> {
    let (lo, hi) = (hz_to_mel(100.0), hz_to_mel(7000.0));
    let pts: Vec<f32> = (0..MELS + 2).map(|i| mel_to_hz(lo + (hi - lo) * i as f32 / (MELS + 1) as f32)).collect();
    let bin = |f: f32| f * NFFT as f32 / SAMPLE_RATE as f32;
    (0..MELS)
        .map(|m| {
            let (a, b, c) = (bin(pts[m]), bin(pts[m + 1]), bin(pts[m + 2]));
            (0..=NFFT / 2)
                .map(|k| {
                    let k = k as f32;
                    if k <= a || k >= c { 0.0 } else if k <= b { (k - a) / (b - a) } else { (c - k) / (c - b) }
                })
                .collect()
        })
        .collect()
}

struct Frame {
    energy: f32,
    mfcc: [f32; COEFS],
    log_f0: Option<f32>,
}

fn analyse(samples: &[i16], bank: &[Vec<f32>]) -> Vec<Frame> {
    let mut out = Vec::new();
    let mut p = 0;
    while p + FRAME <= samples.len() {
        let w: Vec<f32> = samples[p..p + FRAME]
            .iter()
            .enumerate()
            .map(|(i, s)| *s as f32 / 32768.0 * (0.54 - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (FRAME - 1) as f32).cos()))
            .collect();
        let energy: f32 = w.iter().map(|x| x * x).sum::<f32>() / FRAME as f32;
        let mut buf = vec![(0.0f32, 0.0f32); NFFT];
        for (i, x) in w.iter().enumerate() {
            buf[i].0 = *x;
        }
        fft(&mut buf);
        let power: Vec<f32> = buf[..=NFFT / 2].iter().map(|(r, i)| r * r + i * i).collect();
        let logmel: Vec<f32> = bank.iter().map(|f| (f.iter().zip(&power).map(|(a, b)| a * b).sum::<f32>() + 1e-10).ln()).collect();
        let mut mfcc = [0f32; COEFS];
        for (c, slot) in mfcc.iter_mut().enumerate() {
            *slot = logmel
                .iter()
                .enumerate()
                .map(|(m, v)| v * (std::f32::consts::PI * (c + 1) as f32 * (m as f32 + 0.5) / MELS as f32).cos())
                .sum();
        }
        // Pitch: strongest self-similarity between 60 and 400 Hz.
        let r0: f32 = w.iter().map(|x| x * x).sum();
        let mut best = (0.0f32, 0usize);
        if r0 > 1e-9 {
            for lag in 40..=266 {
                let r: f32 = (0..FRAME - lag).map(|i| w[i] * w[i + lag]).sum();
                if r / r0 > best.0 {
                    best = (r / r0, lag);
                }
            }
        }
        let log_f0 = if best.0 > 0.4 { Some((SAMPLE_RATE as f32 / best.1 as f32).ln()) } else { None };
        out.push(Frame { energy, mfcc, log_f0 });
        p += HOP;
    }
    out
}

/// One segment's vector, or None when it has too little voiced sound to measure.
fn embed(frames: &[Frame], start: f64, end: f64) -> Option<Vec<f32>> {
    let a = ((start * 100.0) as usize).min(frames.len());
    let b = ((end * 100.0) as usize).min(frames.len());
    if b <= a {
        return None;
    }
    let slice = &frames[a..b];
    let max = slice.iter().map(|f| f.energy).fold(0.0f32, f32::max);
    let loud: Vec<&Frame> = slice.iter().filter(|f| f.energy > max * 0.1 && f.energy > 1e-7).collect();
    if loud.len() < MIN_FRAMES {
        return None;
    }
    let mut v = vec![0f32; COEFS + 1];
    for f in &loud {
        for c in 0..COEFS {
            v[c] += f.mfcc[c];
        }
    }
    for c in 0..COEFS {
        v[c] /= loud.len() as f32;
    }
    let f0: Vec<f32> = loud.iter().filter_map(|f| f.log_f0).collect();
    v[COEFS] = if f0.len() >= 5 { f0.iter().sum::<f32>() / f0.len() as f32 } else { f32::NAN };
    Some(v)
}

fn dist(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| (x - y) * (x - y)).sum::<f32>().sqrt()
}

/// Labels the segments "Speaker 1" / "Speaker 2" (numbered by who speaks first). When the recording sounds like one
/// voice, every segment is "Provider". Returns the number of voices found (1 or 2). `samples` is the microphone audio.
pub fn diarize(samples: &[i16], segs: &mut [Segment]) -> usize {
    let one = |segs: &mut [Segment]| {
        for s in segs.iter_mut() {
            s.speaker = "Provider".into();
        }
        1
    };
    if segs.len() < 2 {
        return one(segs);
    }
    let frames = analyse(samples, &filterbank());
    let embs: Vec<Option<Vec<f32>>> = segs.iter().map(|s| embed(&frames, s.audio_start_time.unwrap_or(0.0), s.audio_end_time.unwrap_or(0.0))).collect();
    let strong: Vec<usize> = (0..segs.len()).filter(|i| embs[*i].is_some()).collect();
    if strong.len() < 4 {
        return one(segs);
    }
    // Pitch counts only when most segments have it; otherwise it is left out.
    let with_f0 = strong.iter().filter(|i| !embs[**i].as_ref().unwrap()[COEFS].is_nan()).count();
    let use_f0 = with_f0 * 2 >= strong.len();
    let dims = COEFS + usize::from(use_f0);
    let mut pts: Vec<Vec<f32>> = strong.iter().map(|i| embs[*i].as_ref().unwrap()[..dims].to_vec()).collect();
    if use_f0 {
        let mean_f0 = pts.iter().map(|p| p[COEFS]).filter(|x| !x.is_nan()).sum::<f32>() / with_f0 as f32;
        for p in pts.iter_mut() {
            if p[COEFS].is_nan() {
                p[COEFS] = mean_f0;
            }
        }
    }
    // z-score each dimension; pitch counts double because it is the most reliable difference between two people.
    for d in 0..dims {
        let mean = pts.iter().map(|p| p[d]).sum::<f32>() / pts.len() as f32;
        let var = pts.iter().map(|p| (p[d] - mean) * (p[d] - mean)).sum::<f32>() / pts.len() as f32;
        let sd = var.sqrt().max(1e-6);
        let w = if use_f0 && d == COEFS { 2.5 } else { 1.0 };
        for p in pts.iter_mut() {
            p[d] = (p[d] - mean) / sd * w;
        }
    }
    let dur: Vec<f32> = strong
        .iter()
        .map(|i| (segs[*i].audio_end_time.unwrap_or(0.0) - segs[*i].audio_start_time.unwrap_or(0.0)).max(0.1) as f32)
        .collect();
    let centre = |idx: &dyn Fn(usize) -> bool| -> Vec<f32> {
        let mut c = vec![0f32; dims];
        let mut w = 0f32;
        for (k, p) in pts.iter().enumerate() {
            if idx(k) {
                for d in 0..dims {
                    c[d] += p[d] * dur[k];
                }
                w += dur[k];
            }
        }
        c.iter().map(|x| x / w.max(1e-6)).collect()
    };
    let overall = centre(&|_| true);
    let far1 = (0..pts.len()).max_by(|a, b| dist(&pts[*a], &overall).partial_cmp(&dist(&pts[*b], &overall)).unwrap()).unwrap();
    let far2 = (0..pts.len()).max_by(|a, b| dist(&pts[*a], &pts[far1]).partial_cmp(&dist(&pts[*b], &pts[far1])).unwrap()).unwrap();
    let (mut c1, mut c2) = (pts[far1].clone(), pts[far2].clone());
    let mut assign = vec![0usize; pts.len()];
    for _ in 0..30 {
        for (k, p) in pts.iter().enumerate() {
            assign[k] = usize::from(dist(p, &c2) < dist(p, &c1));
        }
        c1 = centre(&|k| assign[k] == 0);
        c2 = centre(&|k| assign[k] == 1);
    }
    let mass = |g: usize| -> f32 { (0..pts.len()).filter(|k| assign[*k] == g).map(|k| dur[k]).sum() };
    let (m0, m1) = (mass(0), mass(1));
    let total = m0 + m1;
    let radius = |g: usize, c: &Vec<f32>| -> f32 {
        let (mut s, mut w) = (0f32, 0f32);
        for k in (0..pts.len()).filter(|k| assign[*k] == g) {
            s += dist(&pts[k], c).powi(2) * dur[k];
            w += dur[k];
        }
        (s / w.max(1e-6)).sqrt()
    };
    let separation = dist(&c1, &c2) / ((radius(0, &c1) + radius(1, &c2)) / 2.0).max(1e-6);
    if m0.min(m1) < total * 0.15 || separation < 3.5 {
        return one(segs);
    }
    // Strong segments take their group; short or unvoiced ones follow the speaker just before them.
    let mut who: Vec<Option<usize>> = vec![None; segs.len()];
    for (k, i) in strong.iter().enumerate() {
        who[*i] = Some(assign[k]);
    }
    let mut prev: Option<usize> = None;
    for w in who.iter_mut() {
        match w {
            Some(g) => prev = Some(*g),
            None => *w = prev,
        }
    }
    let first = who.iter().flatten().next().copied().unwrap_or(0);
    for w in who.iter_mut() {
        if w.is_none() {
            *w = Some(first);
        }
    }
    // Speaker 1 is whoever speaks first.
    for (s, w) in segs.iter_mut().zip(who) {
        s.speaker = if w == Some(first) { "Speaker 1".into() } else { "Speaker 2".into() };
    }
    2
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A made-up voice: a pitch with harmonics shaped by two formants, plus a little noise. No real speech.
    fn voice(f0: f32, f1: f32, f2: f32, secs: f32, seed: &mut u32) -> Vec<i16> {
        let n = (secs * SAMPLE_RATE as f32) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / SAMPLE_RATE as f32;
                let mut x = 0.0;
                for h in 1..=30 {
                    let f = f0 * h as f32;
                    let amp = (-((f - f1) / 250.0).powi(2)).exp() + 0.7 * (-((f - f2) / 350.0).powi(2)).exp() + 0.02;
                    x += amp * (2.0 * std::f32::consts::PI * f * t).sin();
                }
                *seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = ((*seed >> 16) as f32 / 65536.0 - 0.5) * 0.3;
                ((x * 0.12 + noise * 0.05) * 20000.0) as i16
            })
            .collect()
    }

    fn seg(start: f64, end: f64) -> Segment {
        Segment {
            id: String::new(), text: "words".into(), timestamp: "[00:00]".into(), channel: "mic".into(), speaker: String::new(),
            audio_start_time: Some(start), audio_end_time: Some(end), sequence_id: 0,
        }
    }

    fn conversation(a: (f32, f32, f32), b: (f32, f32, f32), turns: &[(bool, f32)]) -> (Vec<i16>, Vec<Segment>) {
        let mut seed = 7u32;
        let (mut audio, mut segs, mut t) = (Vec::new(), Vec::new(), 0.0f32);
        for (is_a, secs) in turns {
            let v = if *is_a { a } else { b };
            audio.extend(voice(v.0, v.1, v.2, *secs, &mut seed));
            segs.push(seg(t as f64, (t + secs) as f64));
            t += secs;
        }
        (audio, segs)
    }

    #[test]
    fn two_different_voices_are_told_apart_and_numbered_by_who_speaks_first() {
        let turns = [(false, 3.0), (true, 2.5), (false, 2.0), (true, 3.0), (true, 1.5), (false, 2.5), (true, 2.0), (false, 3.0)];
        let (audio, mut segs) = conversation((115.0, 500.0, 1500.0), (215.0, 800.0, 2500.0), &turns);
        assert_eq!(diarize(&audio, &mut segs), 2);
        for (s, (is_a, _)) in segs.iter().zip(turns) {
            // The first speaker in time (voice B) is Speaker 1.
            assert_eq!(s.speaker, if is_a { "Speaker 2" } else { "Speaker 1" }, "{:?}", segs.iter().map(|s| &s.speaker).collect::<Vec<_>>());
        }
    }

    #[test]
    fn one_voice_stays_one_speaker() {
        let turns = [(true, 3.0), (true, 2.0), (true, 2.5), (true, 3.0), (true, 1.5), (true, 2.0)];
        let (audio, mut segs) = conversation((130.0, 600.0, 1700.0), (130.0, 600.0, 1700.0), &turns);
        assert_eq!(diarize(&audio, &mut segs), 1);
        assert!(segs.iter().all(|s| s.speaker == "Provider"));
    }

    #[test]
    fn too_little_speech_is_one_speaker() {
        let mut segs = vec![seg(0.0, 1.0)];
        assert_eq!(diarize(&vec![0i16; 16000], &mut segs), 1);
        assert_eq!(segs[0].speaker, "Provider");
    }
}
