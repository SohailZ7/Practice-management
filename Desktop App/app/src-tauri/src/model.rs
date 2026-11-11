//! The Whisper transcription model. It lives OUTSIDE the app bundle, in ~/Library/Application Support/PracticeNotes/models,
//! so an app update (which replaces the whole bundle) can never take it away. If it is missing the app downloads it
//! (resumable, checked against a SHA-256) instead of failing.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const NAME: &str = "ggml-small.en.bin";
pub const SIZE: u64 = 487_614_201;
pub const SHA256: &str = "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d";
pub const URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin";

/// Cheap launch check: the file exists and has the exact size (a partial or damaged file never passes).
pub fn is_valid(p: &Path) -> bool {
    fs::metadata(p).map(|m| m.len() == SIZE).unwrap_or(false)
}

pub fn sha256_file(p: &Path) -> std::io::Result<String> {
    let mut f = fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Copies a model found elsewhere (the old bundle, the spike folder) into the kept folder, so it survives updates.
pub fn adopt(src: &Path, dir: &Path) -> std::io::Result<()> {
    let dst = dir.join(NAME);
    if is_valid(&dst) { return Ok(()); }
    fs::create_dir_all(dir)?;
    let part = dir.join(format!("{NAME}.adopt"));
    fs::copy(src, &part)?;
    fs::rename(&part, &dst)
}

#[derive(Serialize, Clone, Default)]
pub struct Progress {
    pub running: bool,
    pub done: u64,
    pub total: u64,
    /// What to do, in words a user can act on. None while fine.
    pub error: Option<String>,
}

pub static PROGRESS: Mutex<Progress> = Mutex::new(Progress { running: false, done: 0, total: SIZE, error: None });

fn set(f: impl FnOnce(&mut Progress)) {
    if let Ok(mut p) = PROGRESS.lock() { f(&mut p); }
}

fn explain(e: &str) -> String {
    format!("The transcription model could not be downloaded ({e}). Check that this Mac is online, then click Download model again; it continues where it stopped.")
}

/// Downloads to `<dir>/<NAME>.part` (continuing a partial file), verifies size and SHA-256, then moves it into place.
pub fn download(dir: &Path, url: &str, expect_size: u64, expect_sha: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| explain(&e.to_string()))?;
    let dst = dir.join(NAME);
    let part = dir.join(format!("{NAME}.part"));
    let have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let have = if have > expect_size { let _ = fs::remove_file(&part); 0 } else { have };
    let mut req = ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(20)).build().get(url);
    if have > 0 { req = req.set("Range", &format!("bytes={have}-")); }
    let resp = req.call().map_err(|e| explain(&e.to_string()))?;
    let resumed = resp.status() == 206;
    let mut start = if resumed { have } else { 0 };
    let mut out = fs::OpenOptions::new().create(true).write(true).append(resumed).truncate(!resumed)
        .open(&part).map_err(|e| explain(&e.to_string()))?;
    set(|p| { p.done = start; p.total = expect_size; });
    let mut r = resp.into_reader();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = r.read(&mut buf).map_err(|e| explain(&e.to_string()))?;
        if n == 0 { break; }
        out.write_all(&buf[..n]).map_err(|e| explain(&e.to_string()))?;
        start += n as u64;
        set(|p| p.done = start);
    }
    out.flush().ok();
    drop(out);
    let size = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if size != expect_size {
        return Err(format!("The download stopped early ({} of {} MB). Click Download model again; it continues where it stopped.", size / 1_000_000, expect_size / 1_000_000));
    }
    let sha = sha256_file(&part).map_err(|e| explain(&e.to_string()))?;
    if sha != expect_sha {
        let _ = fs::remove_file(&part);
        return Err("The downloaded model failed its checksum and was deleted. Click Download model to fetch it again.".into());
    }
    fs::rename(&part, &dst).map_err(|e| explain(&e.to_string()))?;
    Ok(dst)
}

/// Starts the download in the background (once). Progress is read with `PROGRESS`.
pub fn start(dir: PathBuf) {
    {
        let Ok(mut p) = PROGRESS.lock() else { return };
        if p.running { return; }
        *p = Progress { running: true, done: 0, total: SIZE, error: None };
    }
    std::thread::spawn(move || {
        let r = download(&dir, URL, SIZE, SHA256);
        set(|p| { p.running = false; if let Err(e) = r { p.error = Some(e); } });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bbc-model-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn size_check_rejects_partial_files() {
        let d = tmp("size");
        let p = d.join(NAME);
        fs::File::create(&p).unwrap().write_all(b"short").unwrap();
        assert!(!is_valid(&p));
        assert!(!is_valid(&d.join("nope")));
    }

    #[test]
    fn sha_of_known_text() {
        let d = tmp("sha");
        let p = d.join("a");
        fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_file(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    /// Serves a small body over a local socket with Range support, to exercise download + resume + checksum.
    fn serve(body: Vec<u8>) -> String {
        use std::net::TcpListener;
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        std::thread::spawn(move || {
            for s in l.incoming() {
                let mut s = s.unwrap();
                let mut buf = [0u8; 2048];
                let n = s.read(&mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let start = req.lines().find_map(|l| l.to_lowercase().strip_prefix("range: bytes=").map(|r| r.trim_end_matches('-').parse::<usize>().unwrap_or(0))).unwrap_or(0);
                let (code, slice) = if start > 0 { ("206 Partial Content", &body[start..]) } else { ("200 OK", &body[..]) };
                let _ = write!(s, "HTTP/1.1 {code}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", slice.len());
                let _ = s.write_all(slice);
            }
        });
        format!("http://{addr}/m")
    }

    #[test]
    fn download_resumes_and_verifies() {
        let body: Vec<u8> = (0..100_000u32).map(|i| (i % 251) as u8).collect();
        let sha = { let d = tmp("h"); let p = d.join("x"); fs::write(&p, &body).unwrap(); sha256_file(&p).unwrap() };
        let url = serve(body.clone());
        let d = tmp("dl");
        // a partial file from an interrupted earlier try
        fs::write(d.join(format!("{NAME}.part")), &body[..40_000]).unwrap();
        let out = download(&d, &url, body.len() as u64, &sha).unwrap();
        assert_eq!(fs::read(out).unwrap(), body);
        assert!(!d.join(format!("{NAME}.part")).exists());
        // wrong checksum: refused and the file is deleted
        let d2 = tmp("bad");
        let e = download(&d2, &url, body.len() as u64, "00").unwrap_err();
        assert!(e.contains("checksum"));
        assert!(!d2.join(NAME).exists());
    }
}
