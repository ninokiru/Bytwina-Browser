use std::sync::atomic::Ordering;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::browser::{self, BrowserState};
use crate::navigation::{self, PopupQueue, NEW_TAB_URL};

/// Lệnh IPC duy nhất toolbar được gọi. Tham số đầu luôn là action string;
/// mọi lệnh async để tránh deadlock WebView2 trên Windows (ADR-001).
#[tauri::command]
async fn browser_command(
    app: AppHandle,
    state: State<'_, BrowserState>,
    queue: State<'_, PopupQueue>,
    allow_next: State<'_, std::sync::atomic::AtomicBool>,
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
            let url = args
                .as_ref()
                .and_then(|a| a.get("url"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| NEW_TAB_URL.to_string());
            let id = state.add_tab(url);
            browser::emit_state(&app, &state);
            Ok(serde_json::json!({ "tabId": id }))
        }
        "close_tab" => {
            let id = arg("id")?.parse::<u32>().map_err(|_| "id không hợp lệ")?;
            // Đóng webview từ luồng async (không phải main thread) để tránh deadlock.
            browser::close_webview(&app, id);
            state.close_tab(id)?;
            if let Some(active) = state.active_id() {
                browser::focus_tab(&app, &state, active);
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
            let id = arg("id")?.parse::<u32>().map_err(|_| "id không hợp lệ")?;
            let target = navigation::to_url(&arg("input")?);
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
        "popup_allow" => {
            allow_next.store(true, Ordering::SeqCst);
            Ok(Value::Null)
        }
        "popup_drain" => {
            let urls = queue.drain();
            for u in urls.iter() {
                let id = state.add_tab(u.clone());
                browser::ensure_webview(&app, &state, id);
                browser::hide_others(&app, &state, state.active_id().unwrap_or(0));
            }
            browser::emit_state(&app, &state);
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
        })?,
        "bookmark_remove" => with_db(&app, |db| {
            db.remove_bookmark(arg("id")?.parse().map_err(|_| "id không hợp lệ")?)
        })?,
        "bookmark_list" => with_db(&app, |db| to_json(db.list_bookmarks()?))?,
        "history_search" => with_db(&app, |db| {
            let q = args
                .as_ref()
                .and_then(|a| a.get("query"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            to_json(db.search_history(q, 200)?)
        })?,
        "history_clear" => with_db(&app, |db| {
            db.clear_history()?;
            Ok(())
        })?,
        "settings_set" => with_db(&app, |db| {
            db.set_setting(&arg("key")?, &arg("value")?)?;
            Ok(Value::Null)
        })?,
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
                })
                .collect::<Vec<_>>();
            db.save_session(&tabs, active_index)?;
            Ok(())
        })?,
        "session_load" => with_db(&app, |db| db.load_session())?,
        "session_clear" => with_db(&app, |db| {
            db.clear_session()?;
            Ok(())
        })?,
        // ===== M3: tải xuống =====
        "downloads_list" => with_db(&app, |db| db.list_downloads())?,
        "downloads_clear" => with_db(&app, |db| {
            db.clear_downloads()?;
            Ok(())
        })?,
        // ===== M4: riêng tư và xóa dữ liệu =====
        "private_set" => {
            state.set_private(arg("on")? == "1");
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "clear_data" => with_db(&app, |db| {
            db.clear_history()?;
            db.clear_downloads()?;
            db.clear_session()?;
            Ok(())
        })?,
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
        other => Err(format!("lệnh không biết: {other}")),
    }
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
