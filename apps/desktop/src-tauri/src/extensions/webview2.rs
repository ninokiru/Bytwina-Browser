//! Cầu nối WebView2 cho hệ tiện ích.
//!
//! Ba việc, đăng ký một lần cho mỗi webview tab:
//! 1. `AddScriptToExecuteOnDocumentCreated`: bridge + content script
//!    `document_start`, chạy trước script của trang và không phụ thuộc CSP.
//! 2. `WebMessageReceived`: nhận lời gọi storage/tabs/network từ bridge.
//! 3. Dọn đăng ký khi tab bị đóng hoặc webview bị tạo lại.

#![cfg(target_os = "windows")]

use std::cell::RefCell;
use std::collections::HashMap;

use tauri::{Manager, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2WebMessageReceivedEventArgs,
    ICoreWebView2WebMessageReceivedEventHandler,
};
use webview2_com::{
    take_pwstr, AddScriptToExecuteOnDocumentCreatedCompletedHandler, EventClosure,
    WebMessageReceivedEventHandler,
};
use windows::core::{HSTRING, PWSTR};

use crate::extensions::ExtensionsHandle;

struct Registration {
    message: ICoreWebView2WebMessageReceivedEventHandler,
    token: i64,
}

thread_local! {
    static REGISTRATIONS: RefCell<HashMap<String, Registration>> = RefCell::new(HashMap::new());
}

/// Gắn bridge + script document_start + kênh thông điệp vào webview tab.
pub fn attach(webview: &Webview<tauri::Wry>, app: tauri::AppHandle) {
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |pv| {
        let Ok(core) = (unsafe { pv.controller().CoreWebView2() }) else {
            log::error!("[{label}] không lấy được ICoreWebView2 cho tiện ích");
            return;
        };
        // Tab ngủ rồi tạo lại: bỏ đăng ký cũ trước khi thêm mới.
        remove_registration(&core, &label);

        if let Some(handle) = app.try_state::<ExtensionsHandle>() {
            let script = handle.0.document_start_script(&label);
            if script.is_empty() {
                handle.0.detach(&label);
                return;
            }
            let completed = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
                move |status: windows::core::Result<()>, _id: String| {
                    if let Err(e) = status {
                        log::debug!("đăng ký script document_start thất bại: {e}");
                    }
                    Ok(())
                },
            ));
            if let Err(e) = unsafe {
                core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(script), &completed)
            } {
                log::error!("[{label}] không đăng ký được script document_start: {e}");
            }
        }

        let app_msg = app.clone();
        let label_msg = label.clone();
        let closure: EventClosure<
            Option<ICoreWebView2>,
            Option<ICoreWebView2WebMessageReceivedEventArgs>,
        > = Box::new(move |_sender, args| {
            let Some(args) = args.as_ref() else {
                return Ok(());
            };
            let source = read_pwstr(|out| unsafe { args.Source(out) }).unwrap_or_default();
            // Chỉ nhận thông điệp dạng chuỗi JSON; thông điệp JSON của trang
            // (nếu có) không đi qua đường này.
            if let Some(raw) = read_pwstr(|out| unsafe { args.TryGetWebMessageAsString(out) }) {
                if raw.len() <= 256 * 1024 {
                    crate::extensions::handle_web_message(
                        app_msg.clone(),
                        label_msg.clone(),
                        raw,
                        source,
                    );
                }
            }
            Ok(())
        });
        let handler = WebMessageReceivedEventHandler::create(closure);
        let mut token: i64 = 0;
        match unsafe { core.add_WebMessageReceived(&handler, &mut token) } {
            Ok(()) => REGISTRATIONS.with(|r| {
                r.borrow_mut().insert(
                    label.clone(),
                    Registration {
                        message: handler,
                        token,
                    },
                );
            }),
            Err(e) => log::error!("[{label}] đăng ký WebMessageReceived thất bại: {e}"),
        }
    });
}

pub fn detach(webview: &Webview<tauri::Wry>, handle: &ExtensionsHandle) {
    let label = webview.label().to_string();
    let registration_label = label.clone();
    let _ = webview.with_webview(move |pv| {
        if let Ok(core) = unsafe { pv.controller().CoreWebView2() } {
            remove_registration(&core, &registration_label);
        }
    });
    handle.0.detach(&label);
}

fn remove_registration(core: &ICoreWebView2, label: &str) {
    let Some(reg) = REGISTRATIONS.with(|r| r.borrow_mut().remove(label)) else {
        return;
    };
    let _ = unsafe { core.remove_WebMessageReceived(reg.token) };
    let _ = reg.message;
}

/// Đọc chuỗi COM được cấp phát bằng CoTaskMem và giải phóng ngay.
fn read_pwstr(f: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> Option<String> {
    let mut out = PWSTR::null();
    if f(&mut out).is_err() {
        return None;
    }
    Some(take_pwstr(out))
}
