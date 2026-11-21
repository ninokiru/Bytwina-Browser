#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Bộ cấp phát thay thế, chỉ bật khi đo: `cargo build --features alloc-mimalloc`.
#[cfg(feature = "alloc-mimalloc")]
#[global_allocator]
static ALLOC: mimalloc::MiMalloc = mimalloc::MiMalloc;

use tauri::{LogicalPosition, Manager, WebviewBuilder, WebviewUrl, WindowEvent};

mod browser;
mod backup;
mod commands;
mod cosmetic;
mod db;
mod diagnostics;
mod filters;
mod navigation;
mod passwords;
mod permissions;
mod tabs;
mod terms;
mod update;

use browser::BrowserState;
use db::DbState;
use navigation::PopupQueue;

fn main() {
    tauri::Builder::default()
        .manage(BrowserState::new())
        .manage(PopupQueue::default())
        // M11: khóa kho mật khẩu chỉ nằm trong bộ nhớ phiên chạy.
        .manage(passwords::PasswordVault::default())
        // MacosLauncher bắt buộc trong chữ ký nhưng bị bỏ qua trên Windows.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // M14: plugin tự cập nhật. Không cấp quyền updater:* cho webview nào:
        // chỉ Rust gọi, nên trang web không thể kích hoạt tải/cài.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::PendingUpdate::default())
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
            let storage = app.path().app_data_dir().ok().and_then(db::open);
            if storage.is_none() {
                diagnostics::log(
                    "error",
                    "không mở được CSDL; tắt lịch sử, dấu trang và phiên",
                );
            }
            app.manage(DbState(storage));
            // M4: bộ chặn quảng cáo. Nạp engine ở luồng nền vì parse hàng chục
            // nghìn luật mất vài giây trên máy cấu hình thấp.
            let filters_dir = app
                .path()
                .app_data_dir()
                .map(|d| d.join("filters"))
                .unwrap_or_default();
            let blocker = filters::BlockerHandle(std::sync::Arc::new(filters::Blocker::new(
                filters_dir,
            )));
            if let Some(db) = app.state::<DbState>().0.clone() {
                let enabled = db
                    .get_setting("adblockEnabled")
                    .ok()
                    .flatten()
                    .map(|v| v != "0")
                    .unwrap_or(true);
                blocker.0.set_enabled(enabled);
                if let Ok(Some(list)) = db.get_setting("adblockDisabledSites") {
                    for host in serde_json::from_str::<Vec<String>>(&list).unwrap_or_default() {
                        blocker.0.set_site_disabled(&host, true);
                    }
                }
            }
            app.manage(blocker.clone());
            {
                let handle = blocker.0.clone();
                std::thread::spawn(move || {
                    if let Err(e) = handle.load() {
                        diagnostics::log("error", &format!("bộ chặn quảng cáo: {e}"));
                    }
                });
            }
            // M12: quyền trang web. Luật đã lưu được nạp vào bộ nhớ để callback
            // PermissionRequested (chạy trên luồng UI) không phải đọc đĩa.
            let perms = permissions::PermissionsHandle(std::sync::Arc::new(
                permissions::Permissions::default(),
            ));
            if let Some(db) = app.state::<DbState>().0.clone() {
                if let Ok(Some(json)) = db.get_setting(permissions::SETTING_KEY) {
                    perms.0.load(&json);
                }
            }
            app.manage(perms);
            // Điều khoản: chưa chấp nhận thì thanh công cụ phủ cửa sổ và không mở tab.
            let accepted = terms::is_accepted(app.handle());
            browser::set_toolbar_full(!accepted);
            // Bố cục tab đã lưu phải có hiệu lực trước khi tạo toolbar để cỡ
            // webview và vùng nội dung khớp ngay lần vẽ đầu tiên.
            let vertical = app
                .state::<DbState>()
                .0
                .as_ref()
                .and_then(|d| d.get_setting("tabLayout").ok().flatten())
                .is_some_and(|v| v == "vertical");
            browser::set_vertical(vertical);

            let window = tauri::window::WindowBuilder::new(app, "main")
                .title("Bytwina Browser")
                .inner_size(1200.0, 800.0)
                // Dưới ngưỡng này thanh công cụ hai hàng sẽ chồng lên nhau.
                .min_inner_size(900.0, 560.0)
                .build()?;

            // Thanh công cụ: webview tin cậy duy nhất được nạp giao diện cục bộ và gọi IPC.
            window.add_child(
                WebviewBuilder::new("toolbar", WebviewUrl::App("index.html".into())),
                LogicalPosition::new(0.0, 0.0),
                browser::toolbar_size_for(1200.0, 800.0),
            )?;

            // M2: khôi phục phiên trước; nếu không có thì mở tab HOME_URL.
            let startup_mode = app
                .state::<DbState>()
                .0
                .as_ref()
                .and_then(|d| d.get_setting("startupMode").ok().flatten())
                .unwrap_or_else(|| "restore".to_string());
            let (tabs, active_idx): (Vec<db::SessionTab>, i64) = if startup_mode == "restore" {
                app.state::<DbState>()
                    .0
                    .as_ref()
                    .and_then(|d| d.load_session().ok())
                    .unwrap_or_default()
            } else {
                (Vec::new(), -1)
            };
            if !accepted {
                // Chưa chấp nhận điều khoản: không mở tab nào.
            } else if tabs.is_empty() {
                let start = startup_url(app.handle(), &startup_mode);
                let id = state.add_tab(start.clone());
                state.activate(id).ok();
                open_first(app.handle(), &state, id, &start);
            } else {
                let mut first_id = None;
                for (i, t) in tabs.iter().enumerate() {
                    let id = state.add_restored_tab(
                        t.url.clone(),
                        t.title.clone(),
                        t.pinned,
                        t.group.clone(),
                    );
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
            let closing = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let closing_clone = closing.clone();
            window.on_window_event(move |event| {
                match event {
                    WindowEvent::Resized(_) => browser::layout(&handle, &layout_state),
                    // M2: lưu danh sách tab và dọn dữ liệu nếu cần khi đóng cửa sổ.
                    WindowEvent::CloseRequested { api, .. } => {
                        if !closing_clone.swap(true, std::sync::atomic::Ordering::SeqCst) {
                            api.prevent_close();
                            let h = handle.clone();
                            let s = layout_state.clone();
                            std::thread::spawn(move || {
                                browser::clear_browsing_on_exit(&h, &s);
                                browser::persist_session(&h, &s);
                                if let Some(w) = h.get_window("main") {
                                    let _ = w.destroy();
                                }
                            });
                        }
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
                browser::sleep_idle_tabs(&autosave_handle, &autosave_state);
                // M11: tự khóa kho theo ĐỒNG HỒ. Trước đây hạn chỉ được xét khi có
                // lệnh gọi vào vault, nên kho mở rồi bỏ đó giữ khóa trong RAM vô hạn.
                if let Some(db) = autosave_handle
                    .try_state::<crate::db::DbState>()
                    .and_then(|s| s.0.clone())
                {
                    let minutes = db
                        .get_setting("vaultAutoLock")
                        .ok()
                        .flatten()
                        .and_then(|v| v.parse::<u64>().ok())
                        .unwrap_or(0);
                    autosave_handle
                        .state::<passwords::PasswordVault>()
                        .expire(minutes);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("lỗi khi chạy Bytwina Browser");
}

/// URL mở khi khởi động: chế độ "blank" → trang trống; còn lại → trang chủ đã lưu.
fn startup_url(app: &tauri::AppHandle, mode: &str) -> String {
    if mode == "blank" {
        return navigation::NEW_TAB_URL.to_string();
    }
    app.try_state::<DbState>()
        .and_then(|s| s.0.clone())
        .and_then(|db| db.get_setting("homeUrl").ok().flatten())
        .filter(|s| !s.trim().is_empty())
        .map(|s| navigation::to_url(&s))
        .unwrap_or_else(|| navigation::HOME_URL.to_string())
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
