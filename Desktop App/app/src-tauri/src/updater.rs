//! Self-update. The practice app serves an authenticated update feed (`/api/desktop/v1/update/<target>/<version>`);
//! the app asks it with the signed-in user's token, verifies the download against the public key in tauri.conf.json,
//! and replaces itself. The frontend decides WHEN (never during a recording); this file only checks and installs.
use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
}

fn updater(app: &tauri::AppHandle, base_url: &str, token: &str) -> Result<tauri_plugin_updater::Updater, String> {
    let base = base_url.trim_end_matches('/');
    if !(base.starts_with("https://") || base.starts_with("http://localhost")) {
        return Err("Updates only come from the practice app over https.".into());
    }
    let url = format!("{base}/api/desktop/v1/update/{{{{target}}}}-{{{{arch}}}}/{{{{current_version}}}}");
    let url: tauri::Url = url.parse().map_err(|_| "Bad update address.".to_string())?;
    app.updater_builder()
        .endpoints(vec![url]).map_err(|e| e.to_string())?
        .header("Authorization", format!("Bearer {token}")).map_err(|e| e.to_string())?
        // Any different version applies, so pointing the feed at an older build is a working rollback.
        .version_comparator(|current, remote| remote.version != current)
        .build().map_err(|e| e.to_string())
}

/// Asks the feed whether another version is published. Ok(None) = up to date.
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle, base_url: String, token: String) -> Result<Option<UpdateInfo>, String> {
    let u = updater(&app, &base_url, &token)?;
    match u.check().await {
        Ok(Some(up)) => Ok(Some(UpdateInfo { version: up.version.clone(), notes: up.body.clone().unwrap_or_default() })),
        Ok(None) => Ok(None),
        Err(e) => Err(short(&e.to_string())),
    }
}

/// Downloads, verifies the signature, installs, and relaunches. The frontend only calls this when nothing is recording.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, base_url: String, token: String) -> Result<(), String> {
    let u = updater(&app, &base_url, &token)?;
    let Some(up) = u.check().await.map_err(|e| short(&e.to_string()))? else { return Ok(()) };
    up.download_and_install(|_, _| {}, || {}).await.map_err(|e| short(&e.to_string()))?;
    app.restart();
}

fn short(s: &str) -> String {
    s.chars().take(160).collect()
}
