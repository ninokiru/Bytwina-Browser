//! Chuyển đổi đầu vào của thanh địa chỉ thành URL an toàn.
//! Không chứa logic Tauri, nên có thể kiểm thử thuần.

use tauri::Url;

const SEARCH_BASE: &str = "https://www.google.com/search";

/// Chỉ cho phép các giao thức an toàn để điều hướng.
pub fn is_allowed_navigation(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about")
}

/// Chuyển chuỗi nhập vào thành URL:
/// - `http(s)://...` được giữ nguyên (sau khi kiểm tra giao thức).
/// - `about:blank` là trang tab mới.
/// - Chuỗi có dạng `giao_thức:` khác (ví dụ `javascript:`, `file:`) bị từ chối.
/// - Chuỗi không khoảng trắng có dấu chấm được coi là tên miền, thêm `https://`.
/// - Còn lại là tìm kiếm.
pub fn normalize_input(input: &str) -> Result<Url, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("địa chỉ trống".into());
    }
    if s.starts_with("http://") || s.starts_with("https://") {
        return parse_allowed(s);
    }
    if s.starts_with("about:") {
        return if s == "about:blank" {
            parse_allowed(s)
        } else {
            Err("chỉ cho phép about:blank".into())
        };
    }
    if let Some(idx) = s.find(':') {
        let prefix = &s[..idx];
        let looks_like_scheme = idx > 0
            && prefix
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.');
        if looks_like_scheme {
            return Err("giao thức không được hỗ trợ".into());
        }
    }
    if !s.contains(char::is_whitespace) && s.contains('.') {
        return parse_allowed(&format!("https://{s}"));
    }
    search(s)
}

fn parse_allowed(s: &str) -> Result<Url, String> {
    let url = Url::parse(s).map_err(|e| e.to_string())?;
    if is_allowed_navigation(&url) {
        Ok(url)
    } else {
        Err("giao thức không được hỗ trợ".into())
    }
}

fn search(query: &str) -> Result<Url, String> {
    Url::parse_with_params(SEARCH_BASE, &[("q", query)]).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_domain_becomes_https() {
        assert_eq!(
            normalize_input("example.com").unwrap().as_str(),
            "https://example.com/"
        );
    }

    #[test]
    fn explicit_https_is_kept() {
        assert_eq!(
            normalize_input("https://example.org/a").unwrap().as_str(),
            "https://example.org/a"
        );
    }

    #[test]
    fn javascript_scheme_is_rejected() {
        assert!(normalize_input("javascript:alert(1)").is_err());
    }

    #[test]
    fn file_scheme_is_rejected() {
        assert!(normalize_input("file:///C:/secret.txt").is_err());
    }

    #[test]
    fn about_blank_only() {
        assert!(normalize_input("about:blank").is_ok());
        assert!(normalize_input("about:config").is_err());
    }

    #[test]
    fn plain_text_is_search() {
        let u = normalize_input("hello world").unwrap();
        assert_eq!(u.host_str(), Some("www.google.com"));
        assert_eq!(u.path(), "/search");
    }

    #[test]
    fn empty_is_rejected() {
        assert!(normalize_input("   ").is_err());
    }
}
