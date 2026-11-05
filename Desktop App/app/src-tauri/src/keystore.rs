//! macOS Keychain access. Sign-in tokens and the queue's encryption key live here, never in settings.json.
//! Nothing in this file logs a value.

use serde::{Deserialize, Serialize};

const SERVICE: &str = "org.practice.notes";

/// The pair the practice app issues for one environment.
#[derive(Serialize, Deserialize, Clone)]
pub struct Tokens {
    pub access: String,
    pub refresh: String,
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, account).map_err(|_| "could not reach the Keychain".to_string())
}

fn get(account: &str) -> Result<Option<String>, String> {
    match entry(account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("could not read from the Keychain".into()),
    }
}

fn set(account: &str, value: &str) -> Result<(), String> {
    entry(account)?.set_password(value).map_err(|_| "could not save to the Keychain".to_string())
}

fn delete(account: &str) {
    if let Ok(e) = entry(account) {
        let _ = e.delete_credential();
    }
}

fn token_account(env: &str) -> String {
    format!("tokens-{env}")
}

pub fn load_tokens(env: &str) -> Option<Tokens> {
    let text = get(&token_account(env)).ok().flatten()?;
    serde_json::from_str::<Tokens>(&text).ok().filter(|t| !t.access.is_empty())
}

pub fn store_tokens(env: &str, t: &Tokens) -> Result<(), String> {
    let text = serde_json::to_string(t).map_err(|_| "could not prepare the tokens".to_string())?;
    set(&token_account(env), &text)
}

pub fn clear_tokens(env: &str) {
    delete(&token_account(env));
}

/// The 32-byte key that encrypts the transcript queue. Created on first use.
pub fn queue_key() -> Result<[u8; 32], String> {
    const ACCOUNT: &str = "queue-key";
    if let Some(hex) = get(ACCOUNT)? {
        if let Some(k) = crate::queue::key_from_hex(&hex) {
            return Ok(k);
        }
    }
    let bytes = crate::google::random_bytes(32)?;
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    set(ACCOUNT, &crate::queue::key_to_hex(&key))?;
    Ok(key)
}
