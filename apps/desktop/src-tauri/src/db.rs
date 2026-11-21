use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Lưu trữ SQLite cho M2: bookmarks, history, preferences, session.
/// Kết nối đặt sau Arc<Mutex> để các lệnh async dùng song song mà không giữ khóa DB.
/// `settings` là bản sao toàn bộ bảng settings: đường đọc nóng (mỗi lượt điều hướng,
/// mỗi lần tạo tab) không phải chạm khóa connection nữa.
#[derive(Clone)]
pub struct Db {
    conn: std::sync::Arc<Mutex<Connection>>,
    settings: std::sync::Arc<Mutex<HashMap<String, String>>>,
}

impl Db {
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn settings_cache(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.settings.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Ghi toàn bộ CSDL ra một tệp khác, gọn và nhất quán, bằng `VACUUM INTO`
    /// (có sẵn từ SQLite 3.27, không cần bật feature `backup` của rusqlite).
    /// Tệp đích chưa được tồn tại theo tài liệu SQLite — bên gọi lo việc đó.
    pub fn vacuum_into(&self, dest: &std::path::Path) -> Result<(), String> {
        let text = dest.to_string_lossy().into_owned();
        self.conn()
            .execute("VACUUM main INTO ?1", params![text])
            .map(|_| ())
            .map_err(|e| format!("không tạo được bản lưu: {e}"))
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
    /// Tab được ghim (M5) — cần lưu để khôi phục đúng thứ tự.
    #[serde(default)]
    pub pinned: bool,
    /// Tên nhóm tab (M5); None là không thuộc nhóm nào.
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Default)]
pub struct DbState(pub Option<Db>);

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn history_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryItem> {
    Ok(HistoryItem {
        id: r.get(0)?,
        title: r.get(1)?,
        url: r.get(2)?,
        visited_at: r.get(3)?,
    })
}

/// Mở DB và chạy migrations. Trả về None nếu môi trường không cho phép
/// (mọi tính năng M2 tự tắt, trình duyệt nền vẫn chạy).
pub fn open(app_data_dir: PathBuf) -> Option<Db> {
    let _ = std::fs::create_dir_all(&app_data_dir);
    // Khôi phục đang chờ phải áp dụng TRƯỚC khi mở kết nối: SQLite không định nghĩa
    // hành vi thay tệp CSDL khi connection còn đang mở.
    crate::backup::apply_pending(&app_data_dir);
    let conn = Connection::open(app_data_dir.join("bytwina.db")).ok()?;
    // WAL thất bại vẫn dùng được (vd. thư mục nằm trên ổ đồng bộ); không vì thế
    // mà tắt toàn bộ lịch sử/dấu trang/phiên.
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    migrate(&conn).ok()?;
    let mut cached = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM settings") {
        if let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        {
            for (k, v) in rows.flatten() {
                cached.insert(k, v);
            }
        }
    }
    Some(Db {
        conn: std::sync::Arc::new(Mutex::new(conn)),
        settings: std::sync::Arc::new(Mutex::new(cached)),
    })
}

/// Bảng nền tảng (v1). Chạy lại mỗi lần mở DB bằng `IF NOT EXISTS` để DB bị
/// thiếu bảng (bản cũ, migration đứt gãy) vẫn tự phục hồi.
const CORE_TABLES: &str = "
    CREATE TABLE IF NOT EXISTS bookmarks (
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
        title TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        group_name TEXT
    );
    CREATE TABLE IF NOT EXISTS session_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );";

/// Bảng thêm ở M3/M10 — tách riêng để DB tạo bởi bản cũ vẫn có đủ.
const TABLES_M3_M10: &str = "
    CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '',
        success INTEGER NOT NULL,
        finished_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reading_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL UNIQUE,
        added_at INTEGER NOT NULL
    );";

/// Kho mật khẩu (M11): chỉ tiêu đề/URL/tên đăng nhập là chữ rõ để tìm kiếm;
/// mật khẩu và ghi chú nằm trong `secret` đã mã hóa AES-256-GCM.
const TABLES_M11: &str = "
    CREATE TABLE IF NOT EXISTS password_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL DEFAULT '',
        secret BLOB NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favicons (
        domain TEXT PRIMARY KEY,
        data_url TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );";

/// Thêm cột nếu chưa có (SQLite không có `ADD COLUMN IF NOT EXISTS`).
fn add_column(conn: &Connection, table: &str, column: &str, decl: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"),
        [],
    )?;
    Ok(())
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);")?;
    // Luôn đảm bảo bảng nền tảng tồn tại, kể cả khi version đã ghi là 1/2.
    conn.execute_batch(CORE_TABLES)?;
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
        .unwrap_or(0);
    if version < 1 {
        // Cột pinned/group_name đã nằm trong CORE_TABLES khi tạo mới; DB v1 cũ
        // được thêm ở bước v2 bên dưới.
        // Ghi phiên bản SAU khi tạo bảng; trước đây ghi trước nên nhánh tạo bảng không bao giờ chạy.
        conn.execute("INSERT INTO schema_version (version) VALUES (1)", [])?;
    }
    if version < 2 {
        // v2: lưu trạng thái ghim/nhóm của tab và đưa bảng M3/M10 vào cùng
        // hệ thống migration thay vì tạo rời rạc.
        add_column(conn, "session_tabs", "pinned", "INTEGER NOT NULL DEFAULT 0")?;
        add_column(conn, "session_tabs", "group_name", "TEXT")?;
        conn.execute_batch(TABLES_M3_M10)?;
        conn.execute("INSERT INTO schema_version (version) VALUES (2)", [])?;
    }
    if version < 3 {
        // v3: kho mật khẩu mã hóa (M11). Bảng dùng IF NOT EXISTS nên DB đã có
        // bảng này (mở lại nhiều lần) vẫn an toàn.
        conn.execute_batch(TABLES_M11)?;
        conn.execute("INSERT INTO schema_version (version) VALUES (3)", [])?;
    }
    if version < 4 {
        // v4: cache favicon cho domain
        conn.execute_batch("CREATE TABLE IF NOT EXISTS favicons (domain TEXT PRIMARY KEY, data_url TEXT NOT NULL, updated_at INTEGER NOT NULL);")?;
        conn.execute("INSERT INTO schema_version (version) VALUES (4)", [])?;
    }
    if version < 5 {
        // v5: ghi chú gắn liền với URL (URL-Attached Notes) và lưu phiên theo tên (Named Sessions)
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS page_notes (
                url TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS saved_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                tabs_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
        ")?;
        conn.execute("INSERT INTO schema_version (version) VALUES (5)", [])?;
    }
    Ok(())
}

impl Db {
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
        let c = self.conn();
        // Reload và quay tới lui không nên tạo bản trùng: nếu bản ghi mới nhất đã là
        // URL này thì chỉ bổ sung tiêu đề (lần đầu có thể chưa đọc được title).
        let last: Option<String> = c
            .query_row("SELECT url FROM history ORDER BY id DESC LIMIT 1", [], |r| r.get(0))
            .ok();
        if last.as_deref() == Some(url) {
            if !title.is_empty() {
                c.execute(
                    "UPDATE history SET title = ?1 WHERE id = (SELECT MAX(id) FROM history)",
                    params![title],
                )
                .map_err(|e| e.to_string())?;
            }
            return Ok(());
        }
        c.execute(
            "INSERT INTO history (title, url, visited_at) VALUES (?1, ?2, ?3)",
            params![title, url, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Tìm trong lịch sử. Để trống ô tìm kiếm là trường hợp phổ biến nhất nên đi
    /// thẳng theo chỉ mục thời gian; `LIKE '%x%'` chỉ dùng khi có từ khóa.
    pub fn search_history(&self, query: &str, limit: i64) -> Result<Vec<HistoryItem>, String> {
        let c = self.conn();
        let keyword = query.trim();
        let items = if keyword.is_empty() {
            let mut stmt = c
                .prepare(
                    "SELECT id, title, url, visited_at FROM history
                     ORDER BY visited_at DESC LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![limit], history_row)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        } else {
            let pattern = format!("%{keyword}%");
            let mut stmt = c
                .prepare(
                    "SELECT id, title, url, visited_at FROM history
                     WHERE url LIKE ?1 OR title LIKE ?1 ORDER BY visited_at DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![pattern, limit], history_row)
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        Ok(items)
    }

    pub fn clear_history(&self) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM history", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Xóa lịch sử truy cập trước mốc `since` (unix giây), trả số bản ghi đã xóa.
    /// Mốc do người dùng chọn trong Cài đặt: 1 giờ / 24 giờ / 7 ngày.
    pub fn clear_history_older_than(&self, since: i64) -> Result<usize, String> {
        self.conn()
            .execute("DELETE FROM history WHERE visited_at < ?1", params![since])
            .map_err(|e| e.to_string())
    }

    /// Như trên cho danh sách tải xuống; cột thời gian của nó là `finished_at`.
    pub fn clear_downloads_older_than(&self, since: i64) -> Result<usize, String> {
        self.conn()
            .execute("DELETE FROM downloads WHERE finished_at < ?1", params![since])
            .map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        // Ghi DB xong mới cập nhật bộ nhớ để cache không bao giờ đi trước sự thật.
        self.settings_cache().insert(key.to_string(), value.to_string());
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        Ok(self.settings_cache().get(key).cloned())
    }

    pub fn remove_setting(&self, key: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
        self.settings_cache().remove(key);
        Ok(())
    }

    /// Ghi lại danh sách tab hiện hành (session restore).
    pub fn save_session(&self, tabs: &[SessionTab], active_index: i64) -> Result<(), String> {
        let mut c = self.conn();
        let tx = c.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM session_tabs", [])
            .map_err(|e| e.to_string())?;
        for (i, t) in tabs.iter().enumerate() {
            tx.execute(
                "INSERT INTO session_tabs (ord, url, title, pinned, group_name)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![i as i64, t.url, t.title, t.pinned as i64, t.group],
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
            .prepare("SELECT url, title, pinned, group_name FROM session_tabs ORDER BY ord ASC")
            .map_err(|e| e.to_string())?;
        let tabs = stmt
            .query_map([], |r| {
                Ok(SessionTab {
                    url: r.get(0)?,
                    title: r.get(1)?,
                    pinned: r.get::<_, i64>(2)? != 0,
                    group: r.get(3)?,
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

    pub fn get_favicon(&self, domain: &str) -> Result<Option<String>, String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT data_url FROM favicons WHERE domain = ?1 AND updated_at > ?2")
            .map_err(|e| e.to_string())?;
        // TTL 7 ngày (7 * 86400 giây)
        let expire_threshold = now() - 7 * 86_400;
        let res = stmt
            .query_row(params![domain, expire_threshold], |r| r.get::<_, String>(0))
            .ok();
        Ok(res)
    }

    pub fn set_favicon(&self, domain: &str, data_url: &str) -> Result<(), String> {
        let c = self.conn();
        c.execute(
            "INSERT INTO favicons (domain, data_url, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(domain) DO UPDATE SET data_url = excluded.data_url, updated_at = excluded.updated_at",
            params![domain, data_url, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ===== Ghi chú theo URL (URL-Attached Notes) =====
    pub fn get_note(&self, url: &str) -> Result<Option<String>, String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT content FROM page_notes WHERE url = ?1")
            .map_err(|e| e.to_string())?;
        let res = stmt
            .query_row(params![url], |r| r.get::<_, String>(0))
            .ok();
        Ok(res)
    }

    pub fn set_note(&self, url: &str, content: &str) -> Result<(), String> {
        let c = self.conn();
        // Ghi chú rỗng nghĩa là xoá: không giữ hàng trống làm bẩn danh sách.
        if content.trim().is_empty() {
            c.execute("DELETE FROM page_notes WHERE url = ?1", params![url])
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        c.execute(
            "INSERT INTO page_notes (url, content, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(url) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
            params![url, content, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_note(&self, url: &str) -> Result<(), String> {
        let c = self.conn();
        c.execute("DELETE FROM page_notes WHERE url = ?1", params![url])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Mọi ghi chú, mới nhất trước — dùng cho xuất Markdown.
    pub fn list_notes(&self) -> Result<Vec<(String, String, i64)>, String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT url, content, updated_at FROM page_notes ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    // ===== Lưu phiên theo tên (Named Sessions) =====
    pub fn save_named_session(&self, name: &str, tabs_json: &str) -> Result<(), String> {
        let c = self.conn();
        c.execute(
            "INSERT INTO saved_sessions (name, tabs_json, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(name) DO UPDATE SET tabs_json = excluded.tabs_json, created_at = excluded.created_at",
            params![name, tabs_json, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_named_sessions(&self) -> Result<Vec<(String, String, i64)>, String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT name, tabs_json, created_at FROM saved_sessions ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn delete_named_session(&self, name: &str) -> Result<(), String> {
        let c = self.conn();
        c.execute("DELETE FROM saved_sessions WHERE name = ?1", params![name])
            .map_err(|e| e.to_string())?;
        Ok(())
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
            "bytwina-test-{tag}-{}-{}-{n}",
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
    fn repeated_visit_updates_last_row_instead_of_duplicating() {
        let db = temp_db("hist-dedup");
        db.record_history("", "https://one.test/").unwrap();
        // Reload: cùng URL vẫn là bản ghi mới nhất → chỉ bổ sung tiêu đề.
        db.record_history("Trang một", "https://one.test/").unwrap();
        let rows = db.search_history("", 50).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "Trang một");
        // URL khác vẫn tạo bản ghi mới.
        db.record_history("Trang hai", "https://two.test/").unwrap();
        assert_eq!(db.search_history("", 50).unwrap().len(), 2);
    }

    #[test]
    fn time_range_clear_keeps_recent_rows() {
        let db = temp_db("hist-range");
        let now = now();
        db.record_history("Cũ", "https://old.test/").unwrap();
        db.record_history("Mới", "https://new.test/").unwrap();
        // record_history luôn ghi now(), nên kéo một bản về một ngày trước.
        db.conn()
            .execute(
                "UPDATE history SET visited_at = ?1 WHERE url = ?2",
                params![now - 86_400, "https://old.test/"],
            )
            .unwrap();

        let removed = db.clear_history_older_than(now - 3_600).unwrap();
        assert_eq!(removed, 1);
        let left = db.search_history("", 50).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].url, "https://new.test/");

        // Khoảng "toàn bộ" vẫn dùng lệnh xóa trắng, không liên quan mốc này.
        assert_eq!(db.clear_history_older_than(now + 10).unwrap(), 1);
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
                pinned: true,
                group: Some("ĐỌC".into()),
            },
            SessionTab {
                url: "https://b.test/".into(),
                title: "B".into(),
                pinned: false,
                group: None,
            },
        ];
        db.save_session(&tabs, 1).unwrap();
        let (loaded, active) = db.load_session().unwrap();
        assert_eq!(loaded.len(), 2);
        assert!(loaded[0].pinned);
        assert_eq!(loaded[0].group.as_deref(), Some("ĐỌC"));
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

    #[test]
    fn downloads_round_trip() {
        let db = temp_db("dl");
        db.record_download("https://f.test/a.zip", "C:\\Users\\x\\a.zip", true)
            .unwrap();
        let list = db.list_downloads().unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].success);
        db.clear_downloads().unwrap();
        assert!(db.list_downloads().unwrap().is_empty());
    }

    #[test]
    fn reading_list_dedupes_by_url() {
        let db = temp_db("rd");
        db.add_reading("Bài 1", "https://r.test/1").unwrap();
        db.add_reading("Bài 1 (sửa)", "https://r.test/1").unwrap();
        let list = db.list_reading().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Bài 1 (sửa)");
        db.remove_reading(list[0].id).unwrap();
        assert!(db.list_reading().unwrap().is_empty());
    }

    #[test]
    fn migration_from_v1_adds_session_columns() {
        // DB kiểu bản cũ: chỉ có bảng v1, chưa có cột ghim/nhóm và bảng M3/M10.
        let dir = std::env::temp_dir().join(format!(
            "bytwina-test-v1-{}-{}",
            std::process::id(),
            now_nanos()
        ));
        let _ = std::fs::create_dir_all(&dir);
        {
            let conn = Connection::open(dir.join("bytwina.db")).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_version (version INTEGER NOT NULL);
                 INSERT INTO schema_version (version) VALUES (1);
                 CREATE TABLE session_tabs (
                    ord INTEGER PRIMARY KEY,
                    url TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT ''
                 );",
            )
            .unwrap();
        }
        let db = open(dir.clone()).expect("mở DB cũ");
        let tabs = vec![SessionTab {
            url: "https://a.test/".into(),
            title: "A".into(),
            pinned: true,
            group: Some("G".into()),
        }];
        db.save_session(&tabs, 0).unwrap();
        let (loaded, _) = db.load_session().unwrap();
        assert_eq!(loaded.len(), 1);
        assert!(loaded[0].pinned);
        // Bảng M3/M10 được tạo trong cùng migration.
        assert!(db.list_downloads().unwrap().is_empty());
        assert!(db.list_reading().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
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
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    }

    pub fn clear_downloads(&self) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM downloads", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Danh sách đọc (M10): trang muốn đọc sau.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingItem {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub added_at: i64,
}

impl Db {
    pub fn add_reading(&self, title: &str, url: &str) -> Result<(), String> {
        self.conn()
            .execute(
                "INSERT INTO reading_list (title, url, added_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(url) DO UPDATE SET title = excluded.title",
                params![title, url, now()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_reading(&self) -> Result<Vec<ReadingItem>, String> {
        let c = self.conn();
        let mut stmt = c
            .prepare("SELECT id, title, url, added_at FROM reading_list ORDER BY added_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ReadingItem {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    url: r.get(2)?,
                    added_at: r.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    }

    pub fn remove_reading(&self, id: i64) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM reading_list WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl Db {
    /// M15: xóa lịch sử của đúng một tên miền (không xóa tên miền con hay tên miền có chứa chuỗi này).
    /// Chỉ nhận ký tự an toàn, nên không có ký tự đặc biệt của LIKE.
    pub fn clear_history_for_host(&self, host: &str) -> Result<usize, String> {
        let host = host.trim().to_ascii_lowercase();
        let valid = !host.is_empty()
            && host.len() <= 253
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
        if !valid {
            return Err("tên miền không hợp lệ".into());
        }
        self.conn()
            .execute(
                "DELETE FROM history WHERE url IN (?1, ?2) OR url LIKE ?3 OR url LIKE ?4",
                params![
                    format!("https://{host}"),
                    format!("http://{host}"),
                    format!("https://{host}/%"),
                    format!("http://{host}/%"),
                ],
            )
            .map_err(|e| e.to_string())
    }
}

/// Một mục trong kho mật khẩu (M11). `secret` không bao giờ trả ra ngoài
/// danh sách; chỉ lệnh `password_reveal` mới giải mã khi kho đang mở.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordEntry {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub username: String,
    pub updated_at: i64,
}

impl Db {
    pub fn add_password(
        &self,
        title: &str,
        url: &str,
        username: &str,
        secret: &[u8],
    ) -> Result<i64, String> {
        let c = self.conn();
        c.execute(
            "INSERT INTO password_entries (title, url, username, secret, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![title, url, username, secret, now()],
        )
        .map_err(|e| e.to_string())?;
        Ok(c.last_insert_rowid())
    }

    pub fn update_password(
        &self,
        id: i64,
        title: &str,
        url: &str,
        username: &str,
        secret: &[u8],
    ) -> Result<(), String> {
        let changed = self
            .conn()
            .execute(
                "UPDATE password_entries
                 SET title = ?2, url = ?3, username = ?4, secret = ?5, updated_at = ?6
                 WHERE id = ?1",
                params![id, title, url, username, secret, now()],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("không tìm thấy mục cần sửa".into());
        }
        Ok(())
    }

    pub fn remove_password(&self, id: i64) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM password_entries WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_passwords(&self) -> Result<Vec<PasswordEntry>, String> {
        let c = self.conn();
        let mut stmt = c
            .prepare(
                "SELECT id, title, url, username, updated_at
                 FROM password_entries ORDER BY title COLLATE NOCASE ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(PasswordEntry {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    url: r.get(2)?,
                    username: r.get(3)?,
                    updated_at: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    }

    pub fn password_secret(&self, id: i64) -> Result<Vec<u8>, String> {
        use rusqlite::OptionalExtension;
        self.conn()
            .query_row(
                "SELECT secret FROM password_entries WHERE id = ?1",
                params![id],
                |r| r.get::<_, Vec<u8>>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "không tìm thấy mục".to_string())
    }

    pub fn count_passwords(&self) -> Result<i64, String> {
        self.conn()
            .query_row("SELECT COUNT(*) FROM password_entries", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    pub fn clear_passwords(&self) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM password_entries", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn site_history_clear_matches_exact_host_only() {
        let dir = std::env::temp_dir().join(format!("bytwina-test-site-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = open(dir.clone()).expect("mở CSDL test");
        db.record_history("a", "https://example.com/x").unwrap();
        db.record_history("b", "https://example.com.evil.net/")
            .unwrap();
        db.record_history("c", "https://other.test/").unwrap();
        assert_eq!(db.clear_history_for_host("example.com").unwrap(), 1);
        assert!(db.clear_history_for_host("exa mple.com").is_err());
        assert!(db.clear_history_for_host("").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn notes_and_named_sessions_round_trip() {
        let dir = std::env::temp_dir().join(format!("bytwina-test-notes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = open(dir.clone()).expect("mở CSDL test");
        // Ghi chú gắn đúng URL, sửa tại chỗ, xoá bằng nội dung rỗng.
        db.set_note("https://a.test/x", "# Ghi chú\n\nnội dung").unwrap();
        assert!(db
            .get_note("https://a.test/x")
            .unwrap()
            .unwrap()
            .contains("nội dung"));
        db.set_note("https://a.test/x", "bản mới").unwrap();
        assert_eq!(db.get_note("https://a.test/x").unwrap().unwrap(), "bản mới");
        db.set_note("https://a.test/x", "   ").unwrap();
        assert!(db.get_note("https://a.test/x").unwrap().is_none());
        db.set_note("https://b.test/", "khác").unwrap();
        assert_eq!(db.list_notes().unwrap().len(), 1);
        db.delete_note("https://b.test/").unwrap();
        assert!(db.list_notes().unwrap().is_empty());
        // Phiên có tên: lưu đè theo tên, liệt kê và xoá.
        db.save_named_session("Công việc", r#"[{"url":"https://a.test/","title":"A","pinned":false,"group":null}]"#)
            .unwrap();
        db.save_named_session("Công việc", r#"[{"url":"https://b.test/","title":"B","pinned":true,"group":null}]"#)
            .unwrap();
        let sessions = db.list_named_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].1.contains("b.test"));
        db.delete_named_session("Công việc").unwrap();
        assert!(db.list_named_sessions().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn password_entries_crud_and_reset_keeps_vault_keys() {
        let dir = std::env::temp_dir().join(format!("bytwina-test-pw-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = open(dir.clone()).expect("mở CSDL test");
        let id = db
            .add_password("Gmail", "https://mail.google.com", "a@b.c", b"sealed")
            .unwrap();
        let list = db.list_passwords().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].username, "a@b.c");
        assert_eq!(db.password_secret(id).unwrap(), b"sealed");
        db.update_password(id, "Gmail mới", "https://mail.google.com", "x@y.z", b"sealed2")
            .unwrap();
        assert_eq!(db.password_secret(id).unwrap(), b"sealed2");
        assert_eq!(db.count_passwords().unwrap(), 1);
        // Salt/check nằm trong bảng settings và không bị xóa khi đổi cài đặt khác.
        db.set_setting("vaultSalt", "salt").unwrap();
        db.set_setting("vaultCheck", "check").unwrap();
        db.set_setting("homeUrl", "https://x.test/").unwrap();
        assert_eq!(db.get_setting("vaultSalt").unwrap().as_deref(), Some("salt"));
        assert_eq!(db.get_setting("vaultCheck").unwrap().as_deref(), Some("check"));
        db.remove_password(id).unwrap();
        assert!(db.list_passwords().unwrap().is_empty());
        db.clear_passwords().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }
}
