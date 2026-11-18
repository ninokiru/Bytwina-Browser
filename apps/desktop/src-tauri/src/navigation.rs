use std::sync::{Arc, Mutex};

use tauri::webview::NewWindowResponse;
use tauri::Url;

/// Trang chủ mặc định khi mở tab mới.
pub const HOME_URL: &str = "https://example.com/";
/// Trang trống cho tab chưa bao giờ điều hướng (new tab page — hoàn thiện ở M5).
pub const NEW_TAB_URL: &str = "about:blank";

const SEARCH_ENGINE: &str = "https://duckduckgo.com/?q=";

/// Chuyển ô nhập địa chỉ thành URL tuyệt đối:
/// - có scheme http/https → chuẩn hóa qua url::Url (host chữ thường, giữ đường dẫn);
/// - scheme khác (file, javascript, data…) → từ chối, coi như tìm kiếm;
/// - trông như tên miền (không khoảng trắng, có dấu chấm) → https;
/// - còn lại → tìm kiếm DuckDuckGo.
pub fn to_url(input: &str) -> String {
    let input = input.trim();
    if input.is_empty() {
        return NEW_TAB_URL.to_string();
    }
    if let Some(pos) = input.find("://") {
        let scheme = input[..pos].to_ascii_lowercase();
        // url::Url chỉ cho phép http/https vào webview nội dung.
        if scheme == "http" || scheme == "https" {
            return Url::parse(input)
                .map(|u| u.to_string())
                .unwrap_or_else(|_| search(input));
        }
        return search(input);
    }
    let looks_like_domain =
        !input.contains(char::is_whitespace) && input.contains('.') && !input.starts_with('.');
    if looks_like_domain {
        Url::parse(&format!("https://{input}"))
            .map(|u| u.to_string())
            .unwrap_or_else(|_| search(input))
    } else {
        search(input)
    }
}

fn search(input: &str) -> String {
    format!("{SEARCH_ENGINE}{}", urlencode(input))
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_gets_https() {
        assert_eq!(to_url("example.com"), "https://example.com/");
        assert_eq!(to_url("  Example.COM/path "), "https://example.com/path");
    }

    #[test]
    fn explicit_http_kept() {
        assert_eq!(to_url("http://example.com"), "http://example.com");
        // url::Url chuẩn hóa scheme + host sang chữ thường, giữ nguyên đường dẫn.
        assert_eq!(
            to_url("HTTPS://Example.com/Path"),
            "https://example.com/Path"
        );
    }

    #[test]
    fn dangerous_schemes_become_search() {
        assert!(to_url("javascript:alert(1)").starts_with(SEARCH_ENGINE));
        assert!(to_url("file:///C:/Windows").starts_with(SEARCH_ENGINE));
        assert!(to_url("data:text/html,<h1>x</h1>").starts_with(SEARCH_ENGINE));
    }

    #[test]
    fn plain_text_becomes_search() {
        assert!(to_url("qoder ai").starts_with(SEARCH_ENGINE));
        assert!(to_url("ghe").starts_with(SEARCH_ENGINE));
    }

    #[test]
    fn empty_is_new_tab() {
        assert_eq!(to_url("   "), NEW_TAB_URL);
    }

    #[test]
    fn blocklist_matches_subdomains_only() {
        assert!(is_blocked_host(
            &Url::parse("https://ad.doubleclick.net/x").unwrap()
        ));
        assert!(is_blocked_host(
            &Url::parse("https://doubleclick.net/").unwrap()
        ));
        assert!(!is_blocked_host(
            &Url::parse("https://notdoubleclick.net/").unwrap()
        ));
        assert!(!is_blocked_host(
            &Url::parse("https://example.com/").unwrap()
        ));
    }

    #[test]
    fn urlencoding_spaces_and_utf8() {
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("dà"), "d%C3%A0");
    }
}

/// M4: danh sách chặn quảng cáo/theo dõi tối thiểu, khớp theo hậu tố tên miền.
/// Đây KHÔNG phải filter list được bảo trì. Hiện chỉ áp dụng cho popup;
/// chặn tài nguyên trong trang cần WebResourceRequested (chưa có trong Tauri stable).
const BLOCKED_HOST_SUFFIXES: &[&str] = &[
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "adservice.google.com",
    "taboola.com",
    "outbrain.com",
    "scorecardresearch.com",
    "criteo.com",
    "adnxs.com",
];

pub fn is_blocked_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    BLOCKED_HOST_SUFFIXES
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

/// Chặn mọi điều hướng phía trang: webview nội dung không tự đổi location,
/// không bấm link, không mở popup. Mọi thay đổi URL phải đi qua toolbar (IPC).
pub fn deny_all(_url: &Url) -> bool {
    false
}

/// window.open / target=_blank: không tạo cửa sổ riêng, không âm thầm nạp trang
/// vào tab hiện hành. Ghi URL vào hàng đợi `pending_popups`; toolbar đọc và mở
/// thành tab nền mới qua IPC. Hàng đợi chặn webview độc hại spam tab mới.
#[derive(Default)]
pub struct PopupQueue {
    urls: Arc<Mutex<Vec<String>>>,
}

impl PopupQueue {
    pub fn push(&self, url: Url) {
        let mut q = self.urls.lock().unwrap_or_else(|e| e.into_inner());
        if q.len() < 16 {
            q.push(url.into());
        }
    }

    /// Lấy toàn bộ URL đang chờ và xóa hàng đợi.
    pub fn drain(&self) -> Vec<String> {
        let mut q = self.urls.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *q)
    }
}

/// Handler on_new_window: từ chối mọi cửa sổ mới. URL popup chỉ được ghi vào hàng
/// đợi khi người dùng giữ Ctrl trong lúc click (toolbar bật `allow_next` một lần
/// qua IPC); toolbar đọc hàng đợi và mở thành tab nền. Chặn trang độc hại spam tab.
pub fn handle_new_window<R: tauri::Runtime>(
    queue: &PopupQueue,
    allow_next: &std::sync::atomic::AtomicBool,
    url: Url,
) -> NewWindowResponse<'static, R> {
    if allow_next.swap(false, std::sync::atomic::Ordering::SeqCst) && !is_blocked_host(&url) {
        queue.push(url);
    }
    NewWindowResponse::Deny
}
