//! Điểm nối WebView2 cho quyền trang web.
//!
//! `PermissionRequested` nằm trên `ICoreWebView2` gốc (từ runtime 0.9.430) nên không
//! cần cast giao diện mới. ba bước theo tài liệu Microsoft:
//! 1. đã có lựa chọn cho origin -> `SetState` ngay trong callback, không deferral;
//! 2. chưa có -> đặt `Handled = TRUE` TRƯỚC khi lấy deferral (nếu không webview khác
//!    trong cùng bộ điều khiển có thể trả lời trước), rồi giữ args + deferral;
//! 3. người dùng bấm trong toolbar -> lệnh IPC nhảy về đúng luồng UI của tab để
//!    `SetState` + `Deferral::Complete`.
//!
//! Interface COM của `windows` 0.62 không `Send`, nên args/deferral nằm trong
//! `thread_local`; chỉ id và nhãn webview là đi qua luồng lệnh IPC.
#![cfg(target_os = "windows")]

use std::cell::RefCell;
use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_STATE,
    COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY, ICoreWebView2,
    ICoreWebView2Deferral, ICoreWebView2PermissionRequestedEventArgs,
    ICoreWebView2PermissionRequestedEventArgs2, ICoreWebView2PermissionRequestedEventHandler,
};
use webview2_com::{take_pwstr, EventClosure, PermissionRequestedEventHandler};
use windows::core::{Interface, PWSTR};

use crate::permissions::{Kind, PermissionsHandle};

thread_local! {
    static REGISTRATIONS: RefCell<HashMap<String, (ICoreWebView2PermissionRequestedEventHandler, i64)>> =
        RefCell::new(HashMap::new());
    static PENDING: RefCell<HashMap<u64, (ICoreWebView2PermissionRequestedEventArgs, ICoreWebView2Deferral)>> =
        RefCell::new(HashMap::new());
}

/// Nội dung event gửi xuống toolbar để vẽ bảng hỏi.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Prompt {
    id: u64,
    origin: String,
    kind: &'static str,
}

pub fn attach(webview: &Webview<tauri::Wry>, app: AppHandle, handle: PermissionsHandle) {
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |pv| {
        let Ok(core) = (unsafe { pv.controller().CoreWebView2() }) else {
            log::error!("[{label}] không lấy được ICoreWebView2 cho quyền trang");
            return;
        };
        // Tab ngủ rồi mở lại, hoặc attach lặp: một lời hỏi chỉ được bắn một lần.
        if let Some((_, old_token)) = REGISTRATIONS.with(|r| r.borrow_mut().remove(&label)) {
            let _ = unsafe { core.remove_PermissionRequested(old_token) };
        }

        let closure: EventClosure<
            Option<ICoreWebView2>,
            Option<ICoreWebView2PermissionRequestedEventArgs>,
        > = Box::new(move |_sender, args| {
            let Some(args) = args else { return Ok(()) };
            // Callback chạy trên luồng UI: không I/O đồng bộ, không pump message.
            if let Err(e) = unsafe { on_requested(&args, &app, &handle, &label) } {
                log::warn!("[{label}] xử lý PermissionRequested: {e}");
            }
            Ok(())
        });

        let handler = PermissionRequestedEventHandler::create(closure);
        let mut token: i64 = 0;
        match unsafe { core.add_PermissionRequested(&handler, &mut token) } {
            Ok(()) => {
                REGISTRATIONS.with(|r| {
                    r.borrow_mut().insert(label.clone(), (handler, token));
                });
            }
            Err(e) => log::error!("[{label}] đăng ký PermissionRequested thất bại: {e}"),
        }
    });
}

/// Huỷ đăng ký và từ chối mọi lời hỏi còn treo của tab (đóng tab, hoặc tab ngủ).
pub fn detach(webview: &Webview<tauri::Wry>, handle: PermissionsHandle) {
    let label = webview.label().to_string();
    let ids = handle.0.prompts_for(&label);
    let _ = webview.with_webview(move |pv| {
        if let Some((_, token)) = REGISTRATIONS.with(|r| r.borrow_mut().remove(&label)) {
            if let Ok(core) = unsafe { pv.controller().CoreWebView2() } {
                let _ = unsafe { core.remove_PermissionRequested(token) };
            }
        }
        for id in ids {
            let entry = PENDING.with(|p| p.borrow_mut().remove(&id));
            if let Some((args, deferral)) = entry {
                unsafe {
                    let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY);
                    let _ = deferral.Complete();
                }
            }
        }
    });
}

unsafe fn on_requested(
    args: &ICoreWebView2PermissionRequestedEventArgs,
    app: &AppHandle,
    handle: &PermissionsHandle,
    label: &str,
) -> windows::core::Result<()> {
    let mut raw: COREWEBVIEW2_PERMISSION_KIND = Default::default();
    args.PermissionKind(&mut raw)?;
    let Some(kind) = Kind::from_raw(raw.0) else {
        // Loại ta không hiển thị (autoplay, phông chữ, cảm biến khác): để runtime
        // tự quyết, không giữ deferral.
        return Ok(());
    };

    let mut uri = PWSTR::null();
    args.Uri(&mut uri)?;
    let raw_uri = take_pwstr(uri);
    let Some(origin) = origin_of(&raw_uri) else {
        // Không xác định được origin (opaque) thì không hỏi và cũng không ghi luật:
        // bảng quyền chỉ nói về origin đọc được.
        log::debug!("bỏ qua quyền không xác định origin: {raw_uri}");
        return Ok(());
    };

    if let Some(allow) = handle.0.lookup(&origin, kind.key()) {
        args.SetState(if allow {
            COREWEBVIEW2_PERMISSION_STATE_ALLOW
        } else {
            COREWEBVIEW2_PERMISSION_STATE_DENY
        })?;
        return Ok(());
    }

    // Đặt Handled trước khi lấy deferral (yêu cầu trong tài liệu Microsoft).
    // Runtime cũ hơn 1.0.1185.39 không có giao diện này; khi đó vẫn còn deferral.
    if let Ok(args2) = args.cast::<ICoreWebView2PermissionRequestedEventArgs2>() {
        let _ = args2.SetHandled(true);
    }
    let deferral = args.GetDeferral()?;
    let id = handle.0.next_prompt_id();
    PENDING.with(|p| {
        p.borrow_mut().insert(id, (args.clone(), deferral));
    });
    handle.0.remember_prompt(id, label);
    let _ = app.emit_to(
        "toolbar",
        "browser://permission",
        Prompt {
            id,
            origin,
            kind: kind.key(),
        },
    );
    Ok(())
}

/// Trả lời của người dùng, gọi từ luồng lệnh IPC: nhảy về đúng luồng UI của tab.
pub fn respond(
    app: &AppHandle,
    handle: &PermissionsHandle,
    id: u64,
    state: COREWEBVIEW2_PERMISSION_STATE,
) -> Result<(), String> {
    let label = handle
        .0
        .take_prompt_label(id)
        .ok_or("lời hỏi không còn (tab đã đổi trang hoặc đóng)")?;
    let webview = app
        .get_webview(&label)
        .ok_or("webview của tab đã bị đóng")?;
    let _ = webview.with_webview(move |_pv| {
        let entry = PENDING.with(|p| p.borrow_mut().remove(&id));
        let Some((args, deferral)) = entry else { return };
        unsafe {
            let _ = args.SetState(state);
            let _ = deferral.Complete();
        }
    });
    Ok(())
}

/// `scheme://host[:port]` — quyền là theo origin, không theo từng trang.
fn origin_of(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()?
        .origin()
        .ok()
        .map(|o| o.ascii_serialization())
}

/// Tên state cho frontend/IPC dùng khi ghi luật.
pub fn state_of(allowed: bool) -> COREWEBVIEW2_PERMISSION_STATE {
    if allowed {
        COREWEBVIEW2_PERMISSION_STATE_ALLOW
    } else {
        COREWEBVIEW2_PERMISSION_STATE_DENY
    }
}
