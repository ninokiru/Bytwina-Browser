#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod navigation;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewBuilder,
    WebviewUrl, WindowEvent,
};

use navigation::{is_allowed_navigation, normalize_input};

const TOOLBAR_HEIGHT: f64 = 48.0;
const NEW_TAB_URL: &str = "about:blank";

#[derive(Clone, Serialize)]
struct TabInfo {
    id: u32,
    url: String,
    active: bool,
}

struct TabEntry {
    id: u32,
    url: String,
}

#[derive(Default)]
struct Tabs {
    list: Vec<TabEntry>,
    active: Option<u32>,
    next_id: u32,
}

#[derive(Default)]
struct TabState(Mutex<Tabs>);

fn lock(state: &TabState) -> std::sync::MutexGuard<'_, Tabs> {
    // Không panic khi mutex bị poisoned: vẫn dùng dữ liệu hiện có.
    state.0.lock().unwrap_or_else(|p| p.into_inner())
}

fn label(id: u32) -> String {
    format!("tab-{id}")
}

fn parse_label(label: &str) -> Option<u32> {
    label.strip_prefix("tab-")?.parse().ok()
}

fn snapshot(state: &TabState) -> Vec<TabInfo> {
    let tabs = lock(state);
    tabs.list
        .iter()
        .map(|e| TabInfo {
            id: e.id,
            url: e.url.clone(),
            active: tabs.active == Some(e.id),
        })
        .collect()
}

fn content_rect(window: &tauri::Window) -> tauri::Result<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let scale = window.scale_factor()?;
    let size = window.inner_size()?.to_logical::<f64>(scale);
    Ok((
        LogicalPosition::new(0.0, TOOLBAR_HEIGHT),
        LogicalSize::new(size.width, (size.height - TOOLBAR_HEIGHT).max(0.0)),
    ))
}

/// Đặt lại kích thước: thanh công cụ ở trên, mọi tab nằm dưới thanh công cụ.
fn layout(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_window("main") else {
        return Ok(());
    };
    let scale = window.scale_factor()?;
    let size = window.inner_size()?.to_logical::<f64>(scale);
    if let Some(toolbar) = app.get_webview("toolbar") {
        toolbar.set_size(LogicalSize::new(size.width, TOOLBAR_HEIGHT))?;
    }
    let (pos, content) = content_rect(&window)?;
    let ids: Vec<u32> = {
        let state = app.state::<TabState>();
        let tabs = lock(&state);
        tabs.list.iter().map(|e| e.id).collect()
    };
    for id in ids {
        if let Some(tab) = app.get_webview(&label(id)) {
            tab.set_position(pos)?;
            tab.set_size(content)?;
        }
    }
    Ok(())
}

fn remove_entry(app: &AppHandle, id: u32) {
    let state = app.state::<TabState>();
    lock(&state).list.retain(|e| e.id != id);
}

/// Tạo webview cho tab mới (chưa hiện). Trả về id của tab.
fn spawn_tab(app: &AppHandle, url: Url) -> Result<u32, String> {
    let window = app
        .get_window("main")
        .ok_or("không tìm thấy cửa sổ chính")?;
    let id = {
        let state = app.state::<TabState>();
        let mut tabs = lock(&state);
        tabs.next_id += 1;
        let id = tabs.next_id;
        tabs.list.push(TabEntry {
            id,
            url: url.to_string(),
        });
        id
    };
    let (pos, size) = content_rect(&window).map_err(|e| e.to_string())?;

    let handle = app.clone();
    let builder = WebviewBuilder::new(label(id), WebviewUrl::External(url))
        .on_navigation(|u: &Url| is_allowed_navigation(u))
        .on_page_load(move |wv, payload| {
            // Cập nhật URL của tab khi trang bắt đầu/kết thúc tải.
            let Some(id) = parse_label(wv.label()) else {
                return;
            };
            let new_url = payload.url().to_string();
            {
                let state = handle.state::<TabState>();
                let mut tabs = lock(&state);
                if let Some(entry) = tabs.list.iter_mut().find(|e| e.id == id) {
                    entry.url = new_url;
                }
            }
            let _ = handle.emit("tabs-changed", snapshot(&handle.state::<TabState>()));
        });

    if let Err(e) = window.add_child(builder, pos, size) {
        remove_entry(app, id);
        return Err(e.to_string());
    }
    Ok(id)
}

/// Hiện tab được chọn, ẩn các tab còn lại.
fn set_active(app: &AppHandle, id: u32) -> Result<(), String> {
    let ids: Vec<u32> = {
        let state = app.state::<TabState>();
        let mut tabs = lock(&state);
        if !tabs.list.iter().any(|e| e.id == id) {
            return Err("tab không tồn tại".into());
        }
        tabs.active = Some(id);
        tabs.list.iter().map(|e| e.id).collect()
    };
    for tid in ids {
        if let Some(wv) = app.get_webview(&label(tid)) {
            let result = if tid == id { wv.show() } else { wv.hide() };
            result.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn active_id(app: &AppHandle) -> Result<u32, String> {
    let state = app.state::<TabState>();
    let id = lock(&state).active;
    id.ok_or_else(|| "không có tab đang hoạt động".to_string())
}

fn active_webview(app: &AppHandle) -> Result<tauri::Webview, String> {
    let id = active_id(app)?;
    app.get_webview(&label(id))
        .ok_or_else(|| "không tìm thấy webview của tab".to_string())
}

#[tauri::command]
async fn tabs(state: State<'_, TabState>) -> Result<Vec<TabInfo>, String> {
    Ok(snapshot(&state))
}

#[tauri::command]
async fn new_tab(app: AppHandle, url: Option<String>) -> Result<Vec<TabInfo>, String> {
    let target = match url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(input) => normalize_input(input)?,
        None => normalize_input(NEW_TAB_URL)?,
    };
    let id = spawn_tab(&app, target)?;
    set_active(&app, id)?;
    Ok(snapshot(&app.state::<TabState>()))
}

#[tauri::command]
async fn close_tab(app: AppHandle, id: u32) -> Result<Vec<TabInfo>, String> {
    let (was_active, next) = {
        let state = app.state::<TabState>();
        let mut tabs = lock(&state);
        let pos = tabs
            .list
            .iter()
            .position(|e| e.id == id)
            .ok_or("tab không tồn tại")?;
        let was_active = tabs.active == Some(id);
        tabs.list.remove(pos);
        let next = if tabs.list.is_empty() {
            None
        } else {
            Some(tabs.list[pos.min(tabs.list.len() - 1)].id)
        };
        if was_active {
            tabs.active = None;
        }
        (was_active, next)
    };
    if let Some(wv) = app.get_webview(&label(id)) {
        wv.close().map_err(|e| e.to_string())?;
    }
    if was_active {
        match next {
            Some(next_id) => set_active(&app, next_id)?,
            None => {
                // Đóng tab cuối cùng thì mở lại tab trống để luôn có nội dung.
                let id = spawn_tab(&app, normalize_input(NEW_TAB_URL)?)?;
                set_active(&app, id)?;
            }
        }
    }
    Ok(snapshot(&app.state::<TabState>()))
}

#[tauri::command]
async fn activate_tab(app: AppHandle, id: u32) -> Result<Vec<TabInfo>, String> {
    set_active(&app, id)?;
    Ok(snapshot(&app.state::<TabState>()))
}

#[tauri::command]
async fn navigate(app: AppHandle, input: String) -> Result<Vec<TabInfo>, String> {
    let url = normalize_input(&input)?;
    active_webview(&app)?
        .navigate(url)
        .map_err(|e| e.to_string())?;
    Ok(snapshot(&app.state::<TabState>()))
}

#[tauri::command]
async fn reload(app: AppHandle) -> Result<(), String> {
    active_webview(&app)?.reload().map_err(|e| e.to_string())
}

// Tauri Webview không có API back/forward gốc; dùng History API của trang.
// Xem docs/DECISIONS.md, ADR-002.
#[tauri::command]
async fn go_back(app: AppHandle) -> Result<(), String> {
    active_webview(&app)?
        .eval("history.back()")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn go_forward(app: AppHandle) -> Result<(), String> {
    active_webview(&app)?
        .eval("history.forward()")
        .map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(TabState::default())
        .invoke_handler(tauri::generate_handler![
            tabs,
            new_tab,
            close_tab,
            activate_tab,
            navigate,
            reload,
            go_back,
            go_forward
        ])
        .setup(|app| {
            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("Nova Browser")
                .inner_size(1200.0, 800.0)
                .build()?;

            // Thanh công cụ: webview tin cậy, nạp giao diện React cục bộ.
            window.add_child(
                WebviewBuilder::new("toolbar", WebviewUrl::App("index.html".into())),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1200.0, TOOLBAR_HEIGHT),
            )?;

            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Resized(_) = event {
                    let _ = layout(&handle);
                }
            });

            // Tab đầu tiên: trang tab mới.
            let first = spawn_tab(app.handle(), normalize_input(NEW_TAB_URL)?)?;
            set_active(app.handle(), first)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("lỗi khi chạy Nova Browser");
}
