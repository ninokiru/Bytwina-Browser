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
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::browser::{self, BrowserState};
use crate::db::DbState;
use std::time::{SystemTime, UNIX_EPOCH};

/// Khoảng chờ giữa hai lần kiểm tra tự động khi mở app: 1 đến 3 giờ.
const COOLDOWN_MIN_SECS: u64 = 60 * 60;
const COOLDOWN_MAX_SECS: u64 = 3 * 60 * 60;
const NEXT_CHECK_KEY: &str = "updateNextCheck";

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Chọn ngẫu nhiên trong khoảng 1–3 giờ (lấy phần nano giây của đồng hồ, không cần crate RNG).
fn next_cooldown() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::from(d.subsec_nanos()))
        .unwrap_or(0);
    COOLDOWN_MIN_SECS + nanos % (COOLDOWN_MAX_SECS - COOLDOWN_MIN_SECS + 1)
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupCheck {
    pub status: String,
    pub info: Option<UpdateInfo>,
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
/// Kiểm tra thủ công (ví dụ từ menu): không bị khoảng chờ chặn.
pub async fn check(app: AppHandle) -> Option<UpdateInfo> {
    check_now(app).await.info
}

/// Kiểm tra khi mở app: trả về "skipped" nếu còn trong khoảng chờ 1–3 giờ.
/// Sau mỗi lần thật sự hỏi máy chủ (kể cả lỗi mạng) thì đặt mốc lần kiểm tra kế tiếp.
pub async fn check_startup(app: AppHandle) -> StartupCheck {
    if !configured(&app) {
        return StartupCheck {
            status: "unavailable".into(),
            info: None,
        };
    }
    let now = now_secs();
    let next = app
        .try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .and_then(|db| db.get_setting(NEXT_CHECK_KEY).ok().flatten())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    if now < next {
        return StartupCheck {
            status: "skipped".into(),
            info: None,
        };
    }
    let result = check_now(app.clone()).await;
    if let Some(db) = app.try_state::<DbState>().and_then(|s| s.0.clone()) {
        let _ = db.set_setting(NEXT_CHECK_KEY, &(now_secs() + next_cooldown()).to_string());
    }
    result
}

async fn check_now(app: AppHandle) -> StartupCheck {
    if !configured(&app) {
        return StartupCheck {
            status: "unavailable".into(),
            info: None,
        };
    }
    let result = app
        .updater_builder()
        .timeout(Duration::from_secs(15))
        .build();
    let updater = match result {
        Ok(updater) => updater,
        Err(_) => {
            return StartupCheck {
                status: "failed".into(),
                info: None,
            }
        }
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            return StartupCheck {
                status: "latest".into(),
                info: None,
            }
        }
        Err(_) => {
            return StartupCheck {
                status: "failed".into(),
                info: None,
            }
        }
    };
    let info = UpdateInfo {
        version: update.version.clone(),
        current: update.current_version.clone(),
        notes: update.body.clone(),
    };
    if let Some(state) = app.try_state::<PendingUpdate>() {
        *state.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(update);
    }
    StartupCheck {
        status: "available".into(),
        info: Some(info),
    }
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
    let progress_app = app.clone();
    let mut downloaded_bytes = 0u64;
    pending
        .download_and_install(
            move |chunk_length, content_length| {
                downloaded_bytes = downloaded_bytes.saturating_add(chunk_length as u64);
                let _ = progress_app.emit_to(
                    "toolbar",
                    "update://progress",
                    serde_json::json!({
                        "downloaded": downloaded_bytes,
                        "total": content_length,
                    }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("cập nhật thất bại: {e}"))
}
