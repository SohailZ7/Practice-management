//! Signing in with Google, the way a desktop app has to do it.
//!
//! The browser does the sign-in, not this app: it opens the system browser, listens on a loopback port for Google to
//! redirect back, and swaps the code for an identity. The app never sees the password, and PKCE means the code is
//! useless to anything that did not start the exchange.
//!
//! The identity is then handed to the practice app, which checks it against its own allowlist and issues the tokens
//! this recorder stores. Nothing here logs a token or a code.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::Duration;

use serde::Deserialize;

/// What the practice app says about signing in.
#[derive(Deserialize)]
pub struct AuthConfig {
    #[serde(rename = "googleSignIn")]
    pub google_sign_in: bool,
    #[serde(rename = "clientId")]
    pub client_id: String,
}

/// The tokens the practice app issues once it recognises the person.
#[derive(Deserialize)]
pub struct PracticeTokens {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken")]
    pub refresh_token: String,
}

fn base64_url(bytes: &[u8]) -> String {
    const SET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        let take = chunk.len() + 1;
        for i in 0..take {
            out.push(SET[((n >> (18 - 6 * i)) & 0x3f) as usize] as char);
        }
    }
    out
}

/// Random bytes from the system, used for the PKCE verifier and the state value.
pub fn random_bytes(n: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut buf = vec![0u8; n];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|_| "could not generate a secure value".to_string())?;
    Ok(buf)
}

fn sha256(input: &str) -> Vec<u8> {
    // A small SHA-256, so the recorder does not pull a crypto crate in for one hash.
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
        0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
        0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
        0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    let mut msg = input.as_bytes().to_vec();
    let bits = (msg.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bits.to_be_bytes());

    for block in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([block[i * 4], block[i * 4 + 1], block[i * 4 + 2], block[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g; g = f; f = e;
            e = d.wrapping_add(t1);
            d = c; c = b; b = a;
            a = t1.wrapping_add(t2);
        }
        for (i, v) in [a, b, c, d, e, f, g, hh].into_iter().enumerate() {
            h[i] = h[i].wrapping_add(v);
        }
    }
    h.iter().flat_map(|v| v.to_be_bytes()).collect()
}

fn form_encode(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Waits for Google to redirect back, and returns the code. The listener only ever accepts one request.
fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener
        .set_nonblocking(false)
        .map_err(|_| "could not listen for the sign-in reply".to_string())?;
    let (mut stream, _) = listener.accept().map_err(|_| "the sign-in was not completed".to_string())?;

    let mut line = String::new();
    BufReader::new(stream.try_clone().map_err(|_| "sign-in failed".to_string())?)
        .read_line(&mut line)
        .map_err(|_| "sign-in failed".to_string())?;

    // "GET /?code=...&state=... HTTP/1.1"
    let target = line.split_whitespace().nth(1).unwrap_or("");
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code = None;
    let mut state = None;
    for pair in query.split('&') {
        match pair.split_once('=') {
            Some(("code", v)) => code = Some(v.to_string()),
            Some(("state", v)) => state = Some(v.to_string()),
            _ => {}
        }
    }

    let done = "You are signed in. Close this tab and go back to Practice Recorder.";
    let _ = stream.write_all(
        format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            done.len(), done).as_bytes(),
    );

    if state.as_deref() != Some(expected_state) {
        return Err("the sign-in reply did not match this request".into());
    }
    code.ok_or_else(|| "Google did not return a sign-in code".to_string())
}

/// Only https is allowed, except plain http to this Mac (localhost or 127.0.0.1) for development.
pub fn check_base_url(url: &str) -> Result<(), String> {
    let bad = || Err("The practice app address must use https (http is only allowed for localhost).".to_string());
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return bad();
    }
    if let Some(rest) = url.strip_prefix("https://") {
        return if rest.is_empty() || rest.starts_with('/') || rest.starts_with(':') { bad() } else { Ok(()) };
    }
    if let Some(rest) = url.strip_prefix("http://") {
        let host = rest.split(|c| c == ':' || c == '/').next().unwrap_or("");
        return if host == "localhost" || host == "127.0.0.1" { Ok(()) } else { bad() };
    }
    bad()
}

/// One call to the practice app's desktop API, made here instead of in the webview: the webview is a different origin
/// from the server, and the server sends no CORS headers. Any HTTP status comes back as data; `Err` means the server
/// could not be reached at all.
pub fn api_request(
    base_url: &str, method: &str, path: &str, token: Option<&str>, body: Option<&str>,
) -> Result<(u16, String), String> {
    check_base_url(base_url)?;
    if !path.starts_with("/api/desktop/v1/") || path.contains("..") || path.contains('\\') {
        return Err("Not a practice app address.".into());
    }
    if !matches!(method, "GET" | "POST" | "PATCH" | "DELETE") {
        return Err("Unsupported request.".into());
    }
    // Generating a note can take about two minutes.
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(170)).build();
    let mut req = agent.request(method, &format!("{}{}", base_url.trim_end_matches('/'), path));
    if let Some(t) = token {
        req = req.set("authorization", &format!("Bearer {t}"));
    }
    let result = match body {
        Some(b) => req.set("content-type", "application/json").send_string(b),
        None => req.call(),
    };
    match result {
        Ok(r) => {
            let status = r.status();
            Ok((status, r.into_string().map_err(|_| "The practice app gave an unreadable reply.".to_string())?))
        }
        Err(ureq::Error::Status(code, r)) => Ok((code, r.into_string().unwrap_or_default())),
        Err(e) => Err(format!("Could not reach the practice app ({}).", e.kind())),
    }
}

/// Swaps a refresh token for a new pair. The server rotates the refresh token, so the old one is dead afterwards.
/// `Ok(None)` means the server refused it (signed out for good); `Err` means it could not be reached.
pub fn refresh(practice_url: &str, refresh_token: &str) -> Result<Option<PracticeTokens>, String> {
    check_base_url(practice_url)?;
    let base = practice_url.trim_end_matches('/');
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build();
    match agent
        .post(&format!("{base}/api/desktop/v1/auth/refresh"))
        .send_json(ureq::json!({ "refreshToken": refresh_token }))
    {
        Ok(r) => r.into_json().map(Some).map_err(|_| "the practice app gave an unreadable reply".to_string()),
        Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => Ok(None),
        Err(_) => Err("The practice app could not be reached.".into()),
    }
}

/// Runs the whole sign-in and returns the practice app's tokens.
pub fn sign_in(practice_url: &str) -> Result<PracticeTokens, String> {
    check_base_url(practice_url)?;
    let base = practice_url.trim_end_matches('/');
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build();

    let config: AuthConfig = agent
        .get(&format!("{base}/api/desktop/v1/auth/config"))
        .call()
        .map_err(|_| "could not reach the practice app at that address".to_string())?
        .into_json()
        .map_err(|_| "the practice app gave an unreadable reply".to_string())?;
    if !config.google_sign_in {
        return Err("Google sign-in is not set up on this server yet.".into());
    }

    let verifier = base64_url(&random_bytes(48)?);
    let challenge = base64_url(&sha256(&verifier));
    let state = base64_url(&random_bytes(16)?);

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "could not open a port for the sign-in".to_string())?;
    let port = listener.local_addr().map_err(|_| "could not open a port for the sign-in".to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}");

    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?{}",
        form_encode(&[
            ("client_id", &config.client_id),
            ("redirect_uri", &redirect),
            ("response_type", "code"),
            ("scope", "openid email profile"),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
            ("state", &state),
            ("prompt", "select_account"),
        ])
    );
    std::process::Command::new("open")
        .arg(&url)
        .status()
        .map_err(|_| "could not open the browser to sign in".to_string())?;

    let code = wait_for_code(listener, &state)?;

    // The practice app swaps the code for an ID token (it holds the client secret), checks its allowlist and
    // issues the tokens in one call.
    let label = hostname();
    agent
        .post(&format!("{base}/api/desktop/v1/auth/google-exchange"))
        .send_json(ureq::json!({
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": redirect,
            "deviceLabel": label,
        }))
        .map_err(|e| match e {
            ureq::Error::Status(403, _) => "That Google account is not allowed to use this practice app.".to_string(),
            ureq::Error::Status(401, _) => "The practice app did not accept that sign-in.".to_string(),
            _ => "The practice app could not be reached.".to_string(),
        })?
        .into_json()
        .map_err(|_| "the practice app gave an unreadable reply".to_string())
}

fn hostname() -> String {
    std::process::Command::new("scutil")
        .arg("--get")
        .arg("ComputerName")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Mac".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_config_has_no_client_secret_field() {
        let c: AuthConfig = serde_json::from_str(r#"{"googleSignIn":true,"clientId":"x"}"#).unwrap();
        assert!(c.google_sign_in && c.client_id == "x");
    }

    #[test]
    fn sha256_matches_known_values() {
        assert_eq!(
            sha256("abc").iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256("").iter().map(|b| format!("{b:02x}")).collect::<String>(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // Longer than one block, to exercise the padding.
        let long = "a".repeat(200);
        assert_eq!(sha256(&long).len(), 32);
    }

    #[test]
    fn base64_url_has_no_characters_that_need_escaping() {
        let encoded = base64_url(&[251, 255, 190, 0, 1, 2]);
        assert!(!encoded.contains('+') && !encoded.contains('/') && !encoded.contains('='));
        assert_eq!(base64_url(b"abc"), "YWJj");
    }

    #[test]
    fn a_verifier_and_its_challenge_differ_every_time() {
        let a = base64_url(&random_bytes(48).unwrap());
        let b = base64_url(&random_bytes(48).unwrap());
        assert_ne!(a, b);
        assert!(a.len() >= 43, "PKCE verifiers must be at least 43 characters");
        assert_ne!(base64_url(&sha256(&a)), a);
    }

    #[test]
    fn only_https_or_local_http_addresses_are_accepted() {
        for ok in ["https://a.run.app", "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost"] {
            assert!(check_base_url(ok).is_ok(), "{ok}");
        }
        for bad in ["http://example.com", "http://localhost.evil.com", "http://localhost@evil.com", "ftp://x", "", "https://",
                    "notes.example.org", "http://localhost:3000 /x"] {
            assert!(check_base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn form_values_are_escaped() {
        assert_eq!(form_encode(&[("a", "x y"), ("b", "p/q")]), "a=x%20y&b=p%2Fq");
        assert_eq!(urlencode("safe-_.~"), "safe-_.~");
    }

    /// Live check, run by hand: `cargo test --lib live_config -- --ignored`.
    #[test]
    #[ignore]
    fn live_config() {
        for u in ["https://practice-mgmt-321509350517.us-east4.run.app", "https://practice-mgmt-802176721153.us-east4.run.app"] {
            let (st, body) = api_request(u, "GET", "/api/desktop/v1/auth/config", None, None).unwrap();
            assert_eq!(st, 200);
            assert!(body.contains("\"googleSignIn\":true"), "{u}");
        }
    }
}
