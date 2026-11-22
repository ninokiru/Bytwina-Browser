//! Hệ tiện ích v1 (không phải bản sao Chrome Extensions).
//!
//! Nguyên tắc:
//! - Manifest khai báo capability; bridge chỉ mở API tương ứng.
//! - Content script chạy trong trang nhưng chỉ nhận một object `bytwina` riêng
//!   (không phải `window.bytwina` dùng chung) để tiện ích A không đọc được API
//!   của tiện ích B.
//! - Mọi lời gọi storage/tabs/network quay về Rust qua WebView2 WebMessage.
//!   Rust kiểm tra lại token, quyền, URL nguồn và hạn mức — không tin JS.
//! - Script `document_start` được đăng ký bằng
//!   `AddScriptToExecuteOnDocumentCreated` (chạy trước script của trang, không
//!   phụ thuộc CSP của trang). Script `document_end`/`document_idle` do Rust
//!   chèn sau khi trang tải xong.
//!
//! Giới hạn v1 (ghi rõ để không báo xanh giả): chưa có background script, popup,
//! options page, marketplace, chữ ký, tự cập nhật và native:*.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, RwLock};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};
use url::Url;

use crate::browser::BrowserState;
use crate::db::{Db, DbState, ExtensionRecord};

#[cfg(target_os = "windows")]
pub mod webview2;

/// Capability hợp lệ trong v1. Capability lạ bị từ chối ngay lúc kiểm tra
/// manifest, không âm thầm bỏ qua.
pub const CAPABILITIES: &[&str] = &[
    "dom:read",
    "dom:write",
    "storage:own",
    "network:restricted",
    "network:unrestricted",
    "notifications",
    "tabs:read",
    "tabs:navigate",
    "ui:inject",
    "clipboard:read",
    "clipboard:write",
    "native:open-url",
];

/// Quyền mặc định: không cần người dùng bấm duyệt.
pub const DEFAULT_CAPABILITIES: &[&str] = &["dom:read", "storage:own", "notifications"];

/// Trần storage mỗi tiện ích (5 MB, giống đề xuất trong thiết kế).
const STORAGE_QUOTA: i64 = 5 * 1024 * 1024;
const MAX_KEY_LEN: usize = 256;
const MAX_VALUE_LEN: usize = 1024 * 1024;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;
const MAX_FILES: usize = 500;
const MAX_DEPTH: usize = 6;
const MAX_NET_BYTES: usize = 5 * 1024 * 1024;

// ===== Manifest =====

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
pub struct Manifest {
    #[serde(default, rename = "manifest_version")]
    pub manifest_version: u32,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "content_scripts")]
    pub content_scripts: Vec<ContentScript>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default, rename = "optional_permissions")]
    pub optional_permissions: Vec<String>,
    #[serde(default, rename = "host_permissions")]
    pub host_permissions: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub icons: Option<Value>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ContentScript {
    #[serde(default)]
    pub matches: Vec<String>,
    #[serde(default, rename = "exclude_matches")]
    pub exclude_matches: Vec<String>,
    #[serde(default)]
    pub js: Vec<String>,
    #[serde(default)]
    pub css: Vec<String>,
    #[serde(default, rename = "run_at")]
    pub run_at: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunAt {
    Start,
    End,
    Idle,
}

impl RunAt {
    fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw.unwrap_or("document_end") {
            "document_start" => Ok(Self::Start),
            "document_end" => Ok(Self::End),
            "document_idle" => Ok(Self::Idle),
            other => Err(format!("run_at không hợp lệ: {other}")),
        }
    }
}

/// Khuôn khớp URL kiểu `scheme://host/path` với `*` trong host và path.
/// Không dùng regex để tránh ReDoS và để kiểm tra được pattern quá rộng.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MatchPattern {
    pub scheme: String,
    pub host: String,
    pub path: String,
}

impl MatchPattern {
    pub fn parse(raw: &str) -> Result<Self, String> {
        let raw = raw.trim();
        let (scheme, rest) = raw
            .split_once("://")
            .ok_or_else(|| format!("pattern thiếu '://': {raw}"))?;
        let scheme = scheme.to_ascii_lowercase();
        if !matches!(scheme.as_str(), "*" | "http" | "https") {
            return Err(format!("scheme chưa hỗ trợ trong v1: {scheme}"));
        }
        let (host, path) = match rest.find('/') {
            Some(pos) => (&rest[..pos], &rest[pos..]),
            None => (rest, "/*"),
        };
        let host = host.to_ascii_lowercase();
        if host.is_empty() || host.contains(['@', ':', '[', ']']) {
            return Err(format!("host không hợp lệ: {raw}"));
        }
        let host_ok = host == "*"
            || host
                .trim_start_matches("*.")
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
        if !host_ok || host.starts_with("*.") && host.len() <= 2 {
            return Err(format!("host không hợp lệ: {raw}"));
        }
        if !path.starts_with('/') || path.chars().any(|c| c.is_control() || c == ' ') {
            return Err(format!("path không hợp lệ: {raw}"));
        }
        let pattern = Self {
            scheme,
            host,
            path: path.to_string(),
        };
        if pattern.is_too_broad() {
            return Err("pattern quá rộng (*://*/*); hãy giới hạn tên miền".into());
        }
        Ok(pattern)
    }

    fn is_too_broad(&self) -> bool {
        self.host == "*" && self.path == "/*"
    }

    pub fn matches(&self, url: &Url) -> bool {
        let scheme = url.scheme();
        if self.scheme != "*" && self.scheme != scheme {
            return false;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        if !host_matches(&self.host, host) {
            return false;
        }
        wildcard(&self.path, url.path())
    }

    fn to_js(&self) -> Value {
        json!({ "scheme": self.scheme, "host": self.host, "path": self.path })
    }
}

fn host_matches(pattern: &str, host: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(suffix) = pattern.strip_prefix("*.") {
        return host.eq_ignore_ascii_case(suffix)
            || host
                .to_ascii_lowercase()
                .ends_with(&format!(".{}", suffix.to_ascii_lowercase()));
    }
    pattern.eq_ignore_ascii_case(host)
}

/// Glob tuyến tính (`*` = mọi chuỗi, `?` = một ký tự). Không đệ quy để không
/// treo trên pattern dài.
fn wildcard(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let mut star: Option<usize> = None;
    let mut mark = 0usize;
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

impl Manifest {
    pub fn from_json(text: &str) -> Result<Self, String> {
        serde_json::from_str(text).map_err(|e| format!("manifest.json không hợp lệ: {e}"))
    }

    /// Kiểm tra cấu trúc và trả về id cuối cùng (sinh mới nếu manifest thiếu).
    pub fn validate(mut self) -> Result<Self, String> {
        if self.manifest_version != 1 {
            return Err("chỉ hỗ trợ manifest_version = 1".into());
        }
        self.name = self.name.trim().to_string();
        if self.name.is_empty() || self.name.chars().count() > 64 {
            return Err("name phải có 1–64 ký tự".into());
        }
        if !valid_version(&self.version) {
            return Err("version phải dạng 1.2.3".into());
        }
        self.id = Some(match self.id.take() {
            Some(id) => {
                if !valid_id(&id) {
                    return Err("id chỉ gồm a-z, 0-9, '.', '_' và '-' (1–64 ký tự)".into());
                }
                id
            }
            None => format!("ext.{}", uuid::Uuid::new_v4().simple()),
        });
        let mut seen = std::collections::HashSet::new();
        for cap in self.permissions.iter().chain(self.optional_permissions.iter()) {
            if !CAPABILITIES.contains(&cap.as_str()) {
                return Err(format!("capability không hỗ trợ: {cap}"));
            }
            if !seen.insert(cap.clone()) {
                return Err(format!("capability bị lặp: {cap}"));
            }
        }
        for host in &self.host_permissions {
            MatchPattern::parse(host)?;
        }
        for dep in &self.dependencies {
            if !valid_id(dep) {
                return Err(format!("dependency không hợp lệ: {dep}"));
            }
        }
        if self.content_scripts.is_empty() {
            return Err("cần ít nhất một content_scripts".into());
        }
        for script in &self.content_scripts {
            if script.matches.is_empty() {
                return Err("content_scripts.matches không được rỗng".into());
            }
            if script.js.is_empty() && script.css.is_empty() {
                return Err("content_scripts cần js hoặc css".into());
            }
            for m in script.matches.iter().chain(script.exclude_matches.iter()) {
                MatchPattern::parse(m)?;
            }
            RunAt::parse(script.run_at.as_deref())?;
            for file in script.js.iter().chain(script.css.iter()) {
                safe_relative(file)?;
            }
        }
        Ok(self)
    }

    /// Quyền cần người dùng duyệt (mọi quyền khai báo trừ mặc định).
    pub fn requested_capabilities(&self) -> Vec<String> {
        let mut out: Vec<String> = self
            .permissions
            .iter()
            .filter(|c| !DEFAULT_CAPABILITIES.contains(&c.as_str()))
            .cloned()
            .collect();
        out.extend(self.optional_permissions.iter().cloned());
        out.sort();
        out.dedup();
        out
    }

    pub fn json_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

fn valid_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    (2..=4).contains(&parts.len())
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 5 && p.chars().all(|c| c.is_ascii_digit()))
}

/// Đường dẫn tương đối, không `..`, không tuyệt đối, không rỗng.
fn safe_relative(raw: &str) -> Result<(), String> {
    let p = Path::new(raw);
    if raw.trim().is_empty() || p.is_absolute() {
        return Err(format!("đường dẫn tệp không hợp lệ: {raw}"));
    }
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("đường dẫn tệp không hợp lệ: {raw}"));
    }
    Ok(())
}

fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    safe_relative(rel)?;
    let path = root.join(rel);
    if !path.starts_with(root) {
        return Err("đường dẫn thoát khỏi thư mục tiện ích".into());
    }
    Ok(path)
}

// ===== Đã nạp =====

#[derive(Clone, Debug)]
pub struct LoadedScript {
    pub run_at: RunAt,
    pub matches: Vec<MatchPattern>,
    pub exclude: Vec<MatchPattern>,
    pub js: Vec<String>,
    pub css: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct LoadedExt {
    pub record: ExtensionRecord,
    pub manifest: Manifest,
    pub grants: Vec<String>,
    pub scripts: Vec<LoadedScript>,
}

impl LoadedExt {
    pub fn matches(&self, url: &Url) -> bool {
        self.scripts
            .iter()
            .any(|s| pattern_hit(&s.matches, &s.exclude, url))
    }

    pub fn host_allowed(&self, url: &Url) -> bool {
        self.manifest
            .host_permissions
            .iter()
            .filter_map(|p| MatchPattern::parse(p).ok())
            .any(|p| p.matches(url))
    }

    pub fn has(&self, cap: &str) -> bool {
        self.grants.iter().any(|c| c == cap)
    }
}

fn pattern_hit(matches: &[MatchPattern], exclude: &[MatchPattern], url: &Url) -> bool {
    matches.iter().any(|p| p.matches(url)) && !exclude.iter().any(|p| p.matches(url))
}

// ===== Registry =====

#[derive(Default)]
struct Rate {
    window: i64,
    api: u32,
    net: u32,
    store: u32,
}

pub struct Registry {
    exts: RwLock<Vec<LoadedExt>>,
    /// Nhãn webview -> (id tiện ích -> token ngẫu nhiên). Token nằm trong closure
    /// của content script nên trang không đọc được; dùng để chặn trang giả mạo
    /// tiện ích rồi gọi storage của nó.
    tokens: Mutex<HashMap<String, HashMap<String, String>>>,
    rates: Mutex<HashMap<String, Rate>>,
}

impl Default for Registry {
    fn default() -> Self {
        Self::new()
    }
}

impl Registry {
    pub fn new() -> Self {
        Self {
            exts: RwLock::new(Vec::new()),
            tokens: Mutex::new(HashMap::new()),
            rates: Mutex::new(HashMap::new()),
        }
    }

    pub fn reload(&self, db: &Db) {
        let rows = match db.list_extensions() {
            Ok(rows) => rows,
            Err(e) => {
                log::error!("không đọc được danh sách tiện ích: {e}");
                return;
            }
        };
        let mut loaded = Vec::new();
        for row in rows.into_iter().filter(|r| r.active) {
            let id = row.id.clone();
            match load_one(db, row) {
                Ok(ext) => loaded.push(ext),
                Err(e) => log::error!("bỏ tiện ích {id}: {e}"),
            }
        }
        if let Ok(mut guard) = self.exts.write() {
            *guard = loaded;
        }
    }

    pub fn active(&self) -> Vec<LoadedExt> {
        self.exts.read().map(|g| g.clone()).unwrap_or_default()
    }

    /// Script đăng ký ở document_start cho một webview. Gồm bridge + mọi script
    /// `document_start` đang hoạt động (guard theo URL ngay trong script).
    pub fn document_start_script(&self, label: &str) -> String {
        let exts = self.active();
        let mut tokens = HashMap::new();
        let mut config = Vec::new();
        for ext in &exts {
            let token = uuid::Uuid::new_v4().simple().to_string();
            tokens.insert(ext.record.id.clone(), token.clone());
            config.push(json!({
                "id": ext.record.id,
                "caps": ext.grants,
                "token": token,
                "manifest": ext.manifest.json_value(),
                "hostPermissions": ext.manifest.host_permissions,
            }));
        }
        if let Ok(mut guard) = self.tokens.lock() {
            guard.insert(label.to_string(), tokens);
        }
        let mut out = String::with_capacity(8 * 1024);
        out.push_str(BRIDGE_JS);
        out.push_str("\n__bytwina_boot__(");
        out.push_str(
            &serde_json::to_string(&json!({ "exts": config })).unwrap_or_else(|_| "{}".into()),
        );
        out.push_str(");\n");
        for ext in &exts {
            for script in ext.scripts.iter().filter(|s| s.run_at == RunAt::Start) {
                out.push_str(&self.start_wrapper(ext, script));
            }
        }
        out
    }

    fn start_wrapper(&self, ext: &LoadedExt, script: &LoadedScript) -> String {
        let id = serde_json::to_string(&ext.record.id).unwrap_or_else(|_| "\"\"".into());
        let matches = serde_json::to_string(
            &script
                .matches
                .iter()
                .map(MatchPattern::to_js)
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|_| "[]".into());
        let exclude = serde_json::to_string(
            &script
                .exclude
                .iter()
                .map(MatchPattern::to_js)
                .collect::<Vec<_>>(),
        )
        .unwrap_or_else(|_| "[]".into());
        let mut body = String::new();
        for css in &script.css {
            body.push_str(&format!("__bytwina_style({id}, {});", js_str(css)));
        }
        for js in &script.js {
            body.push_str(&format!(
                "try{{(function(bytwina){{{js}\n}})(window.__bytwina__&&window.__bytwina__.get({id}));}}catch(e){{console.error('[bytwina:'+{id}+']',e);}}"
            ));
        }
        format!(
            "(function(){{if(window.top!==window)return;if(!window.__bytwina_matchAll({matches},location.href))return;if(window.__bytwina_matchAll({exclude},location.href))return;{body}}})();\n"
        )
    }

    /// Script cần chèn sau khi trang tải xong (`document_end` chạy ngay,
    /// `document_idle` hoãn 500ms trong trang).
    pub fn page_injections(&self, label: &str, url: &Url) -> Vec<String> {
        let tokens = self
            .tokens
            .lock()
            .ok()
            .and_then(|g| g.get(label).cloned())
            .unwrap_or_default();
        let mut out = Vec::new();
        for ext in self.active() {
            if !ext.matches(url) {
                continue;
            }
            if !tokens.contains_key(&ext.record.id) {
                continue;
            }
            for script in ext
                .scripts
                .iter()
                .filter(|s| s.run_at != RunAt::Start && pattern_hit(&s.matches, &s.exclude, url))
            {
                out.push(self.end_wrapper(&ext, script));
            }
        }
        out
    }

    fn end_wrapper(&self, ext: &LoadedExt, script: &LoadedScript) -> String {
        let id = serde_json::to_string(&ext.record.id).unwrap_or_else(|_| "\"\"".into());
        let mut body = String::new();
        for css in &script.css {
            body.push_str(&format!("__bytwina_style({id}, {});", js_str(css)));
        }
        for js in &script.js {
            body.push_str(&format!(
                "try{{(function(bytwina){{{js}\n}})(window.__bytwina__&&window.__bytwina__.get({id}));}}catch(e){{console.error('[bytwina:'+{id}+']',e);}}"
            ));
        }
        if script.run_at == RunAt::Idle {
            format!("setTimeout(function(){{{body}}},500);")
        } else {
            format!("(function(){{{body}}})();")
        }
    }

    pub fn detach(&self, label: &str) {
        if let Ok(mut g) = self.tokens.lock() {
            g.remove(label);
        }
        if let Ok(mut g) = self.rates.lock() {
            g.remove(label);
        }
    }

    fn authorize(
        &self,
        label: &str,
        ext_id: &str,
        token: &str,
        page: &Url,
    ) -> Result<LoadedExt, String> {
        let expected = self
            .tokens
            .lock()
            .ok()
            .and_then(|g| g.get(label).and_then(|m| m.get(ext_id).cloned()))
            .ok_or_else(|| "tiện ích chưa được chèn vào tab này".to_string())?;
        if expected != token {
            return Err("token tiện ích không hợp lệ".into());
        }
        let ext = self
            .active()
            .into_iter()
            .find(|e| e.record.id == ext_id)
            .ok_or_else(|| "tiện ích không hoạt động".to_string())?;
        if !ext.matches(page) {
            return Err("trang hiện tại không khớp mẫu của tiện ích".into());
        }
        Ok(ext)
    }

    /// `Ok(())` nếu còn hạn mức; cửa sổ 1 giây.
    fn allow(&self, id: &str, bucket: Bucket) -> Result<(), String> {
        let limit = match bucket {
            Bucket::Api => 100,
            Bucket::Net => 20,
            Bucket::Store => 50,
        };
        let now = now_secs();
        let mut guard = self
            .rates
            .lock()
            .map_err(|_| "bộ đếm bị khóa".to_string())?;
        let rate = guard.entry(id.to_string()).or_default();
        if rate.window != now {
            rate.window = now;
            rate.api = 0;
            rate.net = 0;
            rate.store = 0;
        }
        let slot = match bucket {
            Bucket::Api => &mut rate.api,
            Bucket::Net => &mut rate.net,
            Bucket::Store => &mut rate.store,
        };
        if *slot >= limit {
            return Err("vượt hạn mức gọi API (thử lại sau 1 giây)".into());
        }
        *slot += 1;
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum Bucket {
    Api,
    Net,
    Store,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn js_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

#[derive(Clone, Default)]
pub struct ExtensionsHandle(pub std::sync::Arc<Registry>);

/// Chèn script `document_end`/`document_idle` khi trang tải xong.
pub fn on_page_load<R: tauri::Runtime>(app: &AppHandle<R>, label: &str, url: &Url) {
    if !label.starts_with("tab-") {
        return;
    }
    let Some(handle) = app.try_state::<ExtensionsHandle>() else {
        return;
    };
    let Some(webview) = app.get_webview(label) else {
        return;
    };
    for script in handle.0.page_injections(label, url) {
        if let Err(e) = webview.eval(script) {
            log::debug!("[{label}] chèn script tiện ích thất bại: {e}");
        }
    }
}

/// Cài/bật/tắt/gỡ tiện ích làm đổi bộ script document_start và token, nên nạp
/// lại các webview đang mở. Trạng thái trang (vị trí cuộn, form) sẽ mất — đây là
/// đánh đổi có chủ ý để không phải giữ hai đường chèn script song song.
pub fn apply_to_tabs(app: &AppHandle, state: &BrowserState) {
    let ids = state.tab_ids();
    let active = state.active_id();
    for id in ids {
        crate::browser::close_webview(app, id);
        state.mark_sleeping(id);
    }
    if let Some(id) = active {
        crate::browser::focus_tab(app, state, id);
    }
    crate::browser::emit_state(app, state);
}

// ===== Nạp từ đĩa =====

fn load_one(db: &Db, row: ExtensionRecord) -> Result<LoadedExt, String> {
    let manifest = Manifest::from_json(&row.manifest_json)?.validate()?;
    let grants = db.list_extension_permissions(&row.id).unwrap_or_default();
    let root = PathBuf::from(&row.dir);
    if !root.is_dir() {
        return Err("thiếu thư mục tiện ích".into());
    }
    let mut scripts = Vec::new();
    for cs in &manifest.content_scripts {
        let run_at = RunAt::parse(cs.run_at.as_deref())?;
        let mut js = Vec::new();
        for rel in &cs.js {
            js.push(read_text_file(&safe_join(&root, rel)?)?);
        }
        let mut css = Vec::new();
        for rel in &cs.css {
            css.push(read_text_file(&safe_join(&root, rel)?)?);
        }
        scripts.push(LoadedScript {
            run_at,
            matches: cs
                .matches
                .iter()
                .filter_map(|m| MatchPattern::parse(m).ok())
                .collect(),
            exclude: cs
                .exclude_matches
                .iter()
                .filter_map(|m| MatchPattern::parse(m).ok())
                .collect(),
            js,
            css,
        });
    }
    Ok(LoadedExt {
        record: row,
        manifest,
        grants,
        scripts,
    })
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let meta =
        std::fs::metadata(path).map_err(|e| format!("không đọc được {}: {e}", path.display()))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "tệp quá lớn (>{MAX_FILE_BYTES} byte): {}",
            path.display()
        ));
    }
    std::fs::read_to_string(path).map_err(|e| format!("không đọc được {}: {e}", path.display()))
}

// ===== Cài / gỡ =====

struct Stage {
    root: PathBuf,
    temp: Option<PathBuf>,
}

impl Drop for Stage {
    fn drop(&mut self) {
        if let Some(dir) = self.temp.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

/// Chuẩn bị nguồn cài: thư mục hoặc tệp .zip. Zip được giải nén vào thư mục tạm
/// với kiểm tra zip-slip, số tệp và tổng dung lượng.
fn stage_source(src: &Path) -> Result<Stage, String> {
    if src.is_dir() {
        let root = manifest_root(src)?;
        return Ok(Stage { root, temp: None });
    }
    if !src.is_file() {
        return Err("đường dẫn không tồn tại".into());
    }
    let lower = src.to_string_lossy().to_ascii_lowercase();
    if !lower.ends_with(".zip") && !lower.ends_with(".bytwina-ext") {
        return Err("chỉ hỗ trợ thư mục hoặc tệp .zip/.bytwina-ext".into());
    }
    let temp = std::env::temp_dir().join(format!("bytwina-ext-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&temp).map_err(|e| format!("không tạo được thư mục tạm: {e}"))?;
    let file = std::fs::File::open(src).map_err(|e| format!("không mở được zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("zip không hợp lệ: {e}"))?;
    if archive.len() > MAX_FILES {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(format!("zip có quá nhiều tệp (> {MAX_FILES})"));
    }
    let mut total = 0u64;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("không đọc được mục zip: {e}"))?;
        let Some(rel) = entry.enclosed_name() else {
            let _ = std::fs::remove_dir_all(&temp);
            return Err("zip chứa đường dẫn không an toàn".into());
        };
        let dest = temp.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            continue;
        }
        if entry.size() > MAX_FILE_BYTES {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(format!("tệp trong zip quá lớn: {}", rel.display()));
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        // Đọc giới hạn: kích thước ghi trong zip có thể nói dối (zip bomb).
        let mut limited = entry.take(MAX_FILE_BYTES + 1);
        let copied = std::io::copy(&mut limited, &mut out).map_err(|e| e.to_string())?;
        if copied > MAX_FILE_BYTES {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(format!("tệp trong zip quá lớn: {}", rel.display()));
        }
        total += copied;
        if total > MAX_TOTAL_BYTES {
            let _ = std::fs::remove_dir_all(&temp);
            return Err("zip giải nén vượt quá 20 MB".into());
        }
    }
    let root = match manifest_root(&temp) {
        Ok(root) => root,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&temp);
            return Err(e);
        }
    };
    Ok(Stage {
        root,
        temp: Some(temp),
    })
}

/// Thư mục chứa manifest.json; hỗ trợ zip bọc một thư mục con duy nhất.
fn manifest_root(dir: &Path) -> Result<PathBuf, String> {
    if dir.join("manifest.json").is_file() {
        return Ok(dir.to_path_buf());
    }
    let mut found = None;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("manifest.json").is_file() {
                if found.is_some() {
                    return Err("có nhiều thư mục chứa manifest.json".into());
                }
                found = Some(path);
            }
        }
    }
    found.ok_or_else(|| "không tìm thấy manifest.json".to_string())
}

/// Kết quả kiểm tra nguồn trước khi cài (hiển thị cho người dùng duyệt quyền).
pub fn inspect_source(src: &Path) -> Result<Value, String> {
    let stage = stage_source(src)?;
    let text = read_text_file(&stage.root.join("manifest.json"))?;
    let manifest = Manifest::from_json(&text)?.validate()?;
    let defaults: Vec<&str> = DEFAULT_CAPABILITIES.to_vec();
    Ok(json!({
        "manifest": manifest.json_value(),
        "id": manifest.id,
        "name": manifest.name,
        "version": manifest.version,
        "author": manifest.author.clone().unwrap_or_default(),
        "description": manifest.description.clone().unwrap_or_default(),
        "requested": manifest.requested_capabilities(),
        "defaults": defaults,
        "hostPermissions": manifest.host_permissions,
        "sourceKind": if src.is_dir() { "folder" } else { "zip" },
    }))
}

pub struct InstallOutcome {
    pub id: String,
    pub name: String,
    pub version: String,
}

/// Tải một gói extension từ URL HTTPS vào tệp tạm. Chỉ dùng cho lệnh do
/// toolbar gọi; không cho redirect tự động để URL đích không vượt qua kiểm tra.
pub fn download_source(url: &str) -> Result<PathBuf, String> {
    let target = Url::parse(url).map_err(|_| "URL tiện ích không hợp lệ".to_string())?;
    if target.scheme() != "https" {
        return Err("chỉ hỗ trợ tải tiện ích qua HTTPS".into());
    }
    if is_private_host(target.host_str().unwrap_or_default()) {
        return Err("không cho tải tiện ích từ mạng nội bộ".into());
    }
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(30)))
        .max_redirects(0)
        .max_redirects_will_error(false)
        .build()
        .into();
    let mut response = agent
        .get(url)
        .call()
        .map_err(|e| format!("không tải được tiện ích: {e}"))?;
    let temp = std::env::temp_dir().join(format!("bytwina-ext-{}.zip", uuid::Uuid::new_v4().simple()));
    let mut out = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
    let body = response.body_mut().with_config().limit(MAX_TOTAL_BYTES + 1);
    let bytes = match body.read_to_vec() {
        Ok(bytes) => bytes,
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            return Err(format!("không đọc được gói tiện ích: {e}"));
        }
    };
    if bytes.len() as u64 > MAX_TOTAL_BYTES {
        let _ = std::fs::remove_file(&temp);
        return Err("gói tiện ích vượt quá 20 MB".into());
    }
    out.write_all(&bytes).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e.to_string()
    })?;
    Ok(temp)
}

/// Đóng gói extension đã cài thành `.bytwina-ext`, không đưa dữ liệu storage
/// hoặc quyền người dùng vào gói — chỉ xuất mã và manifest.
pub fn export_source(db: &Db, id: &str, dest: &Path) -> Result<(), String> {
    let record = db
        .get_extension(id)?
        .ok_or_else(|| "không tìm thấy tiện ích".to_string())?;
    let root = PathBuf::from(record.dir);
    if !root.is_dir() {
        return Err("thiếu thư mục tiện ích".into());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let mut files = 0usize;
    let mut total = 0u64;
    fn add_dir(
        zip: &mut zip::ZipWriter<std::fs::File>,
        root: &Path,
        dir: &Path,
        options: zip::write::SimpleFileOptions,
        files: &mut usize,
        total: &mut u64,
    ) -> Result<(), String> {
        for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let meta = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if meta.file_type().is_symlink() {
                return Err("không xuất được tiện ích chứa symlink".into());
            }
            if meta.is_dir() {
                add_dir(zip, root, &path, options, files, total)?;
                continue;
            }
            if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
                return Err("tệp trong tiện ích không hợp lệ hoặc quá lớn".into());
            }
            *files += 1;
            *total += meta.len();
            if *files > MAX_FILES || *total > MAX_TOTAL_BYTES {
                return Err("tiện ích vượt giới hạn đóng gói".into());
            }
            let rel = path
                .strip_prefix(root)
                .map_err(|_| "đường dẫn tệp không hợp lệ".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let data = std::fs::read(&path).map_err(|e| e.to_string())?;
            zip.start_file(rel, options).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    if let Err(e) = add_dir(&mut zip, &root, &root, options, &mut files, &mut total) {
        let _ = std::fs::remove_file(dest);
        return Err(e);
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Phục vụ tài nguyên tĩnh của extension qua `bytwina-extension://`.
///
/// URL được bridge tạo ở dạng `bytwina-extension://<extension-id>/assets/...`.
/// Chỉ extension đang hoạt động mới có thể phục vụ tài nguyên và chỉ thư mục
/// `assets/` được phép đọc; như vậy một content script không thể dùng protocol
/// này để đọc manifest, SQLite hay tệp tùy ý trên máy.
pub fn serve_asset<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let bad = |status: http::StatusCode| {
        http::Response::builder()
            .status(status)
            .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Vec::new())
            .unwrap_or_else(|_| http::Response::new(Vec::new()))
    };
    let uri = request.uri();
    let parsed = Url::parse(&uri.to_string()).ok();
    let authority = parsed.as_ref().and_then(|url| url.host_str());
    // Windows maps custom schemes to `http://<scheme>.localhost/...`; in
    // that form the extension id is the first path segment instead of host.
    let windows_protocol_host = authority == Some("bytwina-extension.localhost");
    let id = authority
        .filter(|host| !host.is_empty() && !windows_protocol_host)
        .map(str::to_string)
        .or_else(|| {
            uri.path()
                .trim_start_matches('/')
                .split('/')
                .next()
                .filter(|part| !part.is_empty())
                .map(str::to_string)
        });
    let Some(id) = id else {
        return bad(http::StatusCode::BAD_REQUEST);
    };
    if !valid_id(&id) {
        return bad(http::StatusCode::NOT_FOUND);
    }
    let raw_path = parsed
        .as_ref()
        .map(|url| url.path())
        .unwrap_or_else(|| uri.path())
        .trim_start_matches('/');
    let rel = if authority.is_some() && !windows_protocol_host {
        raw_path
    } else {
        raw_path.split_once('/').map(|(_, rest)| rest).unwrap_or("")
    };
    if !rel.starts_with("assets/") || safe_relative(rel).is_err() {
        return bad(http::StatusCode::FORBIDDEN);
    }
    let Some(db) = ctx
        .app_handle()
        .try_state::<DbState>()
        .and_then(|state| state.0.clone())
    else {
        return bad(http::StatusCode::SERVICE_UNAVAILABLE);
    };
    let Ok(Some(record)) = db.get_extension(&id) else {
        return bad(http::StatusCode::NOT_FOUND);
    };
    if !record.active {
        return bad(http::StatusCode::FORBIDDEN);
    }
    let root = PathBuf::from(record.dir);
    let Ok(path) = safe_join(&root, rel) else {
        return bad(http::StatusCode::FORBIDDEN);
    };
    let Ok(meta) = std::fs::metadata(&path) else {
        return bad(http::StatusCode::NOT_FOUND);
    };
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return bad(http::StatusCode::NOT_FOUND);
    }
    let Ok(bytes) = std::fs::read(&path) else {
        return bad(http::StatusCode::INTERNAL_SERVER_ERROR);
    };
    let content_type = mime_guess::from_path(&path)
        .first_raw()
        .unwrap_or("application/octet-stream");
    http::Response::builder()
        .status(http::StatusCode::OK)
        .header(http::header::CONTENT_TYPE, content_type)
        .header(http::header::CACHE_CONTROL, "no-store")
        .header("x-content-type-options", "nosniff")
        .body(bytes)
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

/// Cài hoặc cập nhật tiện ích. `grants` là quyền người dùng đã đồng ý; quyền
/// mặc định luôn được cấp, quyền khác chỉ cấp nếu nằm trong `grants`.
pub fn install_source(
    db: &Db,
    src: &Path,
    extensions_dir: &Path,
    grants: &[String],
) -> Result<InstallOutcome, String> {
    let stage = stage_source(src)?;
    let text = read_text_file(&stage.root.join("manifest.json"))?;
    let manifest = Manifest::from_json(&text)?.validate()?;
    let id = manifest.id.clone().ok_or_else(|| "thiếu id".to_string())?;
    std::fs::create_dir_all(extensions_dir).map_err(|e| e.to_string())?;
    let existing = db.get_extension(&id)?;
    let previous_permissions = existing
        .as_ref()
        .map(|_| db.list_extension_permissions(&id))
        .transpose()?;
    let target = extensions_dir.join(&id);
    // Sao chép vào thư mục tạm trước. Không được xoá bản đang chạy rồi mới
    // bắt đầu copy: zip lỗi/đĩa đầy giữa chừng sẽ làm mất bản cài trước đó.
    let staging = extensions_dir.join(format!(".{id}.install-{}", uuid::Uuid::new_v4().simple()));
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|e| format!("không dọn được thư mục tạm: {e}"))?;
    }
    let mut files = 0usize;
    let mut total = 0u64;
    if let Err(e) = copy_tree(&stage.root, &staging, 0, &mut files, &mut total) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    // Ghi manifest đã chuẩn hóa (có id) để lần nạp sau không phải sinh lại id.
    let normalized = match serde_json::to_string_pretty(&manifest) {
        Ok(value) => value,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(e.to_string());
        }
    };
    if let Err(e) = std::fs::write(staging.join("manifest.json"), normalized) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e.to_string());
    }

    // Đổi tên trong cùng thư mục để commit gần như nguyên tử. Có rollback nếu
    // bước cuối bị chặn bởi quyền/antivirus/ổ đĩa.
    let backup = extensions_dir.join(format!(".{id}.previous-{}", uuid::Uuid::new_v4().simple()));
    let had_old = target.exists();
    if had_old {
        if let Err(e) = std::fs::rename(&target, &backup) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(format!("không giữ được bản cũ để cập nhật: {e}"));
        }
    }
    if let Err(e) = std::fs::rename(&staging, &target) {
        if had_old {
            let _ = std::fs::rename(&backup, &target);
        }
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("không hoàn tất cài tiện ích: {e}"));
    }
    let mut final_caps: Vec<String> = DEFAULT_CAPABILITIES.iter().map(|s| s.to_string()).collect();
    for cap in grants {
        if (manifest.permissions.contains(cap) || manifest.optional_permissions.contains(cap))
            && CAPABILITIES.contains(&cap.as_str())
        {
            final_caps.push(cap.clone());
        }
    }
    final_caps.sort();
    final_caps.dedup();
    let record = ExtensionRecord {
        id: id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone().unwrap_or_default(),
        author: manifest.author.clone().unwrap_or_default(),
        // Cài mới sau khi người dùng đã duyệt quyền thì bật ngay; cập nhật
        // giữ nguyên trạng thái bật/tắt của bản cũ.
        active: existing.as_ref().map(|e| e.active).unwrap_or(true),
        manifest_json: serde_json::to_string(&manifest).map_err(|e| e.to_string())?,
        dir: target.to_string_lossy().into_owned(),
        installed_at: existing.as_ref().map(|e| e.installed_at).unwrap_or(0),
        updated_at: now_secs(),
    };
    if let Err(e) = db
        .upsert_extension(&record)
        .and_then(|_| db.set_extension_permissions(&id, &final_caps, "user"))
    {
        // Không để DB trỏ vào nửa-cài đặt: trả filesystem về bản trước nếu
        // ghi metadata hoặc quyền thất bại.
        let _ = std::fs::remove_dir_all(&target);
        if had_old {
            let _ = std::fs::rename(&backup, &target);
            if let Some(previous) = existing.as_ref() {
                let _ = db.upsert_extension(previous);
                if let Some(caps) = previous_permissions.as_deref() {
                    let _ = db.set_extension_permissions(&id, caps, "user");
                }
            }
        } else {
            let _ = db.delete_extension(&id);
        }
        return Err(e);
    }
    if had_old {
        let _ = std::fs::remove_dir_all(&backup);
    }
    Ok(InstallOutcome {
        id,
        name: manifest.name,
        version: manifest.version,
    })
}

pub fn uninstall(db: &Db, id: &str) -> Result<(), String> {
    if let Some(rec) = db.get_extension(id)? {
        let dir = PathBuf::from(&rec.dir);
        // Chỉ xóa thư mục nằm dưới .../extensions/<id> để lỗi dữ liệu không xóa nhầm.
        if dir.file_name().and_then(|n| n.to_str()) == Some(id)
            && dir
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                == Some("extensions")
        {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
    db.delete_extension(id)
}

fn copy_tree(
    src: &Path,
    dst: &Path,
    depth: usize,
    files: &mut usize,
    total: &mut u64,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err("thư mục tiện ích quá sâu".into());
    }
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let meta = std::fs::symlink_metadata(&from).map_err(|e| e.to_string())?;
        if meta.file_type().is_symlink() {
            return Err("không hỗ trợ symlink trong tiện ích".into());
        }
        if meta.is_dir() {
            copy_tree(&from, &to, depth + 1, files, total)?;
        } else if meta.is_file() {
            *files += 1;
            if *files > MAX_FILES {
                return Err(format!("tiện ích có quá nhiều tệp (> {MAX_FILES})"));
            }
            if meta.len() > MAX_FILE_BYTES {
                return Err(format!("tệp quá lớn: {}", from.display()));
            }
            *total += meta.len();
            if *total > MAX_TOTAL_BYTES {
                return Err("tiện ích vượt quá 20 MB".into());
            }
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ===== Thông điệp từ content script =====

#[derive(Deserialize)]
struct Request {
    #[serde(rename = "__bytwina")]
    magic: u8,
    token: String,
    ext: String,
    seq: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

/// Nhận JSON thô từ WebView2, kiểm tra và trả lời bằng cách gọi
/// `window.__bytwinaDeliver`.
pub fn handle_web_message(app: AppHandle, label: String, raw: String, source: String) {
    let Ok(req) = serde_json::from_str::<Request>(&raw) else {
        return;
    };
    if req.magic != 1 {
        return;
    }
    let page = Url::parse(&source).ok();
    let Some(handle) = app.try_state::<ExtensionsHandle>() else {
        return;
    };
    let registry = handle.0.clone();
    let Some(page) = page else {
        reply(&app, &label, req.seq, Err("URL nguồn không hợp lệ".into()));
        return;
    };
    let auth = registry.authorize(&label, &req.ext, &req.token, &page);
    let ext = match auth {
        Ok(ext) => ext,
        Err(e) => {
            reply(&app, &label, req.seq, Err(e));
            return;
        }
    };
    let app2 = app.clone();
    let label2 = label.clone();
    let seq = req.seq;
    tauri::async_runtime::spawn(async move {
        let result = dispatch(
            &app2,
            &registry,
            &label2,
            &ext,
            &page,
            &req.method,
            req.params,
        )
        .await;
        if let Err(e) = &result {
            log::debug!("[ext:{}] {}: {e}", ext.record.id, req.method);
        }
        reply(&app2, &label2, seq, result);
    });
}

fn reply(app: &AppHandle, label: &str, seq: u64, result: Result<Value, String>) {
    let Some(webview) = app.get_webview(label) else {
        return;
    };
    let msg = match result {
        Ok(value) => {
            json!({ "__bytwina": 1, "type": "reply", "seq": seq, "ok": true, "result": value })
        }
        Err(e) => json!({ "__bytwina": 1, "type": "reply", "seq": seq, "ok": false, "error": e }),
    };
    let text = serde_json::to_string(&msg).unwrap_or_else(|_| "null".into());
    let arg = serde_json::to_string(&text).unwrap_or_else(|_| "\"null\"".into());
    let _ = webview.eval(format!(
        "window.__bytwinaDeliver&&window.__bytwinaDeliver(JSON.parse({arg}));"
    ));
}

async fn dispatch(
    app: &AppHandle,
    registry: &Registry,
    label: &str,
    ext: &LoadedExt,
    _page: &Url,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    registry.allow(&ext.record.id, Bucket::Api)?;
    match method {
        "native.openUrl" => {
            require(ext, "native:open-url")?;
            let raw = params
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "thiếu url".to_string())?;
            let target = Url::parse(raw).map_err(|_| "URL không hợp lệ".to_string())?;
            if !matches!(target.scheme(), "http" | "https") {
                return Err("chỉ cho phép mở URL http/https".into());
            }
            tauri_plugin_opener::open_url(target.as_str(), None::<&str>)
                .map_err(|e| format!("không mở được URL: {e}"))?;
            Ok(Value::Bool(true))
        }
        "messaging.send" => {
            let payload = params.get("payload").cloned().unwrap_or(Value::Null);
            let encoded = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
            if encoded.len() > 64 * 1024 {
                return Err("payload message quá lớn".into());
            }
            let state = app
                .try_state::<BrowserState>()
                .ok_or_else(|| "không có trạng thái trình duyệt".to_string())?;
            let snap = state.snapshot();
            let message = json!({
                "__bytwina": 1,
                "type": "message",
                "ext": ext.record.id,
                "payload": payload,
            });
            let text = serde_json::to_string(&message).map_err(|e| e.to_string())?;
            let arg = serde_json::to_string(&text).map_err(|e| e.to_string())?;
            for tab in snap.tabs {
                let Ok(url) = Url::parse(&tab.url) else { continue };
                if !ext.matches(&url) { continue; }
                if let Some(webview) = app.get_webview(&format!("tab-{}", tab.id)) {
                    let _ = webview.eval(format!(
                        "window.__bytwinaDeliver&&window.__bytwinaDeliver(JSON.parse({arg}));"
                    ));
                }
            }
            Ok(Value::Bool(true))
        }
        "storage.get" => {
            require(ext, "storage:own")?;
            let db = db(app)?;
            let keys = params.get("keys").and_then(|v| v.as_array()).map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            });
            let mut out = serde_json::Map::new();
            match keys {
                Some(keys) => {
                    for key in keys {
                        if let Some(raw) = db.extension_storage_get(&ext.record.id, &key)? {
                            out.insert(
                                key,
                                serde_json::from_str(&raw).unwrap_or(Value::String(raw)),
                            );
                        }
                    }
                }
                None => {
                    for (key, raw) in db.extension_storage_all(&ext.record.id)? {
                        out.insert(
                            key,
                            serde_json::from_str(&raw).unwrap_or(Value::String(raw)),
                        );
                    }
                }
            }
            Ok(Value::Object(out))
        }
        "storage.set" => {
            require(ext, "storage:own")?;
            registry.allow(&ext.record.id, Bucket::Store)?;
            let items = params
                .get("items")
                .and_then(|v| v.as_object())
                .ok_or_else(|| "thiếu items".to_string())?;
            let db = db(app)?;
            let mut total = db.extension_storage_bytes(&ext.record.id)?;
            // Kiểm tra hạn mức cho toàn bộ lô trước khi ghi: một khóa lỗi không
            // được để các khóa trước đó đã ghi dở.
            let mut pending: Vec<(String, String)> = Vec::new();
            for (key, value) in items {
                if key.is_empty() || key.len() > MAX_KEY_LEN {
                    return Err(format!("khóa storage quá dài: {key}"));
                }
                let raw = serde_json::to_string(value).map_err(|e| e.to_string())?;
                if raw.len() > MAX_VALUE_LEN {
                    return Err(format!("giá trị storage quá lớn: {key}"));
                }
                if let Some(old) = db.extension_storage_get(&ext.record.id, key)? {
                    total -= old.len() as i64;
                }
                total += raw.len() as i64;
                if total > STORAGE_QUOTA {
                    return Err("vượt hạn mức storage 5 MB của tiện ích".into());
                }
                pending.push((key.clone(), raw));
            }
            for (key, raw) in pending {
                db.extension_storage_set(&ext.record.id, &key, &raw)?;
            }
            Ok(Value::Null)
        }
        "storage.remove" => {
            require(ext, "storage:own")?;
            registry.allow(&ext.record.id, Bucket::Store)?;
            let db = db(app)?;
            if let Some(keys) = params.get("keys").and_then(|v| v.as_array()) {
                for key in keys.iter().filter_map(|v| v.as_str()) {
                    db.extension_storage_remove(&ext.record.id, key)?;
                }
            }
            Ok(Value::Null)
        }
        "storage.clear" => {
            require(ext, "storage:own")?;
            registry.allow(&ext.record.id, Bucket::Store)?;
            db(app)?.extension_storage_clear(&ext.record.id)?;
            Ok(Value::Null)
        }
        "tabs.query" => {
            require(ext, "tabs:read")?;
            let state = app
                .try_state::<BrowserState>()
                .ok_or_else(|| "không có trạng thái trình duyệt".to_string())?;
            let snap = state.snapshot();
            let tabs: Vec<Value> = snap
                .tabs
                .iter()
                .map(|t| {
                    json!({
                        "id": t.id,
                        "url": t.url,
                        "title": t.title,
                        "active": snap.active_tab == Some(t.id),
                        "pinned": t.pinned,
                        "group": t.group,
                    })
                })
                .collect();
            Ok(json!({ "tabs": tabs }))
        }
        "tabs.getCurrent" => {
            require(ext, "tabs:read")?;
            let state = app
                .try_state::<BrowserState>()
                .ok_or_else(|| "không có trạng thái trình duyệt".to_string())?;
            let id = crate::browser::tab_id_of(label)
                .ok_or_else(|| "không xác định được tab".to_string())?;
            let snap = state.snapshot();
            let tab = snap
                .tabs
                .iter()
                .find(|t| t.id == id)
                .ok_or_else(|| "không tìm thấy tab".to_string())?;
            Ok(json!({
                "id": tab.id, "url": tab.url, "title": tab.title,
                "active": snap.active_tab == Some(tab.id), "pinned": tab.pinned,
            }))
        }
        "tabs.navigate" => {
            require(ext, "tabs:navigate")?;
            let raw = params
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "thiếu url".to_string())?;
            let target = Url::parse(raw).map_err(|_| "URL không hợp lệ".to_string())?;
            if !crate::navigation::page_navigation_allowed(&target) {
                return Err("URL bị chính sách điều hướng chặn".into());
            }
            let id = crate::browser::tab_id_of(label)
                .ok_or_else(|| "không xác định được tab".to_string())?;
            let state = app
                .try_state::<BrowserState>()
                .ok_or_else(|| "không có trạng thái trình duyệt".to_string())?;
            crate::browser::navigate_to(app, &state, id, target.as_str()).await;
            Ok(json!({ "tabId": id }))
        }
        "network.fetch" => {
            let restricted = ext.has("network:restricted");
            let unrestricted = ext.has("network:unrestricted");
            if !restricted && !unrestricted {
                return Err(
                    "BytwinaPermissionError: thiếu network:restricted hoặc network:unrestricted"
                        .into(),
                );
            }
            registry.allow(&ext.record.id, Bucket::Net)?;
            let raw = params
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "thiếu url".to_string())?;
            let target = Url::parse(raw).map_err(|_| "URL không hợp lệ".to_string())?;
            if !matches!(target.scheme(), "http" | "https") {
                return Err("chỉ cho phép http/https".into());
            }
            if restricted && !unrestricted && !ext.host_allowed(&target) {
                return Err("host không nằm trong host_permissions".into());
            }
            let host = target.host_str().unwrap_or_default();
            if is_private_host(host) {
                return Err("chặn tên miền nội bộ/mạng cục bộ".into());
            }
            let method = params
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_ascii_uppercase();
            let body = params
                .get("body")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let url = target.to_string();
            let fetched =
                tauri::async_runtime::spawn_blocking(move || fetch_blocking(&url, &method, body))
                    .await
                    .map_err(|e| e.to_string())??;
            Ok(fetched)
        }
        other => Err(format!("phương thức chưa hỗ trợ: {other}")),
    }
}

fn require(ext: &LoadedExt, cap: &str) -> Result<(), String> {
    if ext.has(cap) {
        Ok(())
    } else {
        Err(format!("BytwinaPermissionError: thiếu quyền {cap}"))
    }
}

fn db(app: &AppHandle) -> Result<Db, String> {
    app.try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .ok_or_else(|| "cơ sở dữ liệu không khả dụng".to_string())
}

fn is_private_host(host: &str) -> bool {
    // `Url::host_str` trả IPv6 kèm ngoặc vuông; bỏ trước khi phân tích.
    let h = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") || h == "::1" {
        return true;
    }
    let Ok(ip) = h.parse::<std::net::IpAddr>() else {
        return false;
    };
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_loopback() || v4.is_private() || v4.is_link_local())
        }
    }
}

fn fetch_blocking(url: &str, method: &str, body: Option<String>) -> Result<Value, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(20)))
        // Không tự đi theo redirect: đích chuyển hướng phải quay lại kiểm tra
        // host_permissions và chặn mạng nội bộ ở lượt gọi kế tiếp.
        .max_redirects(0)
        .max_redirects_will_error(false)
        .build()
        .into();
    let resp = match method {
        "GET" => agent.get(url).call(),
        "POST" => agent
            .post(url)
            .header("content-type", "text/plain; charset=utf-8")
            .send(body.unwrap_or_default()),
        "PUT" => agent
            .put(url)
            .header("content-type", "text/plain; charset=utf-8")
            .send(body.unwrap_or_default()),
        "DELETE" => agent.delete(url).call(),
        "HEAD" => agent.head(url).call(),
        other => return Err(format!("method chưa hỗ trợ: {other}")),
    };
    let mut resp = resp.map_err(|e| format!("mạng lỗi: {e}"))?;
    let status = resp.status().as_u16();
    let headers: serde_json::Map<String, Value> = resp
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|v| (k.as_str().to_string(), Value::String(v.to_string())))
        })
        .collect();
    let body_reader = resp.body_mut().with_config().limit(MAX_NET_BYTES as u64);
    let bytes = body_reader
        .read_to_vec()
        .map_err(|e| format!("không đọc được nội dung: {e}"))?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(json!({
        "status": status,
        "headers": headers,
        "body": text,
        "bytes": bytes.len(),
        "truncated": bytes.len() >= MAX_NET_BYTES,
        "url": url,
    }))
}

// ===== Bridge trong trang =====

/// Bridge chạy trong main world. Toàn bộ API nhạy cảm đi qua Rust; phần JS chỉ
/// kiểm tra quyền lần đầu để báo lỗi rõ ràng, không thay thế kiểm tra ở Rust.
const BRIDGE_JS: &str = r##"
(function () {
  if (window.__bytwina__ && window.__bytwina__.ready) return;
  var chromeObj = window.chrome && window.chrome.webview;
  var post = chromeObj && chromeObj.postMessage ? chromeObj.postMessage.bind(chromeObj) : null;
  var pending = new Map();
  var seq = 0;
  function deliver(msg) {
    if (!msg || msg.__bytwina !== 1) return;
    if (msg.type === "message") {
      var handlers = messageHandlers[msg.ext] || [];
      handlers.slice().forEach(function (handler) {
        try { handler(msg.payload, { extensionId: msg.ext }); } catch (e) { console.error(e); }
      });
      return;
    }
    if (msg.type === "reply") {
      var p = pending.get(msg.seq);
      if (!p) return;
      pending.delete(msg.seq);
      if (msg.ok) { p.resolve(msg.result); } else { p.reject(new Error(msg.error || "Lỗi tiện ích")); }
    }
  }
  var messageHandlers = Object.create(null);
  window.__bytwinaDeliver = deliver;
  if (chromeObj && chromeObj.addEventListener) {
    chromeObj.addEventListener("message", function (e) { deliver(e.data); });
  }
  var NEED = {
    "storage.get": "storage:own", "storage.set": "storage:own",
    "storage.remove": "storage:own", "storage.clear": "storage:own",
    "tabs.query": "tabs:read", "tabs.getCurrent": "tabs:read",
    "tabs.navigate": "tabs:navigate",
    "native.openUrl": "native:open-url"
  };
  function has(caps, cap) { return caps.indexOf(cap) >= 0; }
  function call(state, method, params) {
    var need = NEED[method];
    if (need && !has(state.caps, need)) {
      return Promise.reject(new Error("BytwinaPermissionError: thiếu quyền " + need));
    }
    if (method === "network.fetch" && !has(state.caps, "network:restricted") && !has(state.caps, "network:unrestricted")) {
      return Promise.reject(new Error("BytwinaPermissionError: thiếu quyền network:*"));
    }
    if (!post) return Promise.reject(new Error("Kênh IPC của tiện ích không khả dụng"));
    var id = ++seq;
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      try {
        post(JSON.stringify({ __bytwina: 1, token: state.token, ext: state.id, seq: id, method: method, params: params || {} }));
      } catch (e) {
        pending.delete(id);
        reject(e);
      }
    });
  }
  function toast(options) {
    try {
      var opts = options || {};
      var box = document.createElement("div");
      box.setAttribute("data-bytwina-toast", "1");
      box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:320px;background:#202124;color:#fff;padding:10px 12px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3)";
      var title = String(opts.title || "Bytwina");
      var text = opts.message == null ? "" : String(opts.message);
      var strong = document.createElement("strong");
      strong.textContent = title;
      box.appendChild(strong);
      if (text) {
        var p = document.createElement("div");
        p.textContent = text;
        p.style.opacity = "0.85";
        box.appendChild(p);
      }
      (document.body || document.documentElement).appendChild(box);
      setTimeout(function () { box.remove(); }, 4000);
    } catch (e) { /* trang có thể đã bị đóng */ }
  }
  window.__bytwina_style = function (id, css) {
    try {
      var el = document.createElement("style");
      el.setAttribute("data-bytwina-ext", id);
      el.textContent = css;
      (document.head || document.documentElement).appendChild(el);
    } catch (e) { console.error("[bytwina] không chèn được CSS", e); }
  };
  function parsePattern(p) {
    return { scheme: String(p.scheme || "*"), host: String(p.host || "*"), path: String(p.path || "/*") };
  }
  function wildcard(pattern, text) {
    var p = String(pattern).split(""), t = String(text).split("");
    var pi = 0, ti = 0, star = -1, mark = 0;
    while (ti < t.length) {
      if (pi < p.length && (p[pi] === "?" || p[pi] === t[ti])) { pi++; ti++; }
      else if (pi < p.length && p[pi] === "*") { star = pi; mark = ti; pi++; }
      else if (star >= 0) { pi = star + 1; mark++; ti = mark; }
      else return false;
    }
    while (pi < p.length && p[pi] === "*") pi++;
    return pi === p.length;
  }
  window.__bytwina_matchOne = function (raw, href) {
    var p = parsePattern(raw);
    var u;
    try { u = new URL(href); } catch (e) { return false; }
    var scheme = u.protocol.replace(":", "");
    if (p.scheme !== "*" && p.scheme !== scheme) return false;
    var host = u.hostname.toLowerCase();
    if (p.host !== "*") {
      if (p.host.indexOf("*.") === 0) {
        var suffix = p.host.slice(2).toLowerCase();
        if (host !== suffix && host.slice(-(suffix.length + 1)) !== "." + suffix) return false;
      } else if (host !== p.host.toLowerCase()) return false;
    }
    return wildcard(p.path, u.pathname);
  };
  window.__bytwina_matchAll = function (list, href) {
    if (!list || !list.length) return false;
    for (var i = 0; i < list.length; i++) if (window.__bytwina_matchOne(list[i], href)) return true;
    return false;
  };
  function make(ext) {
    var caps = ext.caps || [];
    var state = { id: ext.id, token: ext.token, caps: caps };
    function guard(cap, fn) {
      return function () {
        if (!has(caps, cap)) throw new Error("BytwinaPermissionError: thiếu quyền " + cap);
        return fn.apply(null, arguments);
      };
    }
    var bridge = {
      runtime: Object.freeze({
        id: ext.id,
        getManifest: function () { return JSON.parse(JSON.stringify(ext.manifest || {})); },
        getPlatformInfo: function () {
          return Object.freeze({ os: "windows", arch: "x64", browser: "bytwina" });
        },
        getURL: function (p) {
          return "bytwina-extension://" + ext.id + "/" + String(p || "").replace(/^\/+/, "");
        }
      }),
      storage: Object.freeze({
        local: Object.freeze({
          get: function (keys) {
            var list = keys == null ? null : (Array.isArray(keys) ? keys : [keys]);
            return call(state, "storage.get", { keys: list });
          },
          set: function (items) { return call(state, "storage.set", { items: items || {} }); },
          remove: function (keys) { return call(state, "storage.remove", { keys: Array.isArray(keys) ? keys : [keys] }); },
          clear: function () { return call(state, "storage.clear", {}); }
        })
      }),
      tabs: Object.freeze({
        query: function () { return call(state, "tabs.query", {}); },
        getCurrent: function () { return call(state, "tabs.getCurrent", {}); },
        navigate: function (url) { return call(state, "tabs.navigate", { url: String(url) }); }
      }),
      network: Object.freeze({
        fetch: function (url, opts) {
          opts = opts || {};
          return call(state, "network.fetch", {
            url: String(url),
            method: opts.method || "GET",
            body: opts.body == null ? null : String(opts.body)
          });
        }
      }),
      messaging: Object.freeze({
        sendToBackground: function (payload) {
          return call(state, "messaging.send", { payload: payload });
        },
        onMessage: function (handler) {
          if (typeof handler !== "function") throw new TypeError("handler phải là function");
          (messageHandlers[ext.id] || (messageHandlers[ext.id] = [])).push(handler);
          return function () {
            var list = messageHandlers[ext.id] || [];
            var index = list.indexOf(handler);
            if (index >= 0) list.splice(index, 1);
          };
        }
      }),
      native: Object.freeze({
        openURL: function (url) {
          return call(state, "native.openUrl", { url: String(url) });
        }
      }),
      notifications: Object.freeze({
        create: function (options) {
          if (!has(caps, "notifications")) return Promise.reject(new Error("BytwinaPermissionError: thiếu quyền notifications"));
          toast(options);
          return Promise.resolve(String((options && options.id) || Date.now()));
        }
      }),
      clipboard: Object.freeze({
        readText: function () {
          if (!has(caps, "clipboard:read")) return Promise.reject(new Error("BytwinaPermissionError: thiếu quyền clipboard:read"));
          if (!navigator.clipboard || !navigator.clipboard.readText) return Promise.reject(new Error("clipboard không khả dụng trên trang này"));
          return navigator.clipboard.readText();
        },
        writeText: function (text) {
          if (!has(caps, "clipboard:write")) return Promise.reject(new Error("BytwinaPermissionError: thiếu quyền clipboard:write"));
          if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.reject(new Error("clipboard không khả dụng trên trang này"));
          return navigator.clipboard.writeText(String(text));
        }
      }),
      dom: Object.freeze({
        querySelector: guard("dom:read", function (sel) { return document.querySelector(sel); }),
        querySelectorAll: guard("dom:read", function (sel) { return document.querySelectorAll(sel); }),
        observe: guard("dom:read", function (selector, callback, options) {
          var opts = options || {};
          var seen = new WeakSet();
          function scan() {
            document.querySelectorAll(selector).forEach(function (el) {
              if (seen.has(el)) return;
              seen.add(el);
              try { callback(el); } catch (e) { console.error(e); }
            });
          }
          scan();
          var mo = new MutationObserver(scan);
          mo.observe(document.documentElement || document.body, {
            childList: true, subtree: true,
            attributes: opts.attributes !== false,
            characterData: false
          });
          return function () { mo.disconnect(); };
        }),
        injectCSS: function (css) {
          if (!has(caps, "ui:inject") && !has(caps, "dom:write")) {
            throw new Error("BytwinaPermissionError: thiếu quyền ui:inject");
          }
          var el = document.createElement("style");
          el.setAttribute("data-bytwina-ext", ext.id);
          el.textContent = String(css);
          (document.head || document.documentElement).appendChild(el);
          return function () { el.remove(); };
        }
      })
    };
    return Object.freeze(bridge);
  }
  var built = Object.create(null);
  window.__bytwina__ = Object.freeze({
    ready: true,
    get: function (id) { return built[id] || null; },
    make: make,
    _install: function (config) {
      (config.exts || []).forEach(function (ext) { built[ext.id] = make(ext); });
    }
  });
  window.__bytwina_boot__ = function (config) { window.__bytwina__._install(config); };
})();
"##;

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(text: &str) -> Result<Manifest, String> {
        Manifest::from_json(text)?.validate()
    }

    const MIN: &str = r#"{
        "manifest_version": 1,
        "name": "Thử",
        "version": "1.0.0",
        "content_scripts": [{ "matches": ["https://example.com/*"], "js": ["a.js"] }]
    }"#;

    #[test]
    fn minimal_manifest_gets_generated_id() {
        let m = manifest(MIN).unwrap();
        let id = m.id.as_ref().unwrap();
        assert!(id.starts_with("ext."), "{id}");
        assert!(valid_id(id));
        assert!(m.requested_capabilities().is_empty());
    }

    #[test]
    fn dangerous_or_unknown_fields_are_rejected() {
        assert!(manifest(&MIN.replace("1.0.0", "abc")).is_err());
        assert!(manifest(&MIN.replace("a.js", "../a.js")).is_err());
        assert!(manifest(&MIN.replace("a.js", "C:\\\\a.js")).is_err());
        assert!(manifest(&MIN.replace("https://example.com/*", "*://*/*")).is_err());
        assert!(manifest(&MIN.replace(
            "\"js\": [\"a.js\"]",
            "\"js\": [\"a.js\"], \"run_at\": \"document_x\""
        ))
        .is_err());
    }

    #[test]
    fn unknown_capability_is_rejected() {
        let text = MIN.replace(
            "\"version\": \"1.0.0\",",
            "\"version\": \"1.0.0\", \"permissions\": [\"root:everything\"],",
        );
        assert!(manifest(&text).is_err());
    }

    #[test]
    fn match_patterns_cover_subdomains_and_paths() {
        let p = MatchPattern::parse("https://*.example.com/news/*").unwrap();
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(p.matches(&u("https://example.com/news/a")));
        assert!(p.matches(&u("https://m.example.com/news/a/b")));
        assert!(!p.matches(&u("https://evil-example.com/news/a")));
        assert!(!p.matches(&u("https://m.example.com/other")));
        assert!(!p.matches(&u("http://m.example.com/news/a")));
    }

    #[test]
    fn wildcard_matching_is_linear_and_correct() {
        assert!(wildcard("/*", "/anything/here"));
        assert!(wildcard("/a?c", "/abc"));
        assert!(!wildcard("/a?c", "/abbc"));
        assert!(wildcard("/a*b*c", "/aXXbYYc"));
        assert!(!wildcard("/a*b*c", "/aXXbYY"));
        assert!(wildcard("/*", "/"));
    }

    #[test]
    fn private_hosts_are_blocked() {
        for h in [
            "localhost",
            "127.0.0.1",
            "10.1.2.3",
            "192.168.1.1",
            "169.254.1.1",
            "::1",
        ] {
            assert!(is_private_host(h), "{h}");
        }
        assert!(!is_private_host("example.com"));
        assert!(!is_private_host("8.8.8.8"));
    }

    #[test]
    fn bridge_script_never_contains_tauri_ipc() {
        for forbidden in ["__TAURI", "tauri.invoke", "ipc.localhost"] {
            assert!(!BRIDGE_JS.contains(forbidden), "bridge lộ {forbidden}");
        }
        assert!(BRIDGE_JS.contains("chrome.webview"));
    }
}
