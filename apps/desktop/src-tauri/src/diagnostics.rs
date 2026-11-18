//! M7: nhật ký đơn giản và thông tin chẩn đoán. Không phụ thuộc crate ngoài.
//! Nhật ký không ghi URL hay nội dung trang để tránh lộ dữ liệu người dùng.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

/// Ngưỡng xoay vòng: vượt quá thì đổi tên thành bytwina.log.old và ghi file mới.
const MAX_LOG_BYTES: u64 = 512 * 1024;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Gọi một lần lúc khởi động, khi đã biết thư mục dữ liệu ứng dụng.
pub fn init(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut p) = LOG_PATH.lock() {
        *p = Some(dir.join("bytwina.log"));
    }
}

pub fn log(level: &str, msg: &str) {
    let Some(path) = LOG_PATH.lock().ok().and_then(|p| p.clone()) else {
        return;
    };
    let too_big = std::fs::metadata(&path)
        .map(|m| m.len() > MAX_LOG_BYTES)
        .unwrap_or(false);
    if too_big {
        let _ = std::fs::rename(&path, path.with_extension("log.old"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(f, "{ts} [{level}] {msg}");
    }
}

/// Thông tin chẩn đoán gửi cho trang Cài đặt (dùng khi báo lỗi).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub app_version: String,
    pub webview_version: String,
    pub os: String,
    pub db_available: bool,
}

pub fn collect(db_available: bool) -> Diagnostics {
    Diagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        webview_version: tauri::webview_version()
            .unwrap_or_else(|e| format!("không xác định ({e})")),
        os: std::env::consts::OS.to_string(),
        db_available,
    }
}
