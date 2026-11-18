#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::AtomicBool;

use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, WindowEvent};

mod browser;
mod commands;
mod db;
mod diagnostics;
mod navigation;
mod tabs;
mod terms;

use browser::BrowserState;
use db::DbState;
use navigation::PopupQueue;

fn main() {
    tauri::Builder::default()
        .manage(BrowserState::new())
        .manage(PopupQueue::default())
        .manage(AtomicBool::new(false))
        .invoke_handler(tauri::generate_handler![commands::browser_command])
        .on_page_load(|webview, payload| {
            let app = webview.app_handle().clone();
            browser::on_page_load(
                &app,
                payload.event(),
                webview.label(),
                &payload.url().clone(),
            );
        })
        .setup(|app| {
            let state: BrowserState = app.state::<BrowserState>().inner().clone();
            // M2: DB bật cho mọi tính năng lưu trữ; lỗi mở DB chỉ tắt M2, không chết app.
            if let Ok(dir) = app.path().app_data_dir() {
                diagnostics::init(dir);
            }
            // M7: kiểm tra WebView2 Runtime ngay khi khởi động để ghi nhật ký rõ ràng.
            match tauri::webview_version() {
                Ok(v) => diagnostics::log("info", &format!("WebView2 {v}")),
                Err(e) => diagnostics::log("error", &format!("không đọc được WebView2: {e}")),
            }
            let storage = app
                .path()
                .app_data_dir()
                .ok()
                .and_then(db::open);
            if storage.is_none() {
                diagnostics::log(
                    "error",
                    "không mở được CSDL; tắt lịch sử, dấu trang và phiên",
                );
            }
            app.manage(DbState(storage));
            // Điều khoản: chưa chấp nhận thì thanh công cụ phủ cửa sổ và không mở tab.
            let accepted = terms::is_accepted(app.handle());
            browser::set_toolbar_full(!accepted);

            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("Bytwina Browser")
                .inner_size(1200.0, 800.0)
                .build()?;

            // Thanh công cụ: webview tin cậy duy nhất được nạp giao diện cục bộ và gọi IPC.
            window.add_child(
                WebviewBuilder::new("toolbar", WebviewUrl::App("index.html".into())),
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1200.0, browser::toolbar_height_for(800.0)),
            )?;

            // M2: khôi phục phiên trước; nếu không có thì mở tab HOME_URL.
            let (tabs, active_idx): (Vec<db::SessionTab>, i64) = app
                .state::<DbState>()
                .0
                .as_ref()
                .and_then(|d| d.load_session().ok())
                .unwrap_or_default();
            if !accepted {
                // Chưa chấp nhận điều khoản: không mở tab nào.
            } else if tabs.is_empty() {
                let id = state.add_tab(navigation::HOME_URL.to_string());
                state.activate(id).ok();
                open_first(app.handle(), &state, id, navigation::HOME_URL);
            } else {
                let mut first_id = None;
                for (i, t) in tabs.iter().enumerate() {
                    let id = state.add_restored_tab(t.url.clone(), t.title.clone());
                    if i as i64 == active_idx || first_id.is_none() {
                        first_id = Some(id);
                    }
                }
                if let Some(id) = first_id {
                    state.activate(id).ok();
                    open_first(app.handle(), &state, id, "");
                }
            }

            let handle = app.handle().clone();
            let layout_state = state.clone();
            window.on_window_event(move |event| {
                match event {
                    WindowEvent::Resized(_) => browser::layout(&handle, &layout_state),
                    // M2: lưu danh sách tab khi người dùng đóng cửa sổ.
                    WindowEvent::CloseRequested { .. } => {
                        browser::persist_session(&handle, &layout_state)
                    }
                    _ => {}
                }
            });
            browser::emit_state(app.handle(), &state);
            // M6: lưu phiên định kỳ (30 giây) để không mất tab khi app thoát bất thường.
            let autosave_handle = app.handle().clone();
            let autosave_state = state.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                browser::persist_session(&autosave_handle, &autosave_state);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("lỗi khi chạy Bytwina Browser");
}

/// Tạo webview cho tab đầu tiên và nạp URL (kể cả URL khôi phục).
fn open_first(app: &tauri::AppHandle, state: &BrowserState, id: u32, fallback_url: &str) {
    browser::ensure_webview(app, state, id);
    let url = if fallback_url.is_empty() {
        state
            .snapshot()
            .tabs
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.url.clone())
            .unwrap_or_default()
    } else {
        fallback_url.to_string()
    };
    if let (Some(wv), Ok(parsed)) = (app.get_webview(&format!("tab-{id}")), url.parse()) {
        let _ = wv.navigate(parsed);
    }
}
