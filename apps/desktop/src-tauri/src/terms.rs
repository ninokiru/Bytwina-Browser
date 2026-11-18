//! Điều khoản sử dụng: phải chấp nhận trước khi dùng trình duyệt.
//! Trạng thái lưu trong bảng settings. Lỗi đọc CSDL được coi là CHƯA chấp nhận.

use tauri::{AppHandle, Manager};

use crate::db::DbState;

/// Phải khớp với TERMS_VERSION trong apps/desktop/src/terms.ts.
/// Đổi số này khi điều khoản thay đổi để yêu cầu chấp nhận lại.
pub const TERMS_VERSION: &str = "2026-11-19";

const SETTING_KEY: &str = "acceptedTermsVersion";

pub fn is_accepted(app: &AppHandle) -> bool {
    let db = app.try_state::<DbState>().and_then(|s| s.0.clone());
    match db {
        Some(db) => matches!(db.get_setting(SETTING_KEY), Ok(Some(v)) if v == TERMS_VERSION),
        None => false,
    }
}

pub fn accept(app: &AppHandle) -> Result<(), String> {
    let db = app
        .try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .ok_or("cơ sở dữ liệu chưa sẵn sàng; không thể lưu việc chấp nhận")?;
    db.set_setting(SETTING_KEY, TERMS_VERSION)
}
