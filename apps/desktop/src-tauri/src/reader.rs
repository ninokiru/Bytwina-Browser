//! Chế độ đọc: tải HTML của trang rồi tách phần bài viết bằng dom_smoothie.
//! Kết quả được ammonia khử HTML nguy hiểm trước khi trả cho giao diện.
//!
//! Hạn chế: tải lại trang bằng HTTP (không chạy JavaScript, không dùng cookie
//! của tab), nên trang cần đăng nhập hoặc render bằng JS có thể ra nội dung thiếu.

use std::io::Read;

use serde::Serialize;

/// Giới hạn kích thước trang để không nạp cả file lớn vào bộ nhớ.
const MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
pub struct ReaderArticle {
    pub title: String,
    /// HTML đã làm sạch bằng ammonia.
    pub html: String,
    pub text_length: usize,
    pub site_name: Option<String>,
}

pub fn extract(url: &str) -> Result<ReaderArticle, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Chế độ đọc chỉ dùng cho trang http/https".into());
    }
    let resp = ureq::get(url).call().map_err(|e| e.to_string())?;
    let (_, body) = resp.into_parts();
    let mut bytes = Vec::new();
    body.into_reader()
        .take(MAX_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let html = String::from_utf8_lossy(&bytes).into_owned();

    let mut readability = dom_smoothie::Readability::new(html.as_str(), Some(url), None)
        .map_err(|e| format!("{e:?}"))?;
    let article = readability.parse().map_err(|e| format!("{e:?}"))?;

    Ok(ReaderArticle {
        title: article.title.clone(),
        html: ammonia::clean(&article.content.to_string()),
        text_length: article.length,
        site_name: article.site_name.clone(),
    })
}
