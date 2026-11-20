//! Sao lưu và khôi phục cơ sở dữ liệu.
//!
//! Ba quyết định thiết kế, ghi lại vì cả ba đều trái với cách làm hiển nhiên:
//!
//! 1. **`VACUUM INTO` thay vì tính năng `backup` của rusqlite.** `backup` nằm sau
//!    feature `backup` mà Cargo.toml không bật; `VACUUM INTO` có sẵn từ SQLite 3.27
//!    (bản bundled là 3.54) và còn cho ra tệp đã nén gọn, không có trang rác.
//! 2. **Chỉ ghi vào thư mục riêng của ứng dụng.** Người dùng không nhập đường dẫn,
//!    nên không có đường nào để lọt `..` hay một vị trí ngoài ý.
//! 3. **Khôi phục deferred tới lần khởi động sau.** Đang chạy thì kết nối SQLite
//!    còn mở, và SQLite không định nghĩa hành vi "thay tệp CSDL underneath" một
//!    cách an toàn. Ta ghi một marker; `db::open` áp dụng trước khi mở kết nối.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::db::Db;

/// Tên marker báo "khôi phục chờ lần khởi động sau"; chứa tên tệp bản lưu.
pub const PENDING_FILE: &str = "pending-restore.txt";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub bytes: u64,
    /// Giây từ epoch theo thời gian sửa tệp gần nhất.
    pub modified_at: i64,
}

pub fn dir(app_data: &Path) -> PathBuf {
    app_data.join("backups")
}

/// Tên bản lưu do ta sinh ra: `bytwina-<unix giây>.db`.
fn stamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// `VACUUM main INTO` cần tệp đích CHƯA tồn tại (hoặc rỗng) theo tài liệu SQLite,
/// nên nếu trùng tên thì xóa trước. Trả về số byte của tệp vừa ghi.
pub fn create(db: &Db, app_data: &Path) -> Result<BackupInfo, String> {
    let to = dir(app_data);
    std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
    let path = to.join(format!("bytwina-{}.db", stamp()));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    // execute chứ không phải execute_batch: batch không truyền được tham số.
    db.vacuum_into(&path)?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(BackupInfo {
        name: file_name(&path),
        bytes,
        modified_at: stamp(),
    })
}

pub fn list(app_data: &Path) -> Vec<BackupInfo> {
    let Ok(entries) = std::fs::read_dir(dir(app_data)) else {
        return Vec::new();
    };
    let mut out: Vec<BackupInfo> = entries
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|s| s.to_str()) != Some("db") {
                return None;
            }
            let meta = path.metadata().ok()?;
            let modified_at = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Some(BackupInfo {
                name: file_name(&path),
                bytes: meta.len(),
                modified_at,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    out
}

pub fn delete(app_data: &Path, name: &str) -> Result<(), String> {
    let path = safe_path(app_data, name)?;
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Ghi marker: việc nặng để dành cho `apply_pending` lúc khởi động.
pub fn request_restore(app_data: &Path, name: &str) -> Result<(), String> {
    let path = safe_path(app_data, name)?;
    if !path.is_file() {
        return Err("bản lưu không tồn tại".into());
    }
    std::fs::write(app_data.join(PENDING_FILE), name).map_err(|e| e.to_string())
}

/// Đọc và xóa marker. Gọi một lần trước khi mở kết nối SQLite.
pub fn take_pending(app_data: &Path) -> Option<String> {
    let marker = app_data.join(PENDING_FILE);
    let name = std::fs::read_to_string(&marker).ok()?;
    let _ = std::fs::remove_file(&marker);
    let name = name.trim().to_string();
    if name.is_empty() {
        return None;
    }
    Some(name)
}

/// Áp dụng bản lưu đang chờ: sao CSDL hiện tại (kèm WAL/SHM nếu có) sang thư mục
/// an toàn rồi đè bản lưu vào. Mọi lỗi chỉ được ghi nhật ký — ứng dụng vẫn phải
/// khởi động được với dữ liệu cũ hoặc mới, không bao giờ chết vì khôi phục dở.
pub fn apply_pending(app_data: &Path) -> Option<String> {
    let name = take_pending(app_data)?;
    let backup = match safe_path(app_data, &name) {
        Ok(p) if p.is_file() => p,
        _ => {
            crate::diagnostics::log("error", "bản lưu chờ khôi phục không tồn tại");
            return None;
        }
    };
    let live = app_data.join("bytwina.db");
    let safety = app_data.join(format!("pre-restore-{}", stamp()));
    if live.exists() {
        if std::fs::create_dir_all(&safety).is_err() {
            crate::diagnostics::log("error", "không tạo được thư mục an toàn trước khôi phục");
            return None;
        }
        for suffix in ["", "-wal", "-shm"] {
            let from = app_data.join(format!("bytwina.db{suffix}"));
            if from.is_file() {
                let _ = std::fs::copy(&from, safety.join(format!("bytwina.db{suffix}")));
            }
        }
    }
    if std::fs::copy(&backup, &live).is_err() {
        crate::diagnostics::log("error", "không chép được bản lưu vào CSDL");
        return None;
    }
    // Bản lưu không có WAL đi kèm; xóa WAL/SHM cũ của CSDL đang thay để SQLite
    // không ghép trang từ hai bản khác nhau.
    for suffix in ["-wal", "-shm"] {
        let _ = std::fs::remove_file(app_data.join(format!("bytwina.db{suffix}")));
    }
    crate::diagnostics::log("info", "đã khôi phục CSDL từ bản lưu");
    Some(name)
}

/// Tên tệp bản lưu phải là một cái tên trần, không đường dẫn, không `..`, kết thúc
/// bằng `.db`. Đây là chuỗi đến từ frontend nên vẫn phải kiểm tra dù đã ký tên.
fn safe_path(app_data: &Path, name: &str) -> Result<PathBuf, String> {
    let trimmed = name.trim();
    let ok = !trimmed.is_empty()
        && !trimmed.contains('/')
        && !trimmed.contains('\\')
        && trimmed != "."
        && trimmed != ".."
        && trimmed.ends_with(".db");
    if !ok {
        return Err("tên bản lưu không hợp lệ".into());
    }
    Ok(dir(app_data).join(trimmed))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "bytwina-backup-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = std::fs::create_dir_all(&base);
        base
    }

    /// Mở CSDL thật bằng đúng đường dẫn production: `db::open` cũng áp dụng bản
    /// lưu đang chờ, nên test đi qua cùng một cửa như lúc bật ứng dụng.
    fn db_in(dir: &Path) -> Db {
        crate::db::open(dir.to_path_buf()).expect("mở CSDL cho test thất bại")
    }

    #[test]
    fn rejects_paths_and_odd_names() {
        let d = temp_dir("name");
        assert!(safe_path(&d, "../evil.db").is_err());
        assert!(safe_path(&d, "a/b.db").is_err());
        assert!(safe_path(&d, "C:\\Windows\\x.db").is_err());
        assert!(safe_path(&d, "note.txt").is_err());
        assert!(safe_path(&d, "").is_err());
        assert!(safe_path(&d, "bytwina-1.db").is_ok());
    }

    #[test]
    fn backup_then_list_and_delete() {
        let d = temp_dir("roundtrip");
        let db = db_in(&d);
        db.set_setting("homeUrl", "https://example.test/").unwrap();
        let info = create(&db, &d).expect("tạo bản lưu thất bại");
        assert!(info.bytes > 0, "bản lưu rỗng: {info:?}");
        let names: Vec<String> = list(&d).iter().map(|b| b.name.clone()).collect();
        assert!(names.contains(&info.name));
        delete(&d, &info.name).unwrap();
        assert!(!list(&d).iter().any(|b| b.name == info.name));
    }

    #[test]
    fn pending_restore_is_applied_when_the_database_opens_next() {
        let d = temp_dir("restore");
        let db = db_in(&d);
        db.set_setting("homeUrl", "https://old.test/").unwrap();
        let info = create(&db, &d).unwrap();
        db.set_setting("homeUrl", "https://new.test/").unwrap();
        drop(db);

        request_restore(&d, &info.name).unwrap();
        // Đánh dấu chưa đủ: dữ liệu vẫn là bản mới cho tới khi mở lại.
        assert!(d.join(PENDING_FILE).exists());

        let after = db_in(&d);
        assert_eq!(
            after.get_setting("homeUrl").unwrap().as_deref(),
            Some("https://old.test/")
        );
        drop(after);
        assert!(!d.join(PENDING_FILE).exists());
        // CSDL trước khi khôi phục phải còn bản an toàn, phòng khi khôi phục sai.
        assert!(std::fs::read_dir(&d)
            .unwrap()
            .flatten()
            .any(|e| e
                .file_name()
                .to_string_lossy()
                .starts_with("pre-restore-")));
    }

    #[test]
    fn pending_marker_is_consumed_once() {
        let d = temp_dir("marker");
        std::fs::write(d.join(PENDING_FILE), "bytwina-1.db").unwrap();
        assert_eq!(take_pending(&d).as_deref(), Some("bytwina-1.db"));
        assert_eq!(take_pending(&d), None);
    }

    #[test]
    fn missing_backup_is_not_applied() {
        let d = temp_dir("missing");
        std::fs::write(d.join(PENDING_FILE), "khong-ton-tai.db").unwrap();
        assert_eq!(apply_pending(&d), None);
        // Marker đã bị lấy đi, lần khởi động sau không thử lại vô ích.
        assert!(!d.join(PENDING_FILE).exists());
    }
}
