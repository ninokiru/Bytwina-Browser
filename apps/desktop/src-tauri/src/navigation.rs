use std::sync::{Arc, Mutex};

use tauri::webview::NewWindowResponse;
use tauri::Url;

/// Trang chủ mặc định khi mở tab mới.
pub const HOME_URL: &str = "https://example.com/";
/// Trang trống cho tab chưa bao giờ điều hướng (new tab page — hoàn thiện ở M5).
pub const NEW_TAB_URL: &str = "about:blank";

const SEARCH_ENGINE: &str = "https://duckduckgo.com/?q=";

/// Trang nội bộ nhận từ ô địa chỉ qua scheme `bytwina://`.
/// Không đăng ký protocol thật nào: `navigate` chặn chuỗi này trước khi nó tới
/// `to_url_with`, nếu không nó sẽ thành một truy vấn tìm kiếm (xem to_url_with).
#[derive(Debug, PartialEq, Eq)]
pub enum Internal {
    /// Bảng hoặc hành động mà toolbar đã biết, mở theo đúng tên này.
    Known(&'static str),
    /// Đúng scheme nhưng không có trang nào trùng tên.
    Unknown,
}

/// Nhận dạng `bytwina://<tên>`. Scheme và tên trang không phân biệt hoa thường.
pub fn internal_page(input: &str) -> Option<Internal> {
    let (scheme, rest) = input.trim().split_once("://")?;
    if !scheme.eq_ignore_ascii_case("bytwina") {
        return None;
    }
    let name = rest.split(['/', '?', '#']).next().unwrap_or_default().to_ascii_lowercase();
    let page = match name.as_str() {
        "settings" => "settings",
        "history" => "history",
        "downloads" => "downloads",
        "bookmarks" => "bookmarks",
        "reading" => "reading",
        "dictionary" => "dictionary",
        "newtab" => "newtab",
        _ => return Some(Internal::Unknown),
    };
    Some(Internal::Known(page))
}

/// Chuyển ô nhập địa chỉ thành URL tuyệt đối:
/// - có scheme http/https → chuẩn hóa qua url::Url (host chữ thường, giữ đường dẫn);
/// - scheme khác (file, javascript, data…) → từ chối, coi như tìm kiếm;
/// - trông như tên miền (không khoảng trắng, có dấu chấm) → https;
/// - còn lại → tìm kiếm DuckDuckGo.
///
/// Như `to_url_with`, dùng công cụ tìm kiếm mặc định (DuckDuckGo).
#[allow(dead_code)]
pub fn to_url(input: &str) -> String {
    to_url_with(input, SEARCH_ENGINE)
}

/// Chuyển ô nhập thành URL; `engine` là tiền tố tìm kiếm (xem `engine_prefix`).
pub fn to_url_with(input: &str, engine: &str) -> String {
    let search = |s: &str| format!("{engine}{}", urlencode(s));
    let input = input.trim();
    if input.is_empty() {
        return NEW_TAB_URL.to_string();
    }
    if let Some(pos) = input.find("://") {
        let scheme = input[..pos].to_ascii_lowercase();
        // url::Url chỉ cho phép http/https vào webview nội dung.
        if scheme == "http" || scheme == "https" {
            // Origin của chính ứng dụng: coi như tìm kiếm, không mở trong tab.
            if is_app_origin_str(input) {
                return search(input);
            }
            // HTTPS-first (ADR-003): nâng cấp http lên https, trừ localhost để phát triển.
            return Url::parse(input)
                .map(|mut u| {
                    if u.scheme() == "http" && !is_local(&u) {
                        let _ = u.set_scheme("https");
                    }
                    u.to_string()
                })
                .unwrap_or_else(|_| search(input));
        }
        return search(input);
    }
    let looks_like_domain = !input.contains(char::is_whitespace)
        && !input.starts_with('.')
        && (input.contains('.') || looks_like_host_port(input));
    if looks_like_domain {
        // localhost và 127.0.0.1 thường chỉ chạy http khi phát triển.
        let scheme = if input_is_local(input) {
            "http"
        } else {
            "https"
        };
        Url::parse(&format!("{scheme}://{input}"))
            .map(|u| u.to_string())
            .unwrap_or_else(|_| search(input))
    } else {
        search(input)
    }
}

/// `host:port` không có scheme, ví dụ `localhost:3000` hoặc `127.0.0.1:8000`.
fn looks_like_host_port(input: &str) -> bool {
    match input.rsplit_once(':') {
        Some((host, port)) => {
            !host.is_empty()
                && !host.contains(':')
                && !port.is_empty()
                && port.chars().all(|c| c.is_ascii_digit())
        }
        None => false,
    }
}

/// Phần host (bỏ cổng và đường dẫn) của chuỗi nhập chưa có scheme.
fn host_of_input(input: &str) -> &str {
    let after_scheme = input
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(input);
    let end = after_scheme
        .find(['/', '?', '#'])
        .unwrap_or(after_scheme.len());
    after_scheme[..end].split(':').next().unwrap_or("")
}

fn input_is_local(input: &str) -> bool {
    host_of_input(input).eq_ignore_ascii_case("localhost") || host_of_input(input) == "127.0.0.1"
}

/// Tiền tố URL của công cụ tìm kiếm theo khóa cài đặt `searchEngine`; khóa lạ → DuckDuckGo.
pub fn engine_prefix(key: &str) -> &'static str {
    match key {
        "google" => "https://www.google.com/search?q=",
        "bing" => "https://www.bing.com/search?q=",
        "brave" => "https://search.brave.com/search?q=",
        _ => SEARCH_ENGINE,
    }
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

    /// Chuỗi nội bộ phải được nhận ra TRƯỚC khi to_url_with biến nó thành tìm kiếm.
    #[test]
    fn internal_pages_recognized() {
        assert_eq!(
            internal_page("bytwina://settings"),
            Some(Internal::Known("settings"))
        );
        assert_eq!(
            internal_page("  BYTWINA://History/  "),
            Some(Internal::Known("history"))
        );
        assert_eq!(internal_page("bytwina://nope"), Some(Internal::Unknown));
        assert_eq!(internal_page("bytwina://"), Some(Internal::Unknown));
        assert_eq!(internal_page("https://example.com"), None);
        assert_eq!(internal_page("example.com"), None);
    }

    /// Origin của chính app mà vào được tab là leo thang đặc quyền: ở đó trang
    /// bên ngoài được Tauri coi là "cục bộ" và gọi được mọi lệnh IPC.
    #[test]
    fn app_origin_never_reaches_a_tab() {
        let app_page = "https://tauri.localhost/index.html";
        // Ô địa chỉ: coi như tìm kiếm, không điều hướng.
        assert_eq!(to_url(app_page), format!("{SEARCH_ENGINE}{}", urlencode(app_page)));
        assert!(!page_navigation_allowed(&Url::parse(app_page).unwrap()));
        assert!(!page_navigation_allowed(&Url::parse("http://ipc.localhost/").unwrap()));
        // Trang thường và cổng phát triển vẫn đi qua.
        assert!(page_navigation_allowed(&Url::parse("https://news.example/").unwrap()));
        assert!(page_navigation_allowed(&Url::parse("http://localhost:3000/").unwrap()));
    }

    #[test]
    fn explicit_http_upgraded_except_localhost() {
        assert_eq!(to_url("http://example.com"), "https://example.com/");
        assert_eq!(to_url("http://localhost:8000/a"), "http://localhost:8000/a");
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
        assert!(to_url("note:abc").starts_with(SEARCH_ENGINE));
    }

    #[test]
    fn host_with_port_becomes_url() {
        assert_eq!(to_url("localhost:3000"), "http://localhost:3000/");
        assert_eq!(to_url("127.0.0.1:8000/a"), "http://127.0.0.1:8000/a");
        assert_eq!(to_url("example.com:8080"), "https://example.com:8080/");
    }

    #[test]
    fn empty_is_new_tab() {
        assert_eq!(to_url("   "), NEW_TAB_URL);
    }

    #[test]
    fn page_policy_is_https_first() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(page_navigation_allowed(&u("https://example.com/")));
        assert!(!page_navigation_allowed(&u("http://example.com/")));
        assert!(page_navigation_allowed(&u("http://localhost:8000/")));
        assert!(!page_navigation_allowed(&u("file:///C:/x")));
        assert!(!page_navigation_allowed(&u("javascript:alert(1)")));
        assert!(!page_navigation_allowed(&u("https://ad.doubleclick.net/")));
        assert!(page_navigation_allowed(&u("about:blank")));
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

fn is_local(url: &Url) -> bool {
    matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"))
}

/// Chính sách điều hướng trong trang (ADR-003, HTTPS-first):
/// - https: cho phép, trừ tên miền trong danh sách chặn;
/// - http: chỉ cho localhost (trang http khác bị chặn);
/// - about:blank: cho phép (trang trống của tab mới);
/// - mọi giao thức khác (file, javascript, data...): không cho.
///
/// Không ghi URL vào nhật ký khi chặn.
pub fn page_navigation_allowed(url: &Url) -> bool {
    let allowed = match url.scheme() {
        "https" => !is_blocked_host(url) && !is_app_origin(url),
        "http" => is_local(url) && !is_blocked_host(url) && !is_app_origin(url),
        "about" => url.as_str() == "about:blank",
        _ => false,
    };
    if !allowed {
        crate::diagnostics::log("info", "điều hướng trong trang bị chặn theo chính sách");
    }
    allowed
}

/// Origin của chính ứng dụng (asset protocol trên Windows: `*.tauri.localhost`,
/// `ipc.localhost`). Không bao giờ được nạp vào tab nội dung: ở origin đó, trang
/// bên ngoài đi vào được sẽ là "trang cục bộ" theo cách Tauri xét ACL và gọi được
/// mọi lệnh IPC — kể cả kho mật khẩu và spawn tiến trình.
/// `localhost` trần vẫn được phép vì đó là cổng phát triển (ADR-011).
fn is_app_origin(url: &Url) -> bool {
    url.host_str()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .ends_with(".localhost")
}

/// Bản dùng cho chuỗi thô (ô địa chỉ chưa chắc parse được thành URL hợp lệ).
fn is_app_origin_str(input: &str) -> bool {
    url::Url::parse(input).is_ok_and(|u| is_app_origin(&u))
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

/// Handler on_new_window: từ chối mọi cửa sổ mới của WebView2 (`Deny`), nhưng
/// URL hợp lệ được đưa vào hàng đợi để toolbar mở thành **tab nền**. Hàng đợi
/// giới hạn 16 mục nên trang spam `window.open` không tạo được vô số tab.
/// Mở nền nghĩa là không che toolbar và không cướp focus khỏi trang hiện tại.
pub fn handle_new_window<R: tauri::Runtime>(queue: &PopupQueue, url: Url) -> NewWindowResponse<R> {
    if page_navigation_allowed(&url) {
        queue.push(url);
    }
    NewWindowResponse::Deny
}
