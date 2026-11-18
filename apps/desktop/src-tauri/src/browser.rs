use std::sync::{Arc, Mutex};

use tauri::webview::{DownloadEvent, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl,
};

use crate::db::DbState;
use crate::navigation;
use crate::tabs::{HistoryEntry, PersistedTab, StatePayload, TabInfo};

pub const TOOLBAR_HEIGHT: f64 = 96.0;

/// Khi true, thanh công cụ phủ toàn cửa sổ (màn hình điều khoản khi chưa chấp nhận).
static TOOLBAR_FULL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_toolbar_full(on: bool) {
    TOOLBAR_FULL.store(on, std::sync::atomic::Ordering::SeqCst);
}

/// Chiều cao thanh công cụ theo chiều cao cửa sổ hiện hành.
pub fn toolbar_height_for(window_height: f64) -> f64 {
    if TOOLBAR_FULL.load(std::sync::atomic::Ordering::SeqCst) {
        window_height
    } else {
        TOOLBAR_HEIGHT
    }
}
const MAX_HISTORY: usize = 50;

/// URL trung gian khi lazy-create tab; webview thật chỉ nạp trang khi tab được kích hoạt.
const BLANK_URL: &str = "about:blank";

struct Inner {
    tabs: Vec<Tab>,
    active: Option<u32>,
    next_id: u32,
    private: bool,
}

struct Tab {
    id: u32,
    url: String,
    title: String,
    loading: bool,
    created: bool,
    history: Vec<HistoryEntry>,
    hist_idx: usize,
    pinned: bool,
    group: Option<String>,
    /// Lần cuối tab được kích hoạt (dùng cho tab ngủ).
    last_active: std::time::Instant,
}

impl Tab {
    fn new(id: u32, url: String, title: String) -> Self {
        Self {
            id,
            url,
            title,
            loading: false,
            created: false,
            history: Vec::new(),
            hist_idx: 0,
            pinned: false,
            group: None,
            last_active: std::time::Instant::now(),
        }
    }

    fn label(&self) -> String {
        format!("tab-{}", self.id)
    }

    fn can_go_back(&self) -> bool {
        self.hist_idx > 0
    }

    fn can_go_forward(&self) -> bool {
        self.hist_idx + 1 < self.history.len()
    }

    /// URL hiện hành trong lịch sử (rỗng nếu tab chưa tải trang nào xong).
    fn current(&self) -> Option<&HistoryEntry> {
        self.history.get(self.hist_idx)
    }

    /// Ghi nhận một lần tải trang hoàn tất vào lịch sử của tab.
    fn record_loaded(&mut self, url: &str) {
        if self.history.get(self.hist_idx).map(|e| e.url.as_str()) == Some(url) {
            return;
        }
        self.history.truncate(self.hist_idx + 1);
        self.history.push(HistoryEntry {
            url: url.to_string(),
            title: String::new(),
        });
        if self.history.len() > MAX_HISTORY {
            let excess = self.history.len() - MAX_HISTORY;
            self.history.drain(..excess);
        }
        self.hist_idx = self.history.len() - 1;
    }
}

#[derive(Clone)]
pub struct BrowserState {
    inner: Arc<Mutex<Inner>>,
}

impl BrowserState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                tabs: Vec::new(),
                active: None,
                next_id: 1,
                private: false,
            })),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn add_tab(&self, url: String) -> u32 {
        self.insert_tab(url, String::new())
    }

    /// Thêm tab từ session đã lưu (M2): giữ cả tiêu đề để tab bar hiển thị ngay.
    pub fn add_restored_tab(&self, url: String, title: String) -> u32 {
        self.insert_tab(url, title)
    }

    fn insert_tab(&self, url: String, title: String) -> u32 {
        let mut inner = self.lock();
        let id = inner.next_id;
        inner.next_id += 1;
        inner.tabs.push(Tab::new(id, url, title));
        id
    }

    pub fn close_tab(&self, id: u32) -> Result<(), String> {
        let mut inner = self.lock();
        let pos = inner
            .tabs
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| format!("không tìm thấy tab {id}"))?;
        inner.tabs.remove(pos);
        if inner.active == Some(id) {
            let next = inner
                .tabs
                .get(pos)
                .or_else(|| pos.checked_sub(1).and_then(|p| inner.tabs.get(p)))
                .map(|t| t.id);
            inner.active = next;
        }
        Ok(())
    }

    pub fn activate(&self, id: u32) -> Result<(), String> {
        let mut inner = self.lock();
        if !inner.tabs.iter().any(|t| t.id == id) {
            return Err(format!("không tìm thấy tab {id}"));
        }
        inner.active = Some(id);
        if let Some(t) = inner.tabs.iter_mut().find(|t| t.id == id) {
            t.last_active = std::time::Instant::now();
        }
        Ok(())
    }

    pub fn active_id(&self) -> Option<u32> {
        self.lock().active
    }

    #[allow(dead_code)]
    pub fn is_active(&self, id: u32) -> bool {
        self.lock().active == Some(id)
    }

    pub fn set_loading(&self, id: u32, loading: bool) {
        let mut inner = self.lock();
        if let Some(t) = inner.tabs.iter_mut().find(|t| t.id == id) {
            t.loading = loading;
        }
    }

    /// Đánh dấu tab đã ngủ: webview đã đóng, lịch sử giữ nguyên.
    pub fn mark_sleeping(&self, id: u32) {
        let mut inner = self.lock();
        if let Some(t) = inner.tabs.iter_mut().find(|t| t.id == id) {
            t.created = false;
        }
    }

    /// Tab đã có webview, không đang hoạt động, không tải, và rảnh quá `limit`.
    pub fn idle_candidates(&self, limit: std::time::Duration) -> Vec<u32> {
        let inner = self.lock();
        let active = inner.active;
        inner
            .tabs
            .iter()
            .filter(|t| {
                t.created && !t.loading && Some(t.id) != active && t.last_active.elapsed() >= limit
            })
            .map(|t| t.id)
            .collect()
    }

    pub fn mark_created(&self, id: u32) {
        let mut inner = self.lock();
        if let Some(t) = inner.tabs.iter_mut().find(|t| t.id == id) {
            t.created = true;
        }
    }

    pub fn set_title(&self, id: u32, title: &str) {
        let mut inner = self.lock();
        if let Some(t) = inner.tabs.iter_mut().find(|t| t.id == id) {
            t.title = title.to_string();
        }
    }

    pub fn record_loaded(&self, id: u32, url: &str) {
        let mut inner = self.lock();
        if let Some(t) = inner.tabs.iter_mut().find(|t| t.id == id) {
            t.record_loaded(url);
        }
    }

    pub fn back_target(&self, id: u32) -> Option<String> {
        let mut inner = self.lock();
        let t = inner.tabs.iter_mut().find(|t| t.id == id)?;
        if t.can_go_back() {
            t.hist_idx -= 1;
            Some(t.history[t.hist_idx].url.clone())
        } else {
            None
        }
    }

    pub fn forward_target(&self, id: u32) -> Option<String> {
        let mut inner = self.lock();
        let t = inner.tabs.iter_mut().find(|t| t.id == id)?;
        if t.can_go_forward() {
            t.hist_idx += 1;
            Some(t.history[t.hist_idx].url.clone())
        } else {
            None
        }
    }

    #[allow(dead_code)]
    pub fn persisted_tabs(&self) -> Vec<PersistedTab> {
        self.lock()
            .tabs
            .iter()
            .map(|t| PersistedTab {
                url: t
                    .current()
                    .map(|e| e.url.clone())
                    .unwrap_or_else(|| t.url.clone()),
                title: t.title.clone(),
            })
            .collect()
    }

    /// Tiêu đề hiện hành của tab (để ghi lịch sử toàn cục).
    pub fn title_of(&self, id: u32) -> String {
        self.lock()
            .tabs
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.title.clone())
            .unwrap_or_default()
    }

    /// M5: ghim hoặc bỏ ghim tab.
    pub fn set_pinned(&self, id: u32, pinned: bool) -> Result<(), String> {
        let mut inner = self.lock();
        let t = inner
            .tabs
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| format!("không tìm thấy tab {id}"))?;
        t.pinned = pinned;
        Ok(())
    }

    /// M5: gán tab vào nhóm (None để bỏ nhóm).
    pub fn set_group(&self, id: u32, group: Option<String>) -> Result<(), String> {
        let mut inner = self.lock();
        let t = inner
            .tabs
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| format!("không tìm thấy tab {id}"))?;
        t.group = group;
        Ok(())
    }

    /// M4: bật/tắt chế độ riêng tư. Chỉ tắt việc ghi lịch sử; chưa cô lập cookie (xem docs/SECURITY.md).
    pub fn set_private(&self, on: bool) {
        self.lock().private = on;
    }

    pub fn is_private(&self) -> bool {
        self.lock().private
    }

    pub fn snapshot(&self) -> StatePayload {
        let inner = self.lock();
        let mut tabs: Vec<TabInfo> = inner
            .tabs
            .iter()
            .map(|t| TabInfo {
                id: t.id,
                label: t.label(),
                url: t
                    .current()
                    .map(|e| e.url.clone())
                    .unwrap_or_else(|| t.url.clone()),
                title: t.title.clone(),
                loading: t.loading,
                created: t.created,
                can_go_back: t.can_go_back(),
                can_go_forward: t.can_go_forward(),
                pinned: t.pinned,
                group: t.group.clone(),
            })
            .collect();
        // M5: tab ghim luôn nằm đầu; sort ổn định giữ nguyên thứ tự còn lại.
        tabs.sort_by_key(|t| !t.pinned);
        StatePayload {
            tabs,
            active_tab: inner.active,
            private: inner.private,
        }
    }
}

/// Gửi toàn bộ trạng thái trình duyệt cho toolbar (webview tin cậy duy nhất).
pub fn emit_state<R: tauri::Runtime>(app: &AppHandle<R>, state: &BrowserState) {
    let _ = app.emit_to("toolbar", "browser://state", state.snapshot());
}

fn content_size(app: &AppHandle) -> LogicalSize<f64> {
    app.get_window("main")
        .and_then(|w| {
            let scale = w.scale_factor().ok()?;
            let s = w.inner_size().ok()?.to_logical::<f64>(scale);
            Some(LogicalSize::new(
                s.width,
                (s.height - TOOLBAR_HEIGHT).max(0.0),
            ))
        })
        .unwrap_or(LogicalSize::new(1200.0, 704.0))
}

/// Tạo webview nội dung cho tab nếu chưa tồn tại.
/// BẤT ĐỒNG BỘ theo thiết kế: `Window::add_child` deadlock khi gọi đồng bộ trên
/// Windows (ADR-001), nên lệnh này trả về ngay và kết quả báo qua `browser://state`.
pub fn ensure_webview(app: &AppHandle, state: &BrowserState, id: u32) {
    let label = format!("tab-{id}");
    if app.get_webview(&label).is_some() {
        state.mark_created(id);
        return;
    }
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(BLANK_URL.parse().unwrap()))
        .on_navigation(navigation::page_navigation_allowed)
        // Chế độ riêng tư: tab mới không giữ cookie trong profile (cần WebView2 ≥ 101.0.1210.39).
        .incognito(state.is_private())
        .on_document_title_changed({
            let app = app.clone();
            move |webview, title| {
                let Some(state) = app.try_state::<BrowserState>() else {
                    return;
                };
                if let Some(id) = tab_id_of(webview.label()) {
                    state.set_title(id, &title);
                    emit_state(&app, &state);
                }
            }
        })
        // M3: chọn nơi lưu file và ghi nhận kết quả tải xuống.
        .on_download({
            let app = app.clone();
            move |_webview, event| on_download(&app, event)
        })
        .on_new_window({
            let app = app.clone();
            move |url, _features| {
                // clone() để không giữ tham chiếu State qua hết vòng lặp message
                // loop — manager có thể giải chấp state giữa chừng.
                let queue = app.state::<navigation::PopupQueue>().inner();
                let allow = app.state::<std::sync::atomic::AtomicBool>().inner();
                navigation::handle_new_window(queue, allow, url)
            }
        });
    let Some(window) = app.get_window("main") else {
        return;
    };
    match window.add_child(
        builder,
        LogicalPosition::new(0.0, TOOLBAR_HEIGHT),
        content_size(app),
    ) {
        Ok(wv) => {
            state.mark_created(id);
            // Phóng to theo cài đặt đã lưu (áp dụng cho webview mới tạo).
            let _ = wv.set_zoom(zoom_factor(app));
        }
        Err(e) => log::error!("không tạo được webview {label}: {e}"),
    }
}

/// Tải URL vào tab: tạo webview nếu cần, điều hướng sau khi có surface.
/// Lệnh async — mọi thao tác WebView2 phải chạy ngoài luồng sự kiện chính.
pub async fn navigate_to(app: &AppHandle, state: &BrowserState, id: u32, url: &str) {
    let parsed = match url::Url::parse(url) {
        Ok(u) => u,
        Err(e) => {
            log::error!("URL không hợp lệ {url}: {e}");
            return;
        }
    };
    let label = format!("tab-{id}");
    if app.get_webview(&label).is_none() {
        ensure_webview(app, state, id);
        // Chờ webview xuất hiện tối đa ~5s để không treo vô hạn nếu add_child thất bại.
        let mut waited = 0u8;
        while app.get_webview(&label).is_none() && waited < 50 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            waited += 1;
        }
    }
    let Some(webview) = app.get_webview(&label) else {
        log::error!("hết thời gian chờ webview {label}");
        return;
    };
    let _ = webview.navigate(parsed);
}

pub fn reload_active(app: &AppHandle, state: &BrowserState) {
    let Some(id) = state.active_id() else {
        return;
    };
    if let Some(wv) = app.get_webview(&format!("tab-{id}")) {
        let _ = wv.reload();
    }
}

pub fn stop_active(app: &AppHandle, state: &BrowserState) {
    let Some(id) = state.active_id() else {
        return;
    };
    if let Some(wv) = app.get_webview(&format!("tab-{id}")) {
        // window.stop() dừng tải trang đang chạy — đường dẫn an toàn, không phải IPC đặc quyền.
        let _ = wv.eval("window.stop();");
    }
}

/// Ẩn mọi webview nội dung đã tạo trừ `active`.
pub fn hide_others(app: &AppHandle, state: &BrowserState, active: u32) {
    for tab in state.snapshot().tabs {
        if tab.id != active && tab.created {
            if let Some(wv) = app.get_webview(&tab.label) {
                let _ = wv.hide();
            }
        }
    }
}

/// Gọi khi chuyển tab: ẩn các webview khác, hiện (và tạo nếu cần) webview tab mới.
pub fn focus_tab(app: &AppHandle, state: &BrowserState, id: u32) {
    hide_others(app, state, id);
    let label = format!("tab-{id}");
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.show();
        let _ = wv.set_focus();
    } else {
        // Lazy: tab chưa từng hiển thị → tạo webview rồi nạp URL đang lưu.
        let url = state
            .snapshot()
            .tabs
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.url.clone());
        ensure_webview(app, state, id);
        if let (Some(u), Some(wv)) = (url, app.get_webview(&label)) {
            if let Ok(parsed) = u.parse() {
                let _ = wv.navigate(parsed);
            }
        }
    }
}

pub fn close_webview(app: &AppHandle, id: u32) {
    if let Some(wv) = app.get_webview(&format!("tab-{id}")) {
        let _ = wv.close();
    }
}

/// Đặt lại vị trí + kích thước các webview khi cửa sổ đổi cỡ (kể cả đổi DPI).
pub fn layout(app: &AppHandle, state: &BrowserState) {
    let Some(window) = app.get_window("main") else {
        return;
    };
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Ok(size) = window.inner_size() else {
        return;
    };
    let size = size.to_logical::<f64>(scale);
    if let Some(toolbar) = app.get_webview("toolbar") {
        let _ = toolbar.set_size(LogicalSize::new(
            size.width,
            toolbar_height_for(size.height),
        ));
    }
    for tab in state.snapshot().tabs {
        if !tab.created {
            continue;
        }
        if let Some(wv) = app.get_webview(&tab.label) {
            let _ = wv.set_position(LogicalPosition::new(0.0, TOOLBAR_HEIGHT));
            let _ = wv.set_size(content_size(app));
        }
    }
}

/// Xử lý sự kiện nạp trang cho mọi webview nội dung (đăng ký ở Builder::on_page_load).
pub fn on_page_load<R: tauri::Runtime>(
    app: &AppHandle<R>,
    event: PageLoadEvent,
    label: &str,
    url: &url::Url,
) {
    let Some(state) = app.try_state::<BrowserState>() else {
        return;
    };
    let Some(id) = tab_id_of(label) else {
        return;
    };
    match event {
        PageLoadEvent::Started => state.set_loading(id, true),
        PageLoadEvent::Finished => {
            let u = url.as_str();
            // about:blank chỉ là URL trung gian lúc lazy-create — không ghi lịch sử.
            if u != BLANK_URL {
                state.record_loaded(id, u);
            }
            state.set_loading(id, false);
            // M2: ghi lịch sử toàn cục khi DB khả dụng.
            // M4: chế độ riêng tư không ghi lịch sử.
            if let Some(db) = app
                .try_state::<crate::db::DbState>()
                .and_then(|d| d.0.clone())
                .filter(|_| !state.is_private())
            {
                let title = state.title_of(id);
                let _ = db.record_history(&title, url.as_str());
            }
        }
    }
    emit_state(app, &state);
}

/// Tab ngủ (cài đặt `sleepMinutes`, 0 = tắt): đóng webview của tab rảnh quá lâu.
/// Khi kích hoạt lại, tab nạp lại URL hiện hành (mất trạng thái tạm như vị trí cuộn).
/// Gọi đóng webview từ luồng nền: chưa kiểm chứng trên Windows.
pub fn sleep_idle_tabs(app: &AppHandle, state: &BrowserState) {
    let minutes = app
        .try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .and_then(|db| db.get_setting("sleepMinutes").ok().flatten())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    if minutes == 0 {
        return;
    }
    let limit = std::time::Duration::from_secs(minutes.saturating_mul(60));
    for id in state.idle_candidates(limit) {
        close_webview(app, id);
        state.mark_sleeping(id);
    }
    emit_state(app, state);
}

/// Hệ số phóng to đang lưu (cài đặt `zoom`, phần trăm). Mặc định 100%.
pub fn zoom_factor(app: &AppHandle) -> f64 {
    app.try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .and_then(|db| db.get_setting("zoom").ok().flatten())
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|p| (25.0..=500.0).contains(p))
        .map(|p| p / 100.0)
        .unwrap_or(1.0)
}

/// Áp dụng phóng to hiện hành cho mọi webview nội dung đang có.
pub fn apply_zoom(app: &AppHandle, state: &BrowserState) {
    let factor = zoom_factor(app);
    for tab in state.snapshot().tabs {
        if let Some(wv) = app.get_webview(&tab.label) {
            let _ = wv.set_zoom(factor);
        }
    }
}

/// Thư mục tải xuống: cài đặt `downloadDir` nếu là thư mục có sẵn, không thì Downloads mặc định.
fn download_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let custom = app
        .try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .and_then(|db| db.get_setting("downloadDir").ok().flatten())
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir());
    match custom {
        Some(p) => Ok(p),
        None => app.path().download_dir().map_err(|e| e.to_string()),
    }
}

/// Cài đặt `clearOnExit`: xóa cookie và dữ liệu duyệt web khi thoát.
/// Gọi bất đồng bộ nên có thể chưa xong trước khi tiến trình kết thúc (chưa kiểm chứng trên Windows).
pub fn clear_browsing_on_exit(app: &AppHandle, state: &BrowserState) {
    let enabled = app
        .try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .and_then(|db| db.get_setting("clearOnExit").ok().flatten())
        .is_some_and(|v| v == "1");
    if !enabled {
        return;
    }
    // Mọi webview dùng chung một profile nên chỉ cần gọi trên một webview.
    let first = state
        .snapshot()
        .tabs
        .iter()
        .find_map(|t| app.get_webview(&t.label));
    if let Some(wv) = first {
        let _ = wv.clear_all_browsing_data();
    }
}

/// M2/M6: lưu danh sách tab hiện tại vào DB (phiên). Gọi khi đóng cửa sổ và định kỳ.
pub fn persist_session(app: &AppHandle, state: &BrowserState) {
    if let Some(db) = app.try_state::<DbState>().and_then(|d| d.0.clone()) {
        let snap = state.snapshot();
        let active_index = snap
            .active_tab
            .and_then(|a| snap.tabs.iter().position(|t| t.id == a))
            .map(|p| p as i64)
            .unwrap_or(-1);
        let tabs: Vec<crate::db::SessionTab> = snap
            .tabs
            .iter()
            .map(|t| crate::db::SessionTab {
                url: t.url.clone(),
                title: t.title.clone(),
            })
            .collect();
        if let Err(e) = db.save_session(&tabs, active_index) {
            crate::diagnostics::log("error", &format!("lưu phiên thất bại: {e}"));
        }
    }
}

/// M15: đuôi file có thể thực thi hoặc chạy script trên Windows.
const RISKY_EXTENSIONS: &[&str] = &[
    "exe", "bat", "cmd", "com", "scr", "ps1", "msi", "vbs", "js", "jse", "wsf", "lnk", "reg",
    "dll", "hta", "jar",
];

/// Với file rủi ro, tải về sẽ có thêm đuôi .download để không chạy trực tiếp.
pub fn is_risky_file(name: &str) -> bool {
    std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| RISKY_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// M3: xử lý sự kiện tải xuống. Lưu vào thư mục Downloads của người dùng,
/// không ghi đè file cũ, và ghi lịch sử tải vào DB khi hoàn tất.
fn on_download(app: &AppHandle, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            if let Ok(dir) = download_dir(app) {
                let name = url
                    .path_segments()
                    .and_then(|segs| segs.filter(|p| !p.is_empty()).next_back())
                    .map(sanitize_file_name)
                    .unwrap_or_else(|| "download".to_string());
                let name = if is_risky_file(&name) {
                    format!("{name}.download")
                } else {
                    name
                };
                *destination = unique_path(&dir, &name);
            }
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            if let Some(db) = app.try_state::<DbState>().and_then(|d| d.0.clone()) {
                let path_str = path.as_deref().and_then(|p| p.to_str()).unwrap_or("");
                let _ = db.record_download(url.as_str(), path_str, success);
            }
            true
        }
        _ => true,
    }
}

/// Bỏ ký tự không hợp lệ trên Windows và giới hạn độ dài tên file.
fn sanitize_file_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

/// Tạo đường dẫn chưa tồn tại: "file.zip" → "file (1).zip" nếu đã có.
fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let mut candidate = dir.join(name);
    let p = std::path::Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("download");
    let ext = p.extension().and_then(|s| s.to_str());
    let mut n = 1;
    while candidate.exists() && n < 1000 {
        let file = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        candidate = dir.join(file);
        n += 1;
    }
    candidate
}

/// Tên webview do ta đặt theo quy ước `tab-<id>`; webview khác trả None.
fn tab_id_of(label: &str) -> Option<u32> {
    label.strip_prefix("tab-")?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_activate_close_cycle() {
        let s = BrowserState::new();
        let a = s.add_tab("https://a.test/".into());
        let b = s.add_tab("https://b.test/".into());
        assert_ne!(a, b);
        s.activate(b).unwrap();
        assert_eq!(s.active_id(), Some(b));
        // Đóng tab đang hoạt động → kích hoạt tab kề bên.
        s.close_tab(b).unwrap();
        assert_eq!(s.active_id(), Some(a));
        s.close_tab(a).unwrap();
        assert_eq!(s.active_id(), None);
        assert!(s.snapshot().tabs.is_empty());
    }

    #[test]
    fn close_unknown_tab_errors() {
        let s = BrowserState::new();
        assert!(s.close_tab(999).is_err());
    }

    #[test]
    fn back_forward_walk_history() {
        let s = BrowserState::new();
        let id = s.add_tab("about:blank".into());
        s.record_loaded(id, "https://one.test/");
        s.record_loaded(id, "https://two.test/");
        s.record_loaded(id, "https://three.test/");
        assert_eq!(s.back_target(id).as_deref(), Some("https://two.test/"));
        assert_eq!(s.back_target(id).as_deref(), Some("https://one.test/"));
        assert_eq!(s.back_target(id), None);
        assert_eq!(s.forward_target(id).as_deref(), Some("https://two.test/"));
        // Điều hướng mới từ giữa lịch sử cắt bỏ phần forward.
        s.record_loaded(id, "https://other.test/");
        assert_eq!(s.forward_target(id), None);
    }

    #[test]
    fn snapshot_url_follows_history() {
        let s = BrowserState::new();
        let id = s.add_tab("https://initial.test/".into());
        assert_eq!(s.snapshot().tabs[0].url, "https://initial.test/");
        s.record_loaded(id, "https://loaded.test/");
        assert_eq!(s.snapshot().tabs[0].url, "https://loaded.test/");
    }

    #[test]
    fn history_capped_at_max() {
        let s = BrowserState::new();
        let id = s.add_tab("about:blank".into());
        for i in 0..(MAX_HISTORY + 10) {
            s.record_loaded(id, &format!("https://{i}.test/"));
        }
        let snap = s.snapshot();
        let t = snap.tabs.iter().find(|t| t.id == id).unwrap();
        assert!(t.can_go_back);
        // Quay lui tối đa còn MAX_HISTORY - 1 bước.
        let mut steps = 0;
        while s.back_target(id).is_some() {
            steps += 1;
            assert!(steps <= MAX_HISTORY as u32, "lịch sử không bị chặn");
        }
        assert_eq!(steps, MAX_HISTORY as u32 - 1);
    }

    #[test]
    fn pin_moves_tab_to_front() {
        let s = BrowserState::new();
        let a = s.add_tab("https://a.test/".into());
        let b = s.add_tab("https://b.test/".into());
        s.set_pinned(b, true).unwrap();
        let snap = s.snapshot();
        assert_eq!(snap.tabs[0].id, b);
        assert!(snap.tabs[0].pinned);
        assert_eq!(snap.tabs[1].id, a);
    }

    #[test]
    fn private_flag_round_trips() {
        let s = BrowserState::new();
        assert!(!s.is_private());
        s.set_private(true);
        assert!(s.is_private());
        assert!(s.snapshot().private);
    }

    #[test]
    fn risky_files_are_detected() {
        assert!(is_risky_file("setup.EXE"));
        assert!(is_risky_file("script.ps1"));
        assert!(!is_risky_file("report.pdf"));
        assert!(!is_risky_file("archive"));
    }

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(sanitize_file_name("a:b*c?.zip"), "a_b_c_.zip");
        assert_eq!(sanitize_file_name("..."), "download");
        assert_eq!(sanitize_file_name(""), "download");
    }

    #[test]
    fn restored_tab_keeps_title() {
        let s = BrowserState::new();
        let id = s.add_restored_tab("https://x.test/".into(), "Trang X".into());
        assert_eq!(s.title_of(id), "Trang X");
    }
}
