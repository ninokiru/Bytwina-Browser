//! Xem tệp cục bộ trong khung riêng (ảnh, văn bản/code, Markdown, PDF).
//!
//! Nguyên tắc:
//! - Không nạp `file://` vào tab web. Rust mở hộp thoại hệ thống, đọc tệp và
//!   trả nội dung qua IPC cho thanh công cụ.
//! - Chỉ những tệp người dùng đã chọn trong phiên chạy hiện tại mới đọc được
//!   (allowlist). Một lỗi XSS ở giao diện app không thể tự quét ổ đĩa hay đọc
//!   tệp tùy ý, vì mọi đường dẫn đều phải canonicalize và khớp allowlist.
//! - Ảnh trả về `data:` URL; PDF trả base64 để frontend tạo `blob:` URL và cho
//!   trình xem PDF có sẵn của WebView2 hiển thị trong iframe.
//! - SVG bị loại khỏi danh sách ảnh vì có thể chứa script. `.docx/.xlsx/.pptx`
//!   chưa đọc được (cần thư viện ngoài); UI chỉ mời mở bằng ứng dụng khác.
//! - Chưa kiểm chứng runtime Windows cho module này.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt as _;

/// Văn bản/code: tối đa 2 MB, phần dư bị cắt và báo rõ.
pub const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
/// Ảnh: tối đa 20 MB (trước khi mã hóa base64).
pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
/// PDF: tối đa 25 MB, đủ cho tài liệu thông thường mà không làm phình bộ nhớ.
pub const MAX_PDF_BYTES: u64 = 25 * 1024 * 1024;

const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"];
const PDF_EXT: &[&str] = &["pdf"];
const OFFICE_EXT: &[&str] = &[
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf",
];
const TEXT_EXT: &[&str] = &[
    "txt",
    "md",
    "markdown",
    "rst",
    "log",
    "csv",
    "tsv",
    "json",
    "jsonc",
    "jsonl",
    "xml",
    "yml",
    "yaml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "env",
    "properties",
    "lock",
    "diff",
    "patch",
    "tex",
    "srt",
    "vtt",
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "mts",
    "cts",
    "tsx",
    "vue",
    "svelte",
    "css",
    "scss",
    "sass",
    "less",
    "html",
    "htm",
    "xhtml",
    "py",
    "pyi",
    "rs",
    "go",
    "java",
    "kt",
    "kts",
    "scala",
    "groovy",
    "gradle",
    "c",
    "h",
    "cc",
    "cpp",
    "cxx",
    "hpp",
    "cs",
    "fs",
    "fsx",
    "vb",
    "php",
    "rb",
    "pl",
    "pm",
    "lua",
    "r",
    "jl",
    "dart",
    "swift",
    "m",
    "mm",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "psm1",
    "bat",
    "cmd",
    "sql",
    "graphql",
    "gql",
    "proto",
    "sol",
    "asm",
    "s",
    "ex",
    "exs",
    "erl",
    "hrl",
    "hs",
    "lhs",
    "clj",
    "cljs",
    "edn",
    "elm",
    "nim",
    "zig",
    "v",
    "tf",
    "hcl",
    "cmake",
    "nginx",
];

/// Đuôi tệp cho hộp thoại chọn tệp (không có dấu chấm).
pub fn filter_extensions() -> Vec<&'static str> {
    let mut all = Vec::new();
    all.extend_from_slice(TEXT_EXT);
    all.extend_from_slice(IMAGE_EXT);
    all.extend_from_slice(PDF_EXT);
    all.extend_from_slice(OFFICE_EXT);
    all
}

/// Danh sách đường dẫn được phép đọc trong phiên chạy.
#[derive(Default)]
pub struct FileAccess {
    allowed: Mutex<HashSet<PathBuf>>,
}

impl FileAccess {
    /// Canonicalize và ghi nhớ tệp người dùng vừa chọn qua hộp thoại.
    pub fn allow(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("không mở được tệp: {e}"))?;
        if let Ok(mut set) = self.allowed.lock() {
            // Chỉ cần nhớ tệp gần đây; danh sách quá dài thì làm mới để không phình.
            if set.len() >= 64 {
                set.clear();
            }
            set.insert(canonical.clone());
        }
        Ok(canonical)
    }

    /// Kiểm tra đường dẫn có nằm trong allowlist hay không trước khi đọc.
    pub fn check(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|_| "tệp không còn tồn tại".to_string())?;
        let allowed = self
            .allowed
            .lock()
            .map(|set| set.contains(&canonical))
            .unwrap_or(false);
        if !allowed {
            return Err("tệp này chưa được chọn trong phiên hiện tại".into());
        }
        Ok(canonical)
    }
}

/// Mở hộp thoại chọn tệp. Trả `None` khi người dùng hủy.
///
/// Hàm chặn luồng gọi nên chỉ dùng trong `spawn_blocking`, không gọi trên main thread.
pub fn pick(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Mở tệp")
        .add_filter("Tệp hỗ trợ", &filter_extensions())
        .add_filter("Tất cả tệp", &["*"])
        .blocking_pick_file();
    let Some(file) = picked else {
        return Ok(None);
    };
    file.into_path()
        .map(Some)
        .map_err(|e| format!("đường dẫn tệp không hợp lệ: {e}"))
}

/// Đọc một tệp đã nằm trong allowlist và trả dữ liệu cho khung xem.
pub fn read(path: &Path) -> Result<Value, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("không đọc được tệp: {e}"))?;
    if !meta.is_file() {
        return Err("đường dẫn này không phải tệp".into());
    }
    let size = meta.len();
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("tệp")
        .to_string();
    let path_text = display_path(path);
    let ext = ext_of(path);
    let base = |kind: &str| {
        json!({
            "path": path_text,
            "name": name,
            "size": size,
            "kind": kind,
        })
    };

    if IMAGE_EXT.contains(&ext.as_str()) {
        if size > MAX_IMAGE_BYTES {
            return Ok(json!({
                "path": path_text, "name": name, "size": size,
                "kind": "too_large",
                "message": "Ảnh lớn hơn 20 MB nên chưa hiển thị được.",
            }));
        }
        let bytes = std::fs::read(path).map_err(|e| format!("không đọc được ảnh: {e}"))?;
        let mime = image_mime(path);
        return Ok(json!({
            "path": path_text, "name": name, "size": size,
            "kind": "image",
            "mime": mime,
            "dataUrl": format!("data:{mime};base64,{}", STANDARD.encode(&bytes)),
        }));
    }

    if PDF_EXT.contains(&ext.as_str()) {
        if size > MAX_PDF_BYTES {
            return Ok(json!({
                "path": path_text, "name": name, "size": size,
                "kind": "too_large",
                "message": "PDF lớn hơn 25 MB nên chưa hiển thị được.",
            }));
        }
        let bytes = std::fs::read(path).map_err(|e| format!("không đọc được PDF: {e}"))?;
        return Ok(json!({
            "path": path_text, "name": name, "size": size,
            "kind": "pdf",
            "mime": "application/pdf",
            "base64": STANDARD.encode(&bytes),
        }));
    }

    if OFFICE_EXT.contains(&ext.as_str()) {
        return Ok(json!({
            "path": path_text, "name": name, "size": size,
            "kind": "unsupported",
            "message": "Tệp văn phòng (Word, Excel, PowerPoint, OpenDocument) cần thư viện đọc riêng chưa có trong bản này. Bạn có thể mở bằng ứng dụng khác.",
            "external": true,
        }));
    }

    let mut value = base("text");
    // Đọc tối đa MAX_TEXT + 1 byte để biết chắc tệp có bị cắt hay không.
    let mut bytes = Vec::new();
    let mut file = std::fs::File::open(path).map_err(|e| format!("không mở được tệp: {e}"))?;
    file.by_ref()
        .take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("không đọc được tệp: {e}"))?;
    let truncated = bytes.len() as u64 > MAX_TEXT_BYTES || size > MAX_TEXT_BYTES;
    if truncated {
        bytes.truncate(MAX_TEXT_BYTES as usize);
    }

    // UTF-16 có BOM chứa byte NUL hợp lệ, nên nhận diện BOM trước khi coi là nhị phân.
    let utf16_bom = bytes.len() >= 2
        && ((bytes[0] == 0xFF && bytes[1] == 0xFE) || (bytes[0] == 0xFE && bytes[1] == 0xFF));
    if !utf16_bom && is_probably_binary(&bytes) {
        return Ok(json!({
            "path": path_text, "name": name, "size": size,
            "kind": "binary",
            "message": "Tệp này là dữ liệu nhị phân nên không hiển thị dạng văn bản.",
            "external": true,
        }));
    }

    let text = decode_text(&bytes);
    value["text"] = Value::String(text);
    value["truncated"] = Value::Bool(truncated);
    value["markdown"] = Value::Bool(matches!(ext.as_str(), "md" | "markdown"));
    Ok(value)
}

fn ext_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

/// Bỏ tiền tố `\\?\` của Windows để đường dẫn hiển thị/`Mở ngoài` dễ tương thích.
/// Allowlist vẫn so sánh trên đường dẫn đã canonicalize nên không mất kiểm soát.
fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    text.into_owned()
}

fn image_mime(path: &Path) -> &'static str {
    match ext_of(path).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

/// Tệp không có đuôi nhưng tên quen thuộc vẫn là văn bản.
fn is_probably_binary(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(8192)];
    sample.contains(&0)
}

/// Giải mã UTF-8 (thay ký tự lỗi) và nhận diện UTF-16 có BOM.
fn decode_text(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        return decode_utf16(&bytes[2..], true);
    }
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        return decode_utf16(&bytes[2..], false);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_bom_is_decoded() {
        let bytes = [0xFF, 0xFE, b'h', 0, b'i', 0];
        assert_eq!(decode_text(&bytes), "hi");
    }

    #[test]
    fn nul_means_binary() {
        assert!(is_probably_binary(b"abc\0def"));
        assert!(!is_probably_binary(b"plain text"));
    }

    #[test]
    fn allowlist_blocks_unknown_paths() {
        let dir = std::env::temp_dir();
        let access = FileAccess::default();
        assert!(access.check(&dir.join("khong-ton-tai.txt")).is_err());
        assert!(access.check(&dir).is_err());
    }
}
