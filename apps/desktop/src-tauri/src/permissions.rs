//! Quyền trang web: camera, micro, vị trí, thông báo, đọc clipboard.
//!
//! Mặc định HỎI MỖI LẦN như Chrome/Cốc Cốc. Người dùng cho phép/từ chối thì lựa
//! chọn được nhớ theo origin (scheme + host + port, không phải cả URL) và lưu trong
//! bảng settings dưới khóa `sitePermissions` dạng JSON:
//! `{"https://example.com": {"camera": true, "notifications": false}}`.
//!
//! Quy tắc đọc phải chạy trên luồng UI (callback WebView2) nên toàn bộ bảng tra nằm
//! trong bộ nhớ; ghi đĩa xảy ra ở phía lệnh IPC, không bao giờ trong callback.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use serde::Serialize;

/// Điểm chặn mức WebView2 (COM) trên Windows.
#[cfg(target_os = "windows")]
pub mod webview2;

pub const SETTING_KEY: &str = "sitePermissions";

/// Loại quyền có trong giao diện hỏi. Những loại WebView2 báo về mà ta không hiển
/// thị (autoplay, phông chữ cục bộ, cảm biến khác…) được bỏ qua, để runtime tự xử lý.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Camera,
    Microphone,
    Geolocation,
    Notifications,
    Clipboard,
}

impl Kind {
    /// `COREWEBVIEW2_PERMISSION_KIND` thô (enum là struct newtype i32) sang Kind.
    pub fn from_raw(raw: i32) -> Option<Kind> {
        match raw {
            1 => Some(Kind::Microphone),
            2 => Some(Kind::Camera),
            3 => Some(Kind::Geolocation),
            4 => Some(Kind::Notifications),
            6 => Some(Kind::Clipboard),
            _ => None,
        }
    }

    /// Khóa trong JSON và tên frontend dùng để vẽ nhãn.
    pub fn key(self) -> &'static str {
        match self {
            Kind::Camera => "camera",
            Kind::Microphone => "microphone",
            Kind::Geolocation => "geolocation",
            Kind::Notifications => "notifications",
            Kind::Clipboard => "clipboard",
        }
    }

    pub fn from_key(text: &str) -> Option<Kind> {
        match text {
            "camera" => Some(Kind::Camera),
            "microphone" => Some(Kind::Microphone),
            "geolocation" => Some(Kind::Geolocation),
            "notifications" => Some(Kind::Notifications),
            "clipboard" => Some(Kind::Clipboard),
            _ => None,
        }
    }
}

/// Một dòng trong danh sách quyền của trang Cài đặt.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SitePermission {
    pub origin: String,
    pub kind: &'static str,
    pub allowed: bool,
}

#[derive(Default)]
pub struct Permissions {
    /// origin -> (kind -> cho phép hay không).
    rules: RwLock<HashMap<String, HashMap<&'static str, bool>>>,
    /// id lời hỏi đang chờ -> (nhãn webview, origin, kind).
    pending: std::sync::Mutex<HashMap<u64, (String, String, &'static str)>>,
    /// Số thứ tự của lời hỏi đang chờ người trả lời.
    next_id: AtomicU64,
}

impl Permissions {
    pub fn remember_prompt(&self, id: u64, label: &str, origin: &str, kind: &'static str) {
        if let Ok(mut map) = self.pending.lock() {
            map.insert(id, (label.to_string(), origin.to_string(), kind));
        }
    }

    /// Lấy và xóa thông tin của một lời hỏi; `None` nếu id không còn (trang đã đổi).
    pub fn take_prompt_info(&self, id: u64) -> Option<(String, String, &'static str)> {
        self.pending.lock().ok()?.remove(&id)
    }

    pub fn take_prompt_label(&self, id: u64) -> Option<String> {
        self.pending.lock().ok()?.remove(&id).map(|(l, _, _)| l)
    }

    /// Các id còn treo của một webview, để từ chối chúng khi tab đóng.
    pub fn prompts_for(&self, label: &str) -> Vec<u64> {
        let Ok(mut map) = self.pending.lock() else {
            return Vec::new();
        };
        let ids: Vec<u64> = map
            .iter()
            .filter(|(_, (l, _, _))| l.as_str() == label)
            .map(|(id, _)| *id)
            .collect();
        for id in &ids {
            map.remove(id);
        }
        ids
    }

    /// Xóa toàn bộ lời hỏi quyền đang treo (dùng khi bật/tắt chế độ riêng tư).
    pub fn clear_pending(&self) -> Vec<u64> {
        let Ok(mut map) = self.pending.lock() else {
            return Vec::new();
        };
        let ids: Vec<u64> = map.keys().copied().collect();
        map.clear();
        ids
    }
}

impl Permissions {
    /// Tra nhanh trên luồng UI: `None` nghĩa là chưa có lựa chọn => phải hỏi.
    pub fn lookup(&self, origin: &str, kind: &'static str) -> Option<bool> {
        let rules = self.rules.read().unwrap_or_else(|e| e.into_inner());
        rules
            .get(origin)
            .and_then(|by_kind| by_kind.get(kind).copied())
    }

    /// Ghi lựa chọn của người dùng và trả JSON đầy đủ để bên gọi lưu xuống CSDL.
    pub fn decide(&self, origin: &str, kind: &'static str, allowed: bool) -> String {
        {
            let mut rules = self.rules.write().unwrap_or_else(|e| e.into_inner());
            rules
                .entry(origin.to_string())
                .or_default()
                .insert(kind, allowed);
        }
        self.dump()
    }

    /// Xóa mọi lựa chọn của một origin (nút "xóa" trong Cài đặt).
    pub fn forget(&self, origin: &str) -> String {
        {
            let mut rules = self.rules.write().unwrap_or_else(|e| e.into_inner());
            rules.remove(origin);
        }
        self.dump()
    }

    pub fn next_prompt_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub fn list(&self) -> Vec<SitePermission> {
        let rules = self.rules.read().unwrap_or_else(|e| e.into_inner());
        let mut out: Vec<SitePermission> = rules
            .iter()
            .flat_map(|(origin, by_kind)| {
                by_kind.iter().map(move |(kind, allowed)| SitePermission {
                    origin: origin.clone(),
                    kind,
                    allowed: *allowed,
                })
            })
            .collect();
        // Thứ tự ổn định để danh sách không nhảy khi vẽ lại.
        out.sort_by(|a, b| (&a.origin, a.kind).cmp(&(&b.origin, b.kind)));
        out
    }

    pub fn dump(&self) -> String {
        let map: HashMap<String, HashMap<&'static str, bool>> =
            self.rules.read().unwrap_or_else(|e| e.into_inner()).clone();
        serde_json::to_string(&map).unwrap_or_else(|_| "{}".into())
    }

    /// Nạp lại từ CSDL lúc khởi động. JSON hỏng => bảng trống, không chết ứng dụng.
    pub fn load(&self, text: &str) {
        let parsed: HashMap<String, HashMap<String, bool>> =
            serde_json::from_str(text).unwrap_or_default();
        let mut rules = self.rules.write().unwrap_or_else(|e| e.into_inner());
        rules.clear();
        for (origin, by_kind) in parsed {
            for (name, allowed) in by_kind {
                if let Some(kind) = Kind::from_key(&name) {
                    rules
                        .entry(origin.clone())
                        .or_default()
                        .insert(kind.key(), allowed);
                }
            }
        }
    }
}

#[derive(Clone)]
pub struct PermissionsHandle(pub Arc<Permissions>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_origin_has_no_decision_so_we_ask() {
        let p = Permissions::default();
        assert_eq!(p.lookup("https://a.test", "camera"), None);
    }

    #[test]
    fn decision_is_remembered_per_origin_and_kind() {
        let p = Permissions::default();
        p.decide("https://a.test", "camera", true);
        p.decide("https://b.test", "camera", false);
        assert_eq!(p.lookup("https://a.test", "camera"), Some(true));
        assert_eq!(p.lookup("https://b.test", "camera"), Some(false));
        // Cùng origin, loại khác: vẫn chưa hỏi.
        assert_eq!(p.lookup("https://a.test", "microphone"), None);
    }

    #[test]
    fn json_roundtrip_survives_restart() {
        let p = Permissions::default();
        p.decide("https://a.test", "notifications", false);
        let saved = p.dump();

        let fresh = Permissions::default();
        fresh.load(&saved);
        assert_eq!(fresh.lookup("https://a.test", "notifications"), Some(false));
    }

    #[test]
    fn bad_or_unknown_json_does_not_break_or_invent_rules() {
        let p = Permissions::default();
        p.load("{ không phải JSON");
        assert!(p.list().is_empty());
        // Khóa lạ trong JSON bị bỏ qua, không thành quyền ma.
        p.load(r#"{"https://a.test": {"midi": true}}"#);
        assert!(p.list().is_empty());
    }

    #[test]
    fn forget_removes_only_that_origin() {
        let p = Permissions::default();
        p.decide("https://a.test", "camera", true);
        p.decide("https://b.test", "camera", true);
        p.forget("https://a.test");
        assert_eq!(p.lookup("https://a.test", "camera"), None);
        assert_eq!(p.lookup("https://b.test", "camera"), Some(true));
    }

    #[test]
    fn list_is_stably_ordered() {
        let p = Permissions::default();
        p.decide("https://b.test", "camera", true);
        p.decide("https://a.test", "notifications", false);
        p.decide("https://a.test", "camera", true);
        let kinds: Vec<String> = p
            .list()
            .iter()
            .map(|s| format!("{}:{}", s.origin, s.kind))
            .collect();
        assert_eq!(
            kinds,
            vec![
                "https://a.test:camera",
                "https://a.test:notifications",
                "https://b.test:camera"
            ]
        );
    }

    #[test]
    fn prompt_ids_are_unique_and_start_at_one() {
        let p = Permissions::default();
        assert_eq!(p.next_prompt_id(), 1);
        assert_eq!(p.next_prompt_id(), 2);
    }

    #[test]
    fn raw_kinds_map_only_to_supported_permissions() {
        assert_eq!(Kind::from_raw(1), Some(Kind::Microphone));
        assert_eq!(Kind::from_raw(2), Some(Kind::Camera));
        assert_eq!(Kind::from_raw(3), Some(Kind::Geolocation));
        assert_eq!(Kind::from_raw(4), Some(Kind::Notifications));
        assert_eq!(Kind::from_raw(6), Some(Kind::Clipboard));
        // 0 = unknown, 9 = autoplay, 10 = local fonts: ta không hỏi.
        assert_eq!(Kind::from_raw(0), None);
        assert_eq!(Kind::from_raw(9), None);
        assert_eq!(Kind::from_raw(10), None);
    }
}
