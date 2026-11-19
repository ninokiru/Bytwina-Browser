//! Điều khoản sử dụng: phải chấp nhận trước khi dùng trình duyệt.
//! Trạng thái lưu trong bảng settings. Lỗi đọc CSDL được coi là CHƯA chấp nhận.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};

use crate::db::DbState;

/// Phải khớp với TERMS_VERSION trong apps/desktop/src/terms.ts.
/// Đổi số này khi điều khoản thay đổi để yêu cầu chấp nhận lại.
pub const TERMS_VERSION: &str = "2026-11-19";

const SETTING_KEY: &str = "acceptedTermsVersion";

/// Chỉ nhớ kết quả "đã chấp nhận": lệnh này chạy mỗi lần điều hướng và mở tab.
/// Không cache kết quả false để người dùng bấm chấp nhận ở lần chạy sau vẫn đúng.
static ACCEPTED: AtomicBool = AtomicBool::new(false);

pub fn is_accepted(app: &AppHandle) -> bool {
    if ACCEPTED.load(Ordering::Relaxed) {
        return true;
    }
    let db = app.try_state::<DbState>().and_then(|s| s.0.clone());
    let ok = match db {
        Some(db) => matches!(db.get_setting(SETTING_KEY), Ok(Some(v)) if v == TERMS_VERSION),
        None => false,
    };
    if ok {
        ACCEPTED.store(true, Ordering::Relaxed);
    }
    ok
}

pub fn accept(app: &AppHandle) -> Result<(), String> {
    let db = app
        .try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .ok_or("cơ sở dữ liệu chưa sẵn sàng; không thể lưu việc chấp nhận")?;
    db.set_setting(SETTING_KEY, TERMS_VERSION)?;
    ACCEPTED.store(true, Ordering::Relaxed);
    Ok(())
}
