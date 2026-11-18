use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Lưu trữ SQLite cho M2: bookmarks, history, preferences, session.
/// Kết nối đặt sau Arc<Mutex> để các lệnh async dùng song song mà không giữ khóa DB.
#[derive(Clone)]
pub struct Db {
    conn: std::sync::Arc<Mutex<Connection>>,
}

impl Db {
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub folder: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub visited_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTab {
    pub url: String,
    pub title: String,
}

#[derive(Default)]
pub struct DbState(pub Option<Db>);

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Mở DB và chạy migrations. Trả về None nếu môi trường không cho phép
/// (mọi tính năng M2 tự tắt, trình duyệt nền vẫn chạy).
pub fn open(app_data_dir: PathBuf) -> Option<Db> {
    let _ = std::fs::create_dir_all(&app_data_dir);
    let conn = Connection::open(app_data_dir.join("nova.db")).ok()?;
    conn.pragma_update(None, "journal_mode", "WAL").ok()?;
    conn.pragma_update(None, "synchronous", "NORMAL").ok()?;
    migrate(&conn).ok()?;
    migrate_downloads(&conn).ok()?;
    Some(Db {
        conn: std::sync::Arc::new(Mutex::new(conn)),
    })
}

/// M3: bảng tải xuống. Dùng CREATE IF NOT EXISTS nên chạy lại an toàn.
/// TODO: gộp vào hệ thống schema_version khi có migration thứ hai.
fn migrate_downloads(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS downloads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            path TEXT NOT NULL DEFAULT '',
            success INTEGER NOT NULL,
            finished_at INTEGER NOT NULL
        );",
    )
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
         INSERT INTO schema_version (version) SELECT 1 WHERE (SELECT COUNT(*) FROM schema_version) = 0;",
    )?;
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
        .unwrap_or(0);
    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL UNIQUE,
                folder TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL,
                visited_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_visited ON history (visited_at DESC);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS session_tabs (
                ord INTEGER PRIMARY KEY,
                url TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS session_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;
    }
    Ok(())
}

impl Db {
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn add_bookmark(&self, title: &str, url: &str, folder: &str) -> Result<i64, String> {
        let c = self.conn();
        c.execute(
            "INSERT INTO bookmarks (title, url, folder, created_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(url) DO UPDATE SET title = excluded.title, folder = excluded.folder",
            params![title, url, folder, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(c.last_insert_rowid())
    }

    pub fn remove_bookmark(&self, id: i64) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM bookmarks WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_bookmarks(&self) -> Result<Vec<Bookmark>, String> {
        let c = self.conn();
        let mut stmt = c
            .prepare(
                "SELECT id, title, url, folder, created_at FROM bookmarks ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Bookmark {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    url: r.get(2)?,
                    folder: r.get(3)?,
                    created_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn record_history(&self, title: &str, url: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "INSERT INTO history (title, url, visited_at) VALUES (?1, ?2, ?3)",
                params![title, url, now()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn search_history(&self, query: &str, limit: i64) -> Result<Vec<HistoryItem>, String> {
        let c = self.conn();
        let pattern = format!("%{query}%");
        let mut stmt = c
            .prepare(
                "SELECT id, title, url, visited_at FROM history
                 WHERE url LIKE ?1 OR title LIKE ?1 ORDER BY visited_at DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pattern, limit], |r| {
                Ok(HistoryItem {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    url: r.get(2)?,
                    visited_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn clear_history(&self) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM history", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let c = self.conn();
        c.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get::<_, String>(0),
        )
        .map(Some)
        .or_else(|e| {
            if e == rusqlite::Error::QueryReturnedNoRows {
                Ok(None)
            } else {
                Err(e.to_string())
            }
        })
    }

    /// Ghi lại danh sách tab hiện hành (session restore).
    pub fn save_session(&self, tabs: &[SessionTab], active_index: i64) -> Result<(), String> {
        let mut c = self.conn();
        let tx = c.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM session_tabs", [])
            .map_err(|e| e.to_string())?;
        for (i, t) in tabs.iter().enumerate() {
            tx.execute(
                "INSERT INTO session_tabs (ord, url, title) VALUES (?1, ?2, ?3)",
                params![i as i64, t.url, t.title],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT INTO session_meta (key, value) VALUES ('active', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![active_index],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn load_session(&self) -> Result<(Vec<SessionTab>, i64), String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT url, title FROM session_tabs ORDER BY ord ASC")
            .map_err(|e| e.to_string())?;
        let tabs = stmt
            .query_map([], |r| {
                Ok(SessionTab {
                    url: r.get(0)?,
                    title: r.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        let active = c
            .query_row(
                "SELECT value FROM session_meta WHERE key = 'active'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(-1);
        Ok((tabs, active))
    }

    pub fn clear_session(&self) -> Result<(), String> {
        let mut c = self.conn();
        let tx = c.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM session_tabs", [])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM session_meta", [])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db(tag: &str) -> Db {
        // Mỗi test một DB riêng, tên độc nhất theo tiến trình + đồng hồ + bộ đếm.
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "nova-test-{tag}-{}-{}-{n}",
            std::process::id(),
            now_nanos()
        ));
        open(dir).expect("mở DB tạm thất bại")
    }

    fn now_nanos() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    }

    #[test]
    fn bookmark_roundtrip() {
        let db = temp_db("bm");
        db.add_bookmark("Một", "https://a.test/", "").unwrap();
        // URL trùng → cập nhật tiêu đề, không tạo bản ghi mới.
        db.add_bookmark("Một mới", "https://a.test/", "ĐỌC")
            .unwrap();
        db.add_bookmark("Hai", "https://b.test/", "").unwrap();
        let all = db.list_bookmarks().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].title, "Một mới");
        assert_eq!(all[0].folder, "ĐỌC");
        db.remove_bookmark(all[1].id).unwrap();
        assert_eq!(db.list_bookmarks().unwrap().len(), 1);
    }

    #[test]
    fn history_search_and_clear() {
        let db = temp_db("hist");
        db.record_history("Trang đầu", "https://one.test/").unwrap();
        db.record_history("Trang sau", "https://two.test/").unwrap();
        let hits = db.search_history("one", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url, "https://one.test/");
        assert_eq!(db.search_history("", 50).unwrap().len(), 2);
        db.clear_history().unwrap();
        assert!(db.search_history("", 50).unwrap().is_empty());
    }

    #[test]
    fn settings_upsert() {
        let db = temp_db("set");
        assert_eq!(db.get_setting("homeUrl").unwrap(), None);
        db.set_setting("homeUrl", "https://a.test/").unwrap();
        db.set_setting("homeUrl", "https://b.test/").unwrap();
        assert_eq!(
            db.get_setting("homeUrl").unwrap().as_deref(),
            Some("https://b.test/")
        );
    }

    #[test]
    fn session_save_load_clear() {
        let db = temp_db("sess");
        let tabs = vec![
            SessionTab {
                url: "https://a.test/".into(),
                title: "A".into(),
            },
            SessionTab {
                url: "https://b.test/".into(),
                title: "B".into(),
            },
        ];
        db.save_session(&tabs, 1).unwrap();
        let (loaded, active) = db.load_session().unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(active, 1);
        // Ghi đè: danh sách mới thay thế hoàn toàn.
        db.save_session(&tabs[..1], 0).unwrap();
        let (loaded, _) = db.load_session().unwrap();
        assert_eq!(loaded.len(), 1);
        db.clear_session().unwrap();
        let (loaded, active) = db.load_session().unwrap();
        assert!(loaded.is_empty());
        assert_eq!(active, -1);
    }
}

/// Một lần tải xuống đã hoàn tất (M3).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: i64,
    pub url: String,
    pub path: String,
    pub success: bool,
    pub finished_at: i64,
}

impl Db {
    pub fn record_download(&self, url: &str, path: &str, success: bool) -> Result<(), String> {
        self.conn()
            .execute(
                "INSERT INTO downloads (url, path, success, finished_at) VALUES (?1, ?2, ?3, ?4)",
                params![url, path, success, now()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_downloads(&self) -> Result<Vec<DownloadItem>, String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT id, url, path, success, finished_at FROM downloads ORDER BY id DESC LIMIT 200")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(DownloadItem {
                    id: r.get(0)?,
                    url: r.get(1)?,
                    path: r.get(2)?,
                    success: r.get::<_, i64>(3)? != 0,
                    finished_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let out = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string());
        out
    }

    pub fn clear_downloads(&self) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM downloads", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
