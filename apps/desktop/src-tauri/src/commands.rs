use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::browser::{self, BrowserState};
use crate::navigation::{self, PopupQueue, NEW_TAB_URL};
use crate::terms;

/// Lệnh IPC duy nhất toolbar được gọi. Tham số đầu luôn là action string;
/// mọi lệnh async để tránh deadlock WebView2 trên Windows (ADR-001).
#[tauri::command]
pub async fn browser_command(
    app: AppHandle,
    state: State<'_, BrowserState>,
    queue: State<'_, PopupQueue>,
    action: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let arg = |key: &str| -> Result<String, String> {
        args.as_ref()
            .and_then(|a| a.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("thiếu tham số '{key}' cho {action}"))
    };
    match action.as_str() {
        "state" => Ok(serde_json::to_value(state.snapshot()).unwrap()),
        "new_tab" => {
            if !terms::is_accepted(&app) {
                return Err("cần chấp nhận điều khoản trước".into());
            }
            let url = args
                .as_ref()
                .and_then(|a| a.get("url"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| NEW_TAB_URL.to_string());
            let id = state.add_tab(url);
            // Tab mới phải được kích hoạt ngay — trước đây tạo xong nhưng vẫn
            // đứng ở tab cũ nên bấm ＋/Ctrl+T không thấy gì xảy ra.
            state.activate(id)?;
            browser::focus_tab(&app, &state, id);
            browser::emit_state(&app, &state);
            Ok(serde_json::json!({ "tabId": id }))
        }
        "close_tab" => {
            let id = arg("id")?.parse::<u32>().map_err(|_| "id không hợp lệ")?;
            // Đóng webview từ luồng async (không phải main thread) để tránh deadlock.
            browser::close_webview(&app, id);
            state.close_tab(id)?;
            match state.active_id() {
                Some(active) => browser::focus_tab(&app, &state, active),
                // Đóng tab cuối cùng: mở tab trống để trình duyệt luôn dùng được.
                None => {
                    let new_id = state.add_tab(NEW_TAB_URL.to_string());
                    state.activate(new_id)?;
                    browser::focus_tab(&app, &state, new_id);
                }
            }
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "activate_tab" => {
            let id = arg("id")?.parse::<u32>().map_err(|_| "id không hợp lệ")?;
            state.activate(id)?;
            browser::focus_tab(&app, &state, id);
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "navigate" => {
            if !terms::is_accepted(&app) {
                return Err("cần chấp nhận điều khoản trước".into());
            }
            let id = arg("id")?.parse::<u32>().map_err(|_| "id không hợp lệ")?;
            let target = navigation::to_url_with(&arg("input")?, search_prefix(&app));
            browser::navigate_to(&app, &state, id, &target).await;
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "back" => {
            let id = state.active_id().ok_or("không có tab nào đang mở")?;
            if let Some(url) = state.back_target(id) {
                browser::navigate_to(&app, &state, id, &url).await;
                browser::emit_state(&app, &state);
            }
            Ok(Value::Null)
        }
        "forward" => {
            let id = state.active_id().ok_or("không có tab nào đang mở")?;
            if let Some(url) = state.forward_target(id) {
                browser::navigate_to(&app, &state, id, &url).await;
                browser::emit_state(&app, &state);
            }
            Ok(Value::Null)
        }
        "reload" => {
            browser::reload_active(&app, &state);
            Ok(Value::Null)
        }
        "stop" => {
            browser::stop_active(&app, &state);
            Ok(Value::Null)
        }
        "popup_allow" => Err("popup_allow đã bỏ: popup luôn mở thành tab nền".into()),
        "popup_drain" => {
            let urls = queue.drain();
            // Tab nền tạo lười: chưa nạp webview cho tới khi người dùng kích hoạt,
            // tránh tạo hàng loạt webview rỗng khi trang mở nhiều popup.
            for u in urls.iter() {
                state.add_tab(u.clone());
            }
            if !urls.is_empty() {
                browser::emit_state(&app, &state);
            }
            Ok(serde_json::json!({ "urls": urls }))
        }
        // ===== M2: bookmarks / history / settings / session =====
        "bookmark_add" => with_db(&app, |db| {
            db.add_bookmark(
                &arg("title")?,
                &arg("url")?,
                &arg("folder").unwrap_or_default(),
            )?;
            Ok(())
        }),
        "bookmark_remove" => with_db(&app, |db| {
            db.remove_bookmark(arg("id")?.parse().map_err(|_| "id không hợp lệ")?)
        }),
        "bookmark_list" => with_db(&app, |db| to_json(db.list_bookmarks()?)),
        "history_search" => with_db(&app, |db| {
            let q = args
                .as_ref()
                .and_then(|a| a.get("query"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            to_json(db.search_history(q, 200)?)
        }),
        "history_clear" => with_db(&app, |db| {
            db.clear_history()?;
            Ok(())
        }),
        "settings_set" => with_db(&app, |db| {
            db.set_setting(&arg("key")?, &arg("value")?)?;
            Ok(Value::Null)
        }),
        "settings_get" => with_db(&app, |db| db.get_setting(&arg("key")?)),
        "session_save" => with_db(&app, |db| {
            let snap = state.snapshot();
            let active_index = snap
                .active_tab
                .and_then(|a| snap.tabs.iter().position(|t| t.id == a))
                .map(|p| p as i64)
                .unwrap_or(-1);
            let tabs = snap
                .tabs
                .iter()
                .map(|t| crate::db::SessionTab {
                    url: t.url.clone(),
                    title: t.title.clone(),
                    pinned: t.pinned,
                    group: t.group.clone(),
                })
                .collect::<Vec<_>>();
            db.save_session(&tabs, active_index)?;
            Ok(())
        }),
        "session_load" => with_db(&app, |db| db.load_session()),
        "session_clear" => with_db(&app, |db| {
            db.clear_session()?;
            Ok(())
        }),
        // ===== M3: tải xuống =====
        "downloads_list" => with_db(&app, |db| db.list_downloads()),
        "downloads_clear" => with_db(&app, |db| {
            db.clear_downloads()?;
            Ok(())
        }),
        // ===== M4: riêng tư và xóa dữ liệu =====
        "private_set" => {
            browser::apply_private(&app, &state, arg("on")? == "1");
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "clear_data" => with_db(&app, |db| {
            db.clear_history()?;
            db.clear_downloads()?;
            db.clear_session()?;
            Ok(())
        }),
        // ===== M5: ghim tab và nhóm tab =====
        "pin_tab" => {
            let id = arg("id")?.parse::<u32>().map_err(|_| "id không hợp lệ")?;
            state.set_pinned(id, arg("on")? == "1")?;
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "set_group" => {
            let id = arg("id")?.parse::<u32>().map_err(|_| "id không hợp lệ")?;
            let group = arg("group").unwrap_or_default();
            let group = group.trim();
            let value = if group.is_empty() {
                None
            } else {
                Some(group.chars().take(24).collect::<String>())
            };
            state.set_group(id, value)?;
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        // ===== Điều khoản =====
        "terms_status" => Ok(serde_json::json!({
            "accepted": terms::is_accepted(&app),
            "version": terms::TERMS_VERSION,
        })),
        "terms_accept" => {
            terms::accept(&app)?;
            browser::set_toolbar_full(false);
            browser::layout(&app, &state);
            if state.snapshot().tabs.is_empty() {
                let id = state.add_tab(navigation::HOME_URL.to_string());
                state.activate(id)?;
                browser::navigate_to(&app, &state, id, navigation::HOME_URL).await;
            }
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "terms_decline" => {
            app.exit(0);
            Ok(Value::Null)
        }
        // ===== M15: xóa dữ liệu theo tên miền =====
        "site_clear_data" => with_db(&app, |db| db.clear_history_for_host(&arg("host")?)),
        // ===== M10: danh sách đọc =====
        "reading_add" => with_db(&app, |db| {
            db.add_reading(&arg("title").unwrap_or_default(), &arg("url")?)?;
            Ok(())
        }),
        "reading_list" => with_db(&app, |db| db.list_reading()),
        "reading_remove" => with_db(&app, |db| {
            db.remove_reading(arg("id")?.parse().map_err(|_| "id không hợp lệ")?)
        }),
        // ===== Cài đặt: phóng to =====
        "zoom_set" => {
            let percent: f64 = arg("percent")?.parse().map_err(|_| "tỷ lệ không hợp lệ")?;
            if !(25.0..=500.0).contains(&percent) {
                return Err("tỷ lệ phải từ 25 đến 500".into());
            }
            with_db(&app, |db| {
                db.set_setting("zoom", &percent.to_string())?;
                Ok(Value::Null)
            })?;
            browser::apply_zoom(&app, &state);
            Ok(Value::Null)
        }
        // ===== M7: chẩn đoán =====
        "diagnostics" => {
            let db_available = app
                .try_state::<crate::db::DbState>()
                .map(|s| s.0.is_some())
                .unwrap_or(false);
            Ok(
                serde_json::to_value(crate::diagnostics::collect(db_available))
                    .unwrap_or(Value::Null),
            )
        }
        other => Err(format!("lệnh không biết: {other}")),
    }
}

/// Tiền tố tìm kiếm theo cài đặt `searchEngine` (mặc định DuckDuckGo).
fn search_prefix(app: &AppHandle) -> &'static str {
    let key = app
        .try_state::<crate::db::DbState>()
        .and_then(|s| s.0.clone())
        .and_then(|db| db.get_setting("searchEngine").ok().flatten())
        .unwrap_or_default();
    navigation::engine_prefix(&key)
}

fn with_db<R: serde::Serialize>(
    app: &AppHandle,
    f: impl FnOnce(&crate::db::Db) -> Result<R, String>,
) -> Result<Value, String> {
    let db = app
        .try_state::<crate::db::DbState>()
        .and_then(|s| s.0.clone())
        .ok_or_else(|| "lưu trữ chưa khả dụng".to_string())?;
    to_json(f(&db)?)
}

fn to_json<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}
