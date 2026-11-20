//! Bộ lọc chặn quảng cáo theo cú pháp AdBlock Plus.
//!
//! Kiến trúc (ADR-015):
//! - `adblock::Engine` bất biến sau khi tạo; đổi danh sách = dựng engine mới rồi hoán đổi.
//! - Feature `single-thread` của crate bị tắt nên `Engine` là `Send + Sync`; vẫn đóng gói
//!   sau `RwLock<Option<Arc<Engine>>>` để luồng đọc (callback WebView2) không chờ ghi.
//! - Callback chặn chạy trên luồng UI của cửa sổ nên đường đọc phải ngắn: kiểm tra
//!   `enabled` và danh sách tên miền tắt trước khi chạm engine.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use adblock::lists::ParseOptions;
use adblock::request::Request;
use adblock::{Engine, FilterSet};
use serde::Serialize;

/// Điểm chặn mức mạng trên Windows (COM WebView2).
#[cfg(target_os = "windows")]
pub mod webview2;

/// Tên file cache của engine đã nối gọn (định dạng nội bộ, chỉ để tăng tốc khởi động).
const CACHE_FILE: &str = "engine.bin";

/// Danh sách mặc định, cú pháp AdBlock Plus. Tải lúc chạy, không nhúng vào repo
/// (EasyList/Matthew Grey, uBlock filters và ABPVN đều GPL-3).
pub const DEFAULT_LISTS: &[(&str, &str)] = &[
    ("easylist", "https://easylist.to/easylist/easylist.txt"),
    ("easyprivacy", "https://easylist.to/easylist/easyprivacy.txt"),
    (
        "ublock-filters",
        "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt",
    ),
    (
        "ublock-privacy",
        "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt",
    ),
    (
        "abpvn",
        "https://raw.githubusercontent.com/abpvn/abpvn/master/filter/abpvn.txt",
    ),
];

/// Tải toàn bộ danh sách về thư mục `dir`; một danh sách lỗi không chặn các danh sách còn lại.
/// Hàm này gọi đồng bộ nên chỉ được chạy ở luồng nền.
pub fn update_lists(dir: &Path) -> Result<usize, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(60)))
        .build()
        .into();
    let mut ok = 0usize;
    for (name, url) in DEFAULT_LISTS {
        match agent
            .get(*url)
            .call()
            .and_then(|mut resp| resp.body_mut().read_to_string())
        {
            Ok(text) if text.len() > 200 => {
                let path = dir.join(format!("{name}.txt"));
                // Ghi file tạm trước: mất điện giữa chừng không phá danh sách cũ.
                let tmp = path.with_extension("txt.part");
                std::fs::write(&tmp, &text).map_err(|e| e.to_string())?;
                std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
                ok += 1;
            }
            Ok(_) => log::warn!("danh sách {name} rỗng, giữ bản cũ"),
            Err(e) => log::warn!("không tải được {name}: {e}"),
        }
    }
    Ok(ok)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockerStatus {
    pub enabled: bool,
    pub ready: bool,
    /// Số request bị chặn từ lúc chạy.
    pub blocked: u64,
    pub lists: Vec<String>,
    pub disabled_sites: Vec<String>,
    /// Thư mục chứa các file .txt; người dùng tự đặt danh sách vào đây ở bản hiện tại.
    pub dir: String,
}

pub struct Blocker {
    engine: RwLock<Option<Arc<Engine>>>,
    enabled: AtomicBool,
    blocked: AtomicU64,
    disabled_sites: RwLock<Vec<String>>,
    /// Bản sao độ dài `disabled_sites` để luồng chặn bỏ qua kiểm tra theo tên miền
    /// khi người dùng chưa tắt chặn ở trang nào (đường gọi mỗi request).
    has_overrides: AtomicBool,
    dir: PathBuf,
}

impl Blocker {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            engine: RwLock::new(None),
            enabled: AtomicBool::new(true),
            blocked: AtomicU64::new(0),
            disabled_sites: RwLock::new(Vec::new()),
            has_overrides: AtomicBool::new(false),
            dir,
        }
    }

    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::Relaxed);
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn ready(&self) -> bool {
        self.engine.read().is_ok_and(|e| e.is_some())
    }

    pub fn blocked_count(&self) -> u64 {
        self.blocked.load(Ordering::Relaxed)
    }

    pub fn disabled_sites(&self) -> Vec<String> {
        match self.disabled_sites.read() {
            Ok(v) => v.clone(),
            Err(_) => Vec::new(),
        }
    }

    /// Tắt/bỏ chặn theo tên miền trang (host của chính trang đang mở).
    pub fn set_site_disabled(&self, host: &str, off: bool) {
        let mut sites = match self.disabled_sites.write() {
            Ok(s) => s,
            Err(e) => e.into_inner(),
        };
        let host = host.to_ascii_lowercase();
        sites.retain(|s| s != &host);
        if off {
            sites.push(host);
        }
        self.has_overrides
            .store(!sites.is_empty(), Ordering::Relaxed);
    }

    pub fn is_site_disabled(&self, host: &str) -> bool {
        match self.disabled_sites.read() {
            // So sánh không cấp phát: danh sách đã lưu ở chữ thường.
            Ok(s) => s.iter().any(|x| x.eq_ignore_ascii_case(host)),
            Err(_) => false,
        }
    }

    pub fn status(&self) -> BlockerStatus {
        BlockerStatus {
            enabled: self.enabled(),
            ready: self.ready(),
            blocked: self.blocked_count(),
            lists: list_names(&self.dir),
            disabled_sites: self.disabled_sites(),
            dir: self.dir.display().to_string(),
        }
    }

    /// Nạp engine: ưu tiên cache đã nối gọn, hỏng, thiếu hoặc cũ hơn .txt thì đọc lại.
    /// Không có .txt nào thì engine vẫn trống (trạng thái `ready` = false).
    pub fn load(&self) -> Result<(), String> {
        if let Some(engine) = load_cache(&self.dir) {
            self.swap(engine);
            return Ok(());
        }
        let sources = read_lists(&self.dir)?;
        if sources.is_empty() {
            return Ok(());
        }
        let engine = build_engine(&sources);
        let _ = save_cache(&self.dir, &engine);
        self.swap(engine);
        Ok(())
    }

    /// Dựng lại engine từ toàn bộ .txt trong thư mục, ghi đè cache.
    pub fn reload(&self) -> Result<usize, String> {
        let sources = read_lists(&self.dir)?;
        let count = sources.len();
        let engine = build_engine(&sources);
        let _ = save_cache(&self.dir, &engine);
        self.swap(engine);
        Ok(count)
    }

    /// Tải danh sách mới rồi dựng lại engine. Trả về số danh sách tải được.
    pub fn update(&self) -> Result<usize, String> {
        let downloaded = update_lists(&self.dir)?;
        self.reload()?;
        Ok(downloaded)
    }

    fn swap(&self, engine: Engine) {
        let shared = Arc::new(engine);
        match self.engine.write() {
            Ok(mut guard) => *guard = Some(shared),
            Err(e) => *e.into_inner() = Some(shared),
        }
    }

    /// Quyết định chặn cho một request. `resource_type` là loại tài nguyên WebView2
    /// (`script`, `image`, `xmlhttprequest`, `document`…).
    pub fn should_block(&self, url: &str, source_url: &str, resource_type: &str) -> bool {
        if !self.enabled() {
            return false;
        }
        // WebView2 báo tài liệu của iframe cũng là `document`, không phân biệt được
        // khung gốc. Chỉ chặn tài liệu của bên thứ ba để không bao giờ làm trắng
        // trang người dùng đang mở.
        let kind = match resource_type {
            "document" | "main_frame" | "sub_frame" => {
                if is_third_party(url, source_url) {
                    "subdocument"
                } else {
                    return false;
                }
            }
            other => other,
        };
        // Trang người dùng tắt chặn: bỏ qua request mà đích thuộc trang đó
        // và cả request phát sinh từ trang đó. Chỉ làm khi có mục nào được tắt.
        if self.has_overrides.load(Ordering::Relaxed)
            && (self.is_site_disabled_of(url)
                || source_host(source_url).is_some_and(|p| self.is_site_disabled(&p)))
        {
            return false;
        }
        let engine = match self.engine.read() {
            Ok(guard) => guard.clone(),
            Err(e) => e.into_inner().clone(),
        };
        let Some(engine) = engine else { return false };
        let Ok(request) = Request::new(url, source_url, kind, "GET") else {
            return false;
        };
        let blocked = engine.check_network_request(&request).should_block();
        if blocked {
            self.blocked.fetch_add(1, Ordering::Relaxed);
        }
        blocked
    }

    /// Bản sao con trỏ engine đang dùng, cho bộ lọc thẩm mỹ chạy ở luồng nền:
    /// nó không được giữ khóa `RwLock` khi đang tra hàng nghìn selector.
    pub fn snapshot_engine(&self) -> Option<Arc<Engine>> {
        match self.engine.read() {
            Ok(guard) => guard.clone(),
            Err(e) => e.into_inner().clone(),
        }
    }

    fn is_site_disabled_of(&self, url: &str) -> bool {
        host_of(url).is_some_and(|h| self.is_site_disabled(&h))
    }
}

#[derive(Clone)]
pub struct BlockerHandle(pub Arc<Blocker>);

/// So sánh thô hai host sau khi bỏ `www.`. Thà nhận nhầm là cùng bên (không chặn
/// tài liệu) còn hơn chặn nhầm trang người dùng đang mở.
fn is_third_party(url: &str, source_url: &str) -> bool {
    let (Some(page), Some(target)) = (source_host(source_url), host_of(url)) else {
        return false;
    };
    registrable(&page) != registrable(&target)
}

/// Registrable domain theo Public Suffix List. Trước đây hàm này đoán bằng
/// `rsplitn(3, '.')` nên `news.bbc.co.uk` bị coi là khác miền với `www.bbc.co.uk`
/// — tức luật `$third-party` chặn nhầm tài nguyên cùng nhà.
///
/// PSL đọc nhãn cuối là TLD, kể cả khi đó là số (`...1.10` -> `10`), nên IP sẽ
/// bị trả về phần đuôi trông như tên miền. Chỗ gọi chỉ so sánh hai chuỗi sau khi
/// đi qua cùng hàm, nên hai host trên cùng một IP vẫn được coi là cùng nhà;
/// không có chỗ nào đem kết quả này ra để điều hướng hay tra DNS.
fn registrable(host: &str) -> String {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if let Some(domain) = psl::domain_str(&host) {
        return domain.to_owned();
    }
    host.trim_start_matches("www.").to_owned()
}

fn build_engine(sources: &[String]) -> Engine {
    let mut set = FilterSet::new(false);
    for text in sources {
        set.add_filter_list(text.clone(), ParseOptions::default());
    }
    Engine::new_with_filter_set(set)
}

fn read_lists(dir: &Path) -> Result<Vec<String>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("txt") {
            if let Ok(text) = std::fs::read_to_string(&path) {
                out.push(text);
            }
        }
    }
    Ok(out)
}

fn list_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("txt") {
                return None;
            }
            p.file_stem().map(|s| s.to_string_lossy().into_owned())
        })
        .collect()
}

fn cache_path(dir: &Path) -> PathBuf {
    dir.join(CACHE_FILE)
}

fn save_cache(dir: &Path, engine: &Engine) -> Result<(), String> {
    let bytes = engine.serialize();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // Ghi file tạm rồi đổi tên để lần chạy sau không đọc phải file giữa chừng.
    let tmp = cache_path(dir).with_extension("bin.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, cache_path(dir)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Engine đã nối gọn, chỉ khi cache còn dùng được. Cũ hơn danh sách thì trả `None`
/// để bên gọi dựng lại từ .txt.
fn load_cache(dir: &Path) -> Option<Engine> {
    if !cache_is_fresh(dir) {
        return None;
    }
    let bytes = std::fs::read(cache_path(dir)).ok()?;
    let mut engine = Engine::default();
    engine.deserialize(&bytes).ok()?;
    Some(engine)
}

/// Cache chỉ còn dùng được khi không có danh sách nào sửa sau lúc nó ghi.
/// Không có cache, không đọc được thời gian, hoặc có .txt mới hơn đều trả `false`
/// để bên gọi dựng lại engine từ .txt.
fn cache_is_fresh(dir: &Path) -> bool {
    let cache_time = match std::fs::metadata(cache_path(dir)).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("txt") {
            continue;
        }
        // `>` chứ không phải `>=`: cache luôn ghi sau .txt nên bằng thời gian là còn hợp lệ.
        if path.metadata().and_then(|m| m.modified()).is_ok_and(|t| t > cache_time) {
            return false;
        }
    }
    true
}

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))

}

fn source_host(source_url: &str) -> Option<String> {
    if source_url.is_empty() {
        return None;
    }
    host_of(source_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Số thứ tự cho thư mục tạm: `cargo test` chạy các test song song trong cùng
    /// một tiến trình, nên chỉ dùng pid thì mọi test ghi chung `test.txt` và
    /// `engine.bin` — `load()` của test sau đọc lại engine của luật test trước.
    static SEQ: AtomicU64 = AtomicU64::new(0);

    fn blocker_with(rules: &str) -> Blocker {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("bytwina-abpc-test-{n}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("test.txt"), rules);
        let blocker = Blocker::new(dir);
        blocker.load().expect("nạp danh sách thất bại");
        blocker
    }

    #[test]
    fn blocks_third_party_ad_script() {
        let b = blocker_with(
            "! Title: test\n||doubleclick.net^$script,third-party\n",
        );
        assert!(b.should_block(
            "https://doubleclick.net/a.js",
            "https://news.example/",
            "script"
        ));
    }

    #[test]
    fn allows_first_party_even_when_matching() {
        let b = blocker_with("||doubleclick.net^$script,third-party\n");
        // Chính doubleclick.net tải script của nó: không phải bên thứ ba.
        assert!(!b.should_block(
            "https://doubleclick.net/a.js",
            "https://doubleclick.net/",
            "script"
        ));
    }

    #[test]
    fn exception_rule_wins() {
        let b = blocker_with("||ads.example^$script\n@@||ads.example/keep.js$script\n");
        assert!(b.should_block(
            "https://ads.example/banner.js",
            "https://news.example/",
            "script"
        ));
        assert!(!b.should_block(
            "https://ads.example/keep.js",
            "https://news.example/",
            "script"
        ));
    }

    #[test]
    fn image_and_xhr_types_match() {
        let b = blocker_with("||track.example^$image,xmlhttprequest\n");
        assert!(b.should_block(
            "https://track.example/p.gif",
            "https://shop.example/",
            "image"
        ));
        assert!(b.should_block(
            "https://track.example/x",
            "https://shop.example/",
            "xmlhttprequest"
        ));
    }

    #[test]
    fn never_blocks_top_level_document() {
        let b = blocker_with("||bad.example^\n");
        // Chặn tài liệu gốc sẽ làm trắng trang: bộ chặn để bước xử lý popup/anti-adblock lo.
        assert!(!b.should_block("https://bad.example/", "", "main_frame"));
        assert!(!b.should_block("https://bad.example/", "", "document"));
    }

    #[test]
    fn third_party_document_is_treated_as_ad_iframe() {
        let b = blocker_with("||adframe.example^\n");
        // iframe quảng cáo: WebView2 báo là `document` nhưng khác bên với trang cha.
        assert!(b.should_block(
            "https://adframe.example/embed",
            "https://news.example/",
            "document"
        ));
        // Tài liệu cùng bên (trang người dùng đang mở) không bao giờ bị chặn.
        assert!(!b.should_block(
            "https://news.example/article",
            "https://news.example/",
            "document"
        ));
    }

    #[test]
    fn disabled_site_is_bypassed() {
        let b = blocker_with("||doubleclick.net^\n");
        b.set_site_disabled("news.example", true);
        assert!(!b.should_block(
            "https://doubleclick.net/a.js",
            "https://news.example/",
            "script"
        ));
        // Trang khác vẫn bị chặn.
        assert!(b.should_block(
            "https://doubleclick.net/a.js",
            "https://other.example/",
            "script"
        ));
    }

    #[test]
    fn disabled_flag_stops_all_blocking() {
        let b = blocker_with("||doubleclick.net^\n");
        b.set_enabled(false);
        assert!(!b.should_block(
            "https://doubleclick.net/a.js",
            "https://news.example/",
            "script"
        ));
        b.set_enabled(true);
        assert!(b.should_block(
            "https://doubleclick.net/a.js",
            "https://news.example/",
            "script"
        ));
    }

    #[test]
    fn counter_increments_per_block() {
        let b = blocker_with("||doubleclick.net^\n");
        let before = b.blocked_count();
        b.should_block("https://doubleclick.net/a.js", "https://n.example/", "script");
        b.should_block("https://ok.example/a.js", "https://n.example/", "script");
        assert_eq!(b.blocked_count(), before + 1);
    }

    #[test]
    fn cache_roundtrip_keeps_behavior() {
        let b = blocker_with("||quantserve.com^\n");
        // load() đã ghi cache; dựng blocker mới trên cùng thư mục sẽ nạp từ cache.
        let dir = b.dir.clone();
        let fresh = Blocker::new(dir);
        fresh.load().unwrap();
        assert!(fresh.should_block(
            "https://q.quantserve.com/q.gif",
            "https://blog.example/",
            "image"
        ));
    }

    /// Cache chỉ là bản tăng tốc: sửa danh sách thì lần nạp sau phải theo luật mới,
    /// người dùng không cần bấm "Tải lại".
    #[test]
    fn stale_cache_is_rebuilt_from_lists() {
        let b = blocker_with("||quantserve.com^\n");
        let dir = b.dir.clone();
        assert!(cache_is_fresh(&dir), "vừa ghi cache thì phải còn mới");

        let txt = dir.join("test.txt");
        std::fs::write(&txt, "||track.example^\n").unwrap();
        // Ngày giờ tương lai để kết luận không phụ thuộc độ phân giải đồng hồ filesystem.
        let newer = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
        let file = std::fs::OpenOptions::new().write(true).open(&txt).unwrap();
        file.set_modified(newer).unwrap();

        let fresh = Blocker::new(dir);
        fresh.load().unwrap();
        assert!(
            fresh.should_block(
                "https://track.example/p.gif",
                "https://blog.example/",
                "image"
            ),
            "luật mới trong .txt phải có hiệu lực"
        );
        assert!(
            !fresh.should_block(
                "https://q.quantserve.com/q.gif",
                "https://blog.example/",
                "image"
            ),
            "engine cũ trong cache đã bị thay"
        );
    }

    #[test]
    fn psl_registrable_domain_handles_multi_part_suffixes() {
        // Đều là bbc.co.uk: không được coi là bên thứ ba.
        assert_eq!(registrable("news.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(registrable("www.bbc.co.uk"), "bbc.co.uk");
        assert_eq!(registrable("NEWS.BBC.CO.UK"), "bbc.co.uk");
        assert_eq!(registrable("shop.example.com.vn"), "example.com.vn");
        // Tên một nhãn và tên không có trong PSL: trả về chính nó.
        assert_eq!(registrable("localhost"), "localhost");
        // KHÔNG assert IP: psl::domain_str("192.168.1.10") trả Some("1.10") vì
        // "10" là TLD có thật trong PSL (CI đã chỉ ra điều này). Hàm giữ nguyên
        // host chỉ khi PSL không trả gì, nên đừng suy ra; chỗ gọi chỉ so sánh
        // hai chuỗi.
    }

    #[test]
    fn same_org_across_multi_part_suffix_is_not_third_party() {
        let b = blocker_with("||doubleclick.net^$script,third-party\n");
        // Trước khi dùng PSL, hai host này khác "registrable" nên bị chặn nhầm.
        assert!(!b.should_block(
            "https://www.bbc.co.uk/static/app.js",
            "https://news.bbc.co.uk/",
            "script"
        ));
    }

    /// Số đo tốc độ quyết định chặn. Bỏ qua khi test thường; chạy bằng:
    /// `cargo test --release -- --ignored --nocapture` (xem docs/PERFORMANCE.md).
    #[test]
    #[ignore]
    fn probe_should_block_throughput() {
        const N: u32 = 200_000;
        let b = blocker_with(
            "||doubleclick.net^\n||googlesyndication.com^\n||google-analytics.com^$third-party\n",
        );
        for (label, url) in [
            ("trúng luật", "https://googleads.g.doubleclick.net/pagead/x.js"),
            ("không trúng", "https://news.example.vn/static/app.js"),
        ] {
            let started = std::time::Instant::now();
            for _ in 0..N {
                b.should_block(url, "https://news.example.vn/", "script");
            }
            let micros = started.elapsed().as_secs_f64() * 1_000_000.0 / N as f64;
            println!("should_block {label}: {micros:.3} µs/request");
        }
    }

    #[test]
    fn empty_dir_does_not_break_blocker() {
        let dir = std::env::temp_dir().join(format!(
            "bytwina-abpc-empty-{}-{}",
            std::process::id(),
            std::time::UNIX_EPOCH
                .elapsed()
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let b = Blocker::new(dir);
        b.load().unwrap();
        assert!(!b.ready());
        assert!(!b.should_block("https://x.example/a.js", "https://y.example/", "script"));
    }
}
