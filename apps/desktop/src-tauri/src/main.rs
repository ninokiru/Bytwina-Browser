#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, WindowEvent,
};

const TOOLBAR_HEIGHT: f64 = 48.0;
const TAB_URLS: [&str; 2] = ["https://example.com/", "https://example.org/"];

/// Chuyển tab: hiện webview tab được chọn, ẩn các tab còn lại.
/// Là command async để tránh deadlock của add_child khi gọi từ handler đồng bộ.
#[tauri::command]
async fn switch_tab(app: AppHandle, id: u32) -> Result<(), String> {
    for n in 1..=TAB_URLS.len() as u32 {
        let label = format!("tab-{n}");
        let webview = app
            .get_webview(&label)
            .ok_or_else(|| format!("không tìm thấy {label}"))?;
        if n == id {
            webview.show().map_err(|e| e.to_string())?;
        } else {
            webview.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Đặt lại vị trí và kích thước: toolbar ở trên, các tab bên dưới toolbar.
fn layout(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_window("main") else {
        return Ok(());
    };
    let scale = window.scale_factor()?;
    let size = window.inner_size()?.to_logical::<f64>(scale);
    let content_height = (size.height - TOOLBAR_HEIGHT).max(0.0);

    if let Some(toolbar) = app.get_webview("toolbar") {
        toolbar.set_size(LogicalSize::new(size.width, TOOLBAR_HEIGHT))?;
    }
    for n in 1..=TAB_URLS.len() {
        if let Some(tab) = app.get_webview(&format!("tab-{n}")) {
            tab.set_position(LogicalPosition::new(0.0, TOOLBAR_HEIGHT))?;
            tab.set_size(LogicalSize::new(size.width, content_height))?;
        }
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![switch_tab])
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

            // Các tab: webview nội dung từ xa, không có quyền IPC.
            for (i, url) in TAB_URLS.iter().enumerate() {
                let parsed = tauri::Url::parse(url)?;
                window.add_child(
                    WebviewBuilder::new(
                        format!("tab-{}", i + 1),
                        WebviewUrl::External(parsed),
                    ),
                    LogicalPosition::new(0.0, TOOLBAR_HEIGHT),
                    LogicalSize::new(1200.0, 752.0),
                )?;
            }

            // Tab 2 ẩn lúc khởi động (lazy: tab 1 là tab hiện hành).
            if let Some(tab2) = app.get_webview("tab-2") {
                tab2.hide()?;
            }

            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Resized(_) = event {
                    let _ = layout(&handle);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("lỗi khi chạy Nova Browser");
}
