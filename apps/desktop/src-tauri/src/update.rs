//! M14: tự cập nhật qua `tauri-plugin-updater`.
//!
//! Cài đặt NSIS ("passive") vẫn chạy im lặng như bộ cài thường. Việc phải làm là
//! đưa bản mới lên và kiểm chữ ký:
//! - GitHub Releases chỉ có một `latest.json` mỗi tag; CI tạo nó kèm chữ ký
//!   minisign của tệp NSIS, nên trình duyệt không cần server riêng.
//! - Khoá công khai trong `tauri.conf.json` do CI chèn từ secret. Bản build
//!   không ký vẫn cập nhật được sang bản có ký; build đã ký thì từ chối mọi
//!   tệp không khớp khoá.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::browser::{self, BrowserState};

/// Bản mới đang chờ, nếu người dùng vừa bấm "cập nhật". Phải hỏi xong mới biết
/// bản nào để tải, và câu trả lời giữ ở đây giữa hai lệnh check/install.
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
}

fn configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

/// Hỏi GitHub xem có bản mới không. `None` = đã mới nhất, chưa cấu hình khoá, hoặc
/// mạng lỗi — cả ba đều không được làm hỏng UI.
pub async fn check(app: AppHandle) -> Option<UpdateInfo> {
    if !configured(&app) {
        return None;
    }
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(15))
        .build()
        .ok()?
        .check()
        .await
        .ok()??;
    let info = UpdateInfo {
        version: update.version.clone(),
        current: update.current_version.clone(),
        notes: update.body.clone(),
    };
    if let Some(state) = app.try_state::<PendingUpdate>() {
        *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(update);
    }
    Some(info)
}

/// Tải và cài bản đang chờ. Trên Windows installer tự thoát app rồi mở lại, nên
/// hàm này có thể không trả về.
pub async fn install(app: AppHandle) -> Result<(), String> {
    let pending = app
        .try_state::<PendingUpdate>()
        .and_then(|s| s.0.lock().unwrap_or_else(|e| e.into_inner()).take())
        .ok_or_else(|| "không có bản cập nhật nào đang chờ".to_string())?;
    // Phiên phải được ghi trước khi installer đóng app, nếu không người dùng mất
    // danh sách tab sau khi cập nhật.
    if let Some(state) = app.try_state::<BrowserState>() {
        browser::persist_session(&app, &state);
    }
    pending
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("cập nhật thất bại: {e}"))
}
