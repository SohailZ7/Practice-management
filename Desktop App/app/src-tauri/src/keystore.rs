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

const VAULT: &str = "vault";

/// Everything secret, in one Keychain item so there is at most one prompt. Held in memory after the first read; the
/// Keychain is never touched again per request, poll or timer tick, only when something changes.
#[derive(Serialize, Deserialize, Default, Clone)]
struct Vault {
    #[serde(default)]
    tokens: std::collections::BTreeMap<String, Tokens>,
    #[serde(default)]
    queue_key: Option<String>,
}

/// `None` = not read yet; `Some(Err)` = the Keychain refused this run (not retried, so no prompt loop).
static CACHE: std::sync::Mutex<Option<Result<Vault, String>>> = std::sync::Mutex::new(None);

fn read_vault() -> Result<Vault, String> {
    if let Some(text) = get(VAULT)? {
        return serde_json::from_str(&text).map_err(|_| "the Keychain item is unreadable".to_string());
    }
    // First run of this version: fold the older separate items into the single one.
    let mut v = Vault::default();
    for (env, _) in crate::ENVIRONMENTS.iter() {
        let acct = format!("tokens-{env}");
        if let Some(t) = get(&acct).ok().flatten().and_then(|t| serde_json::from_str::<Tokens>(&t).ok()) {
            if !t.access.is_empty() {
                v.tokens.insert(env.to_string(), t);
            }
        }
    }
    if let Some(hex) = get("queue-key").ok().flatten() {
        if crate::queue::key_from_hex(&hex).is_some() {
            v.queue_key = Some(hex);
        }
    }
    if !v.tokens.is_empty() || v.queue_key.is_some() {
        set(VAULT, &serde_json::to_string(&v).map_err(|_| "could not prepare the Keychain item".to_string())?)?;
        for (env, _) in crate::ENVIRONMENTS.iter() {
            delete(&format!("tokens-{env}"));
        }
        delete("queue-key");
    }
    Ok(v)
}

/// Runs `f` on the cached vault (reading the Keychain once, the first time). If `f` returns true the vault is saved.
fn with_vault<R>(f: impl FnOnce(&mut Vault) -> (R, bool)) -> Result<R, String> {
    let mut guard = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(read_vault());
    }
    let v = match guard.as_mut().unwrap() {
        Ok(v) => v,
        Err(e) => return Err(format!("{e}. Quit and reopen the app and choose Always Allow when macOS asks.")),
    };
    let (r, changed) = f(v);
    if changed {
        let text = serde_json::to_string(&*v).map_err(|_| "could not prepare the Keychain item".to_string())?;
        set(VAULT, &text)?;
    }
    Ok(r)
}

pub fn load_tokens(env: &str) -> Option<Tokens> {
    with_vault(|v| (v.tokens.get(env).cloned(), false)).ok().flatten()
}

pub fn store_tokens(env: &str, t: &Tokens) -> Result<(), String> {
    with_vault(|v| {
        v.tokens.insert(env.to_string(), t.clone());
        ((), true)
    })
}

pub fn clear_tokens(env: &str) {
    let _ = with_vault(|v| ((), v.tokens.remove(env).is_some()));
}

/// The 32-byte key that encrypts the transcript queue. Created on first use.
pub fn queue_key() -> Result<[u8; 32], String> {
    if let Some(k) = with_vault(|v| (v.queue_key.as_deref().and_then(crate::queue::key_from_hex), false))? {
        return Ok(k);
    }
    let bytes = crate::google::random_bytes(32)?;
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    let hex = crate::queue::key_to_hex(&key);
    with_vault(|v| {
        v.queue_key = Some(hex);
        ((), true)
    })?;
    Ok(key)
}
