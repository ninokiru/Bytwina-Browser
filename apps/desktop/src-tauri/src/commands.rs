use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
// Cho `app.autolaunch()` (bật/tắt khởi động cùng Windows) — gọi phía Rust nên
// không cần mục quyền trong capabilities, vốn chỉ gate lời gọi từ JS.
use tauri_plugin_autostart::ManagerExt as _;

use crate::browser::{self, BrowserState};
use crate::navigation::{self, PopupQueue, NEW_TAB_URL};
use crate::terms;

/// Lệnh IPC duy nhất toolbar được gọi. Tham số đầu luôn là action string;
/// mọi lệnh async để tránh deadlock WebView2 trên Windows (ADR-001).
#[tauri::command]
pub async fn browser_command(
    app: AppHandle,
    webview: tauri::Webview<tauri::Wry>,
    state: State<'_, BrowserState>,
    queue: State<'_, PopupQueue>,
    action: String,
    args: Option<Value>,
) -> Result<Value, String> {
    // ACL của Tauri CHẶN BỎ lệnh tùy biến khi origin gọi là cục bộ và dự án không
    // sinh app manifest (build.rs gọi tauri_build::build() trần). Vì vậy khả năng
    // duy nhất đáng tin là nhãn webview gọi tới: chỉ toolbar (ADR-002).
    if webview.label() != "toolbar" {
        return Err("lệnh này chỉ thanh công cụ được gọi".into());
    }
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
            let input = arg("input")?;
            // bytwina://... là trang nội bộ: báo toolbar mở bảng, webview của tab
            // không được đụng tới (nạp nó sẽ chỉ ra trang lỗi hoặc trang tìm kiếm).
            match navigation::internal_page(&input) {
                Some(navigation::Internal::Known(page)) => {
                    let _ = app.emit_to("toolbar", "browser://page", page);
                    return Ok(Value::Null);
                }
                Some(navigation::Internal::Unknown) => {
                    return Err(format!("không có trang nội bộ nào tên: {input}"));
                }
                None => {}
            }
            let target = navigation::to_url_with(&input, search_prefix(&app));
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
        "clear_data" => {
            // chrome://settings/clearBrowserData: người dùng chọn khoảng thời gian.
            // Mặc định "all" để mọi lời gọi cũ không kèm range giữ nguyên hành vi.
            let range = arg("range").unwrap_or_else(|_| "all".to_string());
            let cutoff = match range.as_str() {
                "hour" => Some(now_secs() - 3_600),
                "day" => Some(now_secs() - 86_400),
                "week" => Some(now_secs() - 7 * 86_400),
                "all" => None,
                other => return Err(format!("khoảng thời gian không biết: {other}")),
            };
            with_db(&app, move |db| {
                let (history, downloads) = match cutoff {
                    Some(since) => (
                        Some(db.clear_history_older_than(since)?),
                        Some(db.clear_downloads_older_than(since)?),
                    ),
                    None => {
                        db.clear_history()?;
                        db.clear_downloads()?;
                        // Quên cả phiên: nếu không, đúng trang vừa xóa sẽ tự mở lại
                        // ở lần chạy sau.
                        db.clear_session()?;
                        (None, None)
                    }
                };
                Ok(serde_json::json!({
                    "range": range,
                    "history": history,
                    "downloads": downloads,
                }))
            })
        }
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
        // Menu ⋮: thoát bình thường (không đụng gì tới điều khoản).
        "exit" => {
            app.exit(0);
            Ok(Value::Null)
        }
        // Bảng nổi (dấu trang, lịch sử, cài đặt…): nới webview toolbar khi mở.
        "panel_open" => {
            browser::set_panel_open(&app, &state, arg("on")? == "1");
            Ok(Value::Null)
        }
        // ===== Bố cục tab, chia màn hình, workspace =====
        "tab_layout" => {
            let vertical = arg("layout")? == "vertical";
            with_db(&app, |db| {
                db.set_setting(
                    "tabLayout",
                    if vertical { "vertical" } else { "horizontal" },
                )?;
                Ok(())
            })?;
            browser::set_vertical(vertical);
            // Thanh công cụ đổi từ dải ngang sang cột trái: bỏ ghi nhớ hình học
            // rồi bố trí lại cả toolbar lẫn webview nội dung.
            browser::relayout(&app, &state);
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "split_set" => {
            let raw = arg("id")?;
            let id = if raw.is_empty() {
                None
            } else {
                Some(raw.parse::<u32>().map_err(|_| "id không hợp lệ")?)
            };
            state.set_split(id)?;
            // focus_tab hiện/tạo webview ô phải rồi xếp lại hai ô.
            if let Some(active) = state.active_id() {
                browser::focus_tab(&app, &state, active);
            }
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        "workspace_set" => {
            let name = arg("name")?;
            let name = name.trim().to_string();
            if !browser::valid_workspace_name(&name) {
                return Err("tên workspace chỉ gồm chữ, số, '-' hoặc '_' (tối đa 24 ký tự)".into());
            }
            let previous = workspace_name(&app);
            with_db(&app, |db| {
                db.set_setting("workspace", &name)?;
                Ok(())
            })?;
            if previous != name {
                // `data_directory` chỉ có tác dụng lúc tạo webview: đóng hết
                // rồi mở lại tab đang hoạt động để nạp profile mới.
                let active = state.active_id();
                for id in state.tab_ids() {
                    browser::close_webview(&app, id);
                    state.mark_sleeping(id);
                }
                let _ = state.set_split(None);
                if let Some(id) = active {
                    browser::focus_tab(&app, &state, id);
                }
                browser::emit_state(&app, &state);
            }
            Ok(Value::Null)
        }
        "workspace_get" => with_db(&app, |db| db.get_setting("workspace")),
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
        // ===== M4: chặn quảng cáo =====
        "adblock_status" => {
            let handle = app.state::<crate::filters::BlockerHandle>();
            to_json(handle.0.status())
        }
        "adblock_set" => {
            let on = arg("on")? == "1";
            let handle = app.state::<crate::filters::BlockerHandle>();
            handle.0.set_enabled(on);
            persist_setting(&app, "adblockEnabled", if on { "1" } else { "0" });
            Ok(Value::Null)
        }
        "adblock_site" => {
            let host = arg("host")?;
            let off = arg("on")? == "1";
            let handle = app.state::<crate::filters::BlockerHandle>();
            handle.0.set_site_disabled(&host, off);
            let sites = handle.0.disabled_sites();
            persist_setting(
                &app,
                "adblockDisabledSites",
                &serde_json::to_string(&sites).unwrap_or_default(),
            );
            Ok(Value::Null)
        }
        // Dựng lại engine tốn giây nên chạy ngoài luồng UI.
        // Tải danh sách + dựng lại engine: tốn giây nên chạy ngoài luồng UI.
        "adblock_update" => {
            let handle = app
                .state::<crate::filters::BlockerHandle>()
                .0
                .clone();
            let downloaded = tauri::async_runtime::spawn_blocking(move || handle.update())
                .await
                .map_err(|e| e.to_string())??;
            Ok(serde_json::json!({ "downloaded": downloaded }))
        }
        "adblock_reload" => {
            let handle = app
                .state::<crate::filters::BlockerHandle>()
                .0
                .clone();
            let lists = tauri::async_runtime::spawn_blocking(move || handle.reload())
                .await
                .map_err(|e| e.to_string())??;
            Ok(serde_json::json!({ "lists": lists }))
        }
        // ===== M12: hệ thống =====
        "autostart_get" => app
            .autolaunch()
            .is_enabled()
            .map(Value::Bool)
            .map_err(|e| e.to_string()),
        "autostart_set" => {
            let manager = app.autolaunch();
            let result = if arg("on")? == "1" {
                manager.enable()
            } else {
                manager.disable()
            };
            result.map_err(|e| format!("không đổi được khởi động cùng Windows: {e}"))?;
            Ok(Value::Null)
        }
        "open_default_apps" => open_default_apps_page(),
        "settings_reset" => {
            with_db(&app, |db| {
                for (key, value) in DEFAULT_SETTINGS {
                    db.set_setting(key, value)?;
                }
                Ok(Value::Null)
            })?;
            // Đặt lại phải đổi cả hành vi đang chạy, không chỉ hàng trong CSDL.
            browser::set_vertical(false);
            browser::apply_zoom(&app, &state);
            if let Some(blocker) = app.try_state::<crate::filters::BlockerHandle>() {
                blocker.0.set_enabled(true);
            }
            browser::relayout(&app, &state);
            browser::emit_state(&app, &state);
            Ok(Value::Null)
        }
        // ===== M12: quyền trang web =====
        "permission_list" => {
            let handle = app.state::<crate::permissions::PermissionsHandle>();
            to_json(handle.0.list())
        }
        "permission_respond" => {
            let id = arg("id")?.parse::<u64>().map_err(|_| "id không hợp lệ")?;
            let allowed = arg("allow")? == "1";
            // Trả lời WebView2 trước: trang đang chờ deferral, không nên chờ ghi đĩa.
            answer_permission(&app, id, allowed)?;
            if arg("remember").unwrap_or_default() == "1" {
                persist_rule(&app, &arg("origin")?, &arg("kind")?, allowed)?;
            }
            Ok(Value::Null)
        }
        "permission_set" => {
            let allowed = arg("allow")? == "1";
            persist_rule(&app, &arg("origin")?, &arg("kind")?, allowed)
        }
        "permission_forget" => {
            let origin = checked_origin(&arg("origin")?)?;
            let json = {
                let handle = app.state::<crate::permissions::PermissionsHandle>();
                handle.0.forget(&origin)
            };
            persist_setting(&app, crate::permissions::SETTING_KEY, &json);
            Ok(Value::Null)
        }
        // ===== M11: kho mật khẩu mã hóa =====
        "password_status" => {
            let db = db_handle(&app)?;
            let configured = db.get_setting("vaultSalt").ok().flatten().is_some()
                && db.get_setting("vaultCheck").ok().flatten().is_some();
            let vault = app.state::<crate::passwords::PasswordVault>();
            let unlocked = vault.key(vault_timeout(&db))?.is_some();
            Ok(serde_json::json!({
                "configured": configured,
                "unlocked": unlocked,
                "count": db.count_passwords().unwrap_or(0),
                "autoLock": vault_timeout(&db),
            }))
        }
        "password_setup" => {
            let master = arg("master")?;
            validate_master(&master)?;
            let db = db_handle(&app)?;
            if db.get_setting("vaultSalt")?.is_some() {
                return Err("kho mật khẩu đã được thiết lập".into());
            }
            let salt = crate::passwords::new_salt();
            let key = crate::passwords::derive_key(&master, &salt)?;
            let check = crate::passwords::check_blob(&key)?;
            db.set_setting("vaultSalt", &crate::passwords::encode(&salt))?;
            db.set_setting("vaultCheck", &crate::passwords::encode(&check))?;
            app.state::<crate::passwords::PasswordVault>().unlock(key);
            Ok(serde_json::json!({ "ok": true }))
        }
        "password_unlock" => {
            let master = arg("master")?;
            let db = db_handle(&app)?;
            let salt = db
                .get_setting("vaultSalt")?
                .ok_or_else(|| "kho mật khẩu chưa được thiết lập".to_string())?;
            let check = db
                .get_setting("vaultCheck")?
                .ok_or_else(|| "kho mật khẩu chưa được thiết lập".to_string())?;
            let key = crate::passwords::derive_key(
                &master,
                &crate::passwords::decode(&salt)?,
            )?;
            crate::passwords::verify_check(&key, &crate::passwords::decode(&check)?)?;
            app.state::<crate::passwords::PasswordVault>().unlock(key);
            Ok(serde_json::json!({ "ok": true }))
        }
        "password_lock" => {
            app.state::<crate::passwords::PasswordVault>().lock();
            Ok(Value::Null)
        }
        "password_autolock" => {
            let minutes: u64 = arg("minutes")?.parse().map_err(|_| "số phút không hợp lệ")?;
            if minutes > 1440 {
                return Err("thời gian tự khóa tối đa 1440 phút".into());
            }
            with_db(&app, |db| {
                db.set_setting("vaultAutoLock", &minutes.to_string())?;
                Ok(Value::Null)
            })
        }
        "password_list" => {
            let (_key, db) = unlocked_key(&app)?;
            to_json(db.list_passwords()?)
        }
        "password_add" => {
            let (key, db) = unlocked_key(&app)?;
            let field = |k: &str| optional_arg(&args, k);
            let blob = secret_blob(&key, &field("password"), &field("note"))?;
            let id = db.add_password(
                &field("title"),
                &field("url"),
                &field("username"),
                &blob,
            )?;
            Ok(serde_json::json!({ "id": id }))
        }
        "password_update" => {
            let (key, db) = unlocked_key(&app)?;
            let id = arg("id")?.parse::<i64>().map_err(|_| "id không hợp lệ")?;
            let field = |k: &str| optional_arg(&args, k);
            let blob = secret_blob(&key, &field("password"), &field("note"))?;
            db.update_password(id, &field("title"), &field("url"), &field("username"), &blob)?;
            Ok(Value::Null)
        }
        "password_remove" => {
            let (_key, db) = unlocked_key(&app)?;
            let id = arg("id")?.parse::<i64>().map_err(|_| "id không hợp lệ")?;
            db.remove_password(id)?;
            Ok(Value::Null)
        }
        "password_reveal" => {
            let (key, db) = unlocked_key(&app)?;
            let id = arg("id")?.parse::<i64>().map_err(|_| "id không hợp lệ")?;
            let plain = crate::passwords::open(&key, &db.password_secret(id)?)?;
            let value: Value = serde_json::from_slice(&plain)
                .map_err(|_| "dữ liệu mật khẩu đã lưu bị hỏng".to_string())?;
            Ok(value)
        }
        // Xóa kho không cần mật khẩu chủ: người dùng quên mật khẩu vẫn phải thoát
        // được khỏi trạng thái không dùng được. Thao tác này không làm lộ dữ liệu.
        "password_wipe" => {
            let db = db_handle(&app)?;
            db.clear_passwords()?;
            db.remove_setting("vaultSalt")?;
            db.remove_setting("vaultCheck")?;
            db.remove_setting("vaultAutoLock")?;
            app.state::<crate::passwords::PasswordVault>().lock();
            Ok(Value::Null)
        }
        // ===== M13: sao lưu và khôi phục CSDL =====
        "backup_create" => {
            let db = app
                .state::<crate::db::DbState>()
                .0
                .clone()
                .ok_or("lưu trữ chưa khả dụng")?;
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            // VACUUM đọc toàn bộ CSDL: chạy ở luồng nền để không đứng chắn UI.
            let info = tauri::async_runtime::spawn_blocking(move || crate::backup::create(&db, &dir))
                .await
                .map_err(|e| e.to_string())??;
            to_json(info)
        }
        "backup_list" => {
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            to_json(crate::backup::list(&dir))
        }
        "backup_restore" => {
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            crate::backup::request_restore(&dir, &arg("name")?)?;
            Ok(Value::Null)
        }
        "backup_delete" => {
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            crate::backup::delete(&dir, &arg("name")?)?;
            Ok(Value::Null)
        }
        other => Err(format!("lệnh không biết: {other}")),
    }
}

/// Lấy Db đã mở; lỗi rõ ràng khi CSDL không khả dụng.
fn db_handle(app: &AppHandle) -> Result<crate::db::Db, String> {
    app.try_state::<crate::db::DbState>()
        .and_then(|s| s.0.clone())
        .ok_or_else(|| "lưu trữ chưa khả dụng".to_string())
}

/// Số phút tự khóa kho mật khẩu; 0 là không tự khóa.
fn vault_timeout(db: &crate::db::Db) -> u64 {
    db.get_setting("vaultAutoLock")
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

/// Khóa đang mở + Db, dùng cho mọi lệnh thao tác trên mục mật khẩu.
fn unlocked_key(app: &AppHandle) -> Result<([u8; 32], crate::db::Db), String> {
    let db = db_handle(app)?;
    let vault = app.state::<crate::passwords::PasswordVault>();
    let key = vault
        .key(vault_timeout(&db))?
        .ok_or_else(|| "kho mật khẩu đang khóa".to_string())?;
    Ok((key, db))
}

fn optional_arg(args: &Option<Value>, key: &str) -> String {
    args.as_ref()
        .and_then(|a| a.get(key))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn validate_master(master: &str) -> Result<(), String> {
    let len = master.chars().count();
    if len < 8 {
        return Err("mật khẩu chủ phải có ít nhất 8 ký tự".into());
    }
    if len > 256 {
        return Err("mật khẩu chủ quá dài".into());
    }
    Ok(())
}

/// Đóng gói mật khẩu + ghi chú thành JSON rồi mã hóa bằng khóa chủ.
fn secret_blob(key: &[u8; 32], password: &str, note: &str) -> Result<Vec<u8>, String> {
    if password.is_empty() {
        return Err("mật khẩu không được để trống".into());
    }
    let value = serde_json::json!({ "password": password, "note": note });
    crate::passwords::seal(key, value.to_string().as_bytes())
}

/// Giá trị ghi khi người dùng bấm "Đặt lại cài đặt".
/// Cố ý KHÔNG gồm: `workspace` (dữ liệu người dùng tạo), `acceptedTermsVersion`
/// (sự đồng ý đã cho là sự thật pháp lý, không phải tuỳ chọn) và `language`
/// (đổi ngôn ngữ giao diện ngay giữa phiên sẽ gây bối rối).
const DEFAULT_SETTINGS: &[(&str, &str)] = &[
    ("homeUrl", navigation::HOME_URL),
    ("searchEngine", "duckduckgo"),
    ("startupMode", "restore"),
    ("downloadDir", ""),
    ("zoom", "100"),
    ("theme", "system"),
    ("clearOnExit", "0"),
    ("sleepMinutes", "0"),
    ("tabLayout", "horizontal"),
    ("adblockEnabled", "1"),
    ("adblockDisabledSites", ""),
    ("vaultAutoLock", "0"),
];

/// Mở trang "Ứng dụng mặc định" của Windows, cách Chrome/Edge dùng thay vì tự ghi
/// đăng ký Association. Chuỗi cố định, không trộn dữ liệu người dùng vào lệnh.
#[cfg(target_os = "windows")]
fn open_default_apps_page() -> Result<Value, String> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:defaultapps"])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW: không nhấp nháy cửa sổ console
        .spawn()
        .map(|_| Value::Null)
        .map_err(|e| format!("không mở được trang Cài đặt Windows: {e}"))
}

#[cfg(not(target_os = "windows"))]
fn open_default_apps_page() -> Result<Value, String> {
    Err("chỉ Windows mới có trang ứng dụng mặc định để mở".into())
}

/// Nhảy về luồng UI của tab để đặt trạng thái quyền và hoàn tất deferral.
#[cfg(target_os = "windows")]
fn answer_permission(app: &AppHandle, id: u64, allowed: bool) -> Result<(), String> {
    let handle = app.state::<crate::permissions::PermissionsHandle>();
    crate::permissions::webview2::respond(
        app,
        handle.inner(),
        id,
        crate::permissions::webview2::state_of(allowed),
    )
}

/// Nền tảng khác chưa có điểm nối COM: lời hỏi sẽ không bao giờ tới frontend,
/// nên hàm này chỉ tồn tại để bộ lệnh IPC dùng chung một đường.
#[cfg(not(target_os = "windows"))]
fn answer_permission(_app: &AppHandle, _id: u64, _allowed: bool) -> Result<(), String> {
    Ok(())
}

/// Ghi lựa chọn vào bảng nhớ trong bộ nhớ rồi xuống CSDL.
fn persist_rule(
    app: &AppHandle,
    origin: &str,
    kind: &str,
    allowed: bool,
) -> Result<Value, String> {
    let origin = checked_origin(origin)?;
    let key = crate::permissions::Kind::from_key(kind)
        .ok_or("loại quyền không biết")?
        .key();
    let json = {
        let handle = app.state::<crate::permissions::PermissionsHandle>();
        handle.0.decide(&origin, key, allowed)
    };
    persist_setting(app, crate::permissions::SETTING_KEY, &json);
    Ok(Value::Null)
}

/// Origin đến từ frontend nhưng vẫn phải kiểm tra: đây là khóa trong bảng quyền
/// của người dùng, không được là chuỗi bất kỳ (đường dẫn, query, userinfo).
fn checked_origin(origin: &str) -> Result<String, String> {
    let rest = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"))
        .ok_or("origin phải bắt đầu bằng http:// hoặc https://")?;
    if rest.is_empty() || rest.contains('/') || rest.contains('?') || rest.contains('#') {
        return Err("origin không hợp lệ".into());
    }
    Ok(origin.to_string())
}

/// Tên workspace đang lưu (rỗng: hồ sơ mặc định).
fn workspace_name(app: &AppHandle) -> String {
    app.try_state::<crate::db::DbState>()
        .and_then(|s| s.0.clone())
        .and_then(|db| db.get_setting("workspace").ok().flatten())
        .unwrap_or_default()
}

/// Ghi một cài đặt đơn giản, bỏ qua lỗi khi CSDL không khả dụng.
fn persist_setting(app: &AppHandle, key: &str, value: &str) {
    let key = key.to_string();
    let value = value.to_string();
    let _ = with_db(app, move |db| {
        db.set_setting(&key, &value)?;
        Ok(())
    });
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

/// Mốc hiện tại theo giây từ epoch — cùng đơn vị với cột `visited_at`/`finished_at`.
fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn to_json<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}
