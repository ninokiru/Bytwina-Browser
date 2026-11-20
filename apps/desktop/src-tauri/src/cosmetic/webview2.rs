//! Áp bộ lọc thẩm mỹ vào webview thật (Windows/WebView2).
//!
//! Luồng một lượt tải trang:
//! 1. `NavigationCompleted` bắn trên luồng UI -> hỏi trang "cho tao biết class và
//!    id đang có" bằng `ExecuteScript`. JS chạy trong trang CHỈ trả về hai danh
//!    sách chuỗi; không bridge IPC, không API của ứng dụng (ADR-002 giữ nguyên).
//! 2. Trả lời về -> tra engine ở luồng nền (hàng nghìn selector không được giữ
//!    luồng UI) -> nhảy lại luồng UI chèn `<style>` bằng `ExecuteScript`.
//! 3. SPA đổi nội dung không điều hướng: CSS nằm trong `<style id>` nên mỗi lần
//!    áp dụng chỉ là ghi đè textContent, và ta nạp lại sau mọi navigation.
//!
//! Vì sao không dùng `AddScriptToExecuteOnDocumentCreated`: hook đó chạy TRƯỚC khi
//! DOM tồn tại nên đọc class/id không ra gì, và nó sống vĩnh viễn theo webview —
//! không cho phép đổi luật theo từng trang.

#![cfg(target_os = "windows")]

use std::cell::RefCell;
use std::collections::HashMap;

use tauri::{AppHandle, Manager, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2NavigationCompletedEventArgs,
    ICoreWebView2NavigationCompletedEventHandler, ICoreWebView2_2,
};
use webview2_com::{
    EventClosure, ExecuteScriptCompletedHandler, NavigationCompletedEventHandler,
};
use windows::core::{BOOL, HSTRING, Interface};

use crate::filters::BlockerHandle;

/// Số class/id tối đa nhận từ một trang. Vượt thì luật chung bỏ sót phần sau —
/// thà ẩn thiếu còn hơn kéo chậm trang có hàng nghìn phần tử.
const MAX_TOKENS: usize = 4000;

/// Chạy trong trang. Kết quả là JSON `[["class..."],["id..."]]`; đó là toàn bộ
/// dữ liệu từ web đi ngược về phía ứng dụng.
const COLLECT_SCRIPT: &str = concat!(
    "(() => {",
    "const MAX = ",
    stringify!(MAX_TOKENS),
    ";",
    "const pick = (sel, prop) => {",
    "const out = []; const seen = new Set();",
    "for (const el of document.querySelectorAll(sel)) {",
    "const v = el[prop]; if (typeof v !== 'string' || !v) continue;",
    "for (const part of v.split(/\\s+/)) {",
    "if (!part || seen.has(part)) continue;",
    "seen.add(part); out.push(part);",
    "if (out.length >= MAX) return out;",
    "}}}",
    "return out;};",
    "return JSON.stringify([pick('[class]','className'), pick('[id]','id')]);",
    "})()"
);

/// CSS nhúng dưới dạng chuỗi JS an toàn (JSON-escape), ghi đè `<style>` cũ.
fn apply_script(css: &str) -> String {
    let literal = serde_json::to_string(css).unwrap_or_else(|_| "\"\"".into());
    format!(
        "(() => {{\
const ID = \"__bytwina_cosmetic__\";\
let el = document.getElementById(ID);\
if (!el) {{\
el = document.createElement('style');\
el.id = ID;\
el.type = 'text/css';\
(document.head || document.documentElement).appendChild(el);\
}}\
el.textContent = {literal};\
}})()"
    )
}

thread_local! {
    static REGISTRATIONS: RefCell<HashMap<String, (ICoreWebView2NavigationCompletedEventHandler, i64)>> =
        RefCell::new(HashMap::new());
}

pub fn attach(webview: &Webview<tauri::Wry>, app: AppHandle, handle: BlockerHandle) {
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |pv| {
        let Ok(core) = (unsafe { pv.controller().CoreWebView2() }) else {
            log::error!("[{label}] không lấy được ICoreWebView2 cho lọc thẩm mỹ");
            return;
        };
        let Ok(core2) = core.cast::<ICoreWebView2_2>() else {
            log::error!("[{label}] ICoreWebView2_2 không khả dụng, bỏ lọc thẩm mỹ");
            return;
        };
        // Tab ngủ rồi mở lại / attach lặp: một navigation chỉ tính một lần.
        if let Some((_, old_token)) = REGISTRATIONS.with(|r| r.borrow_mut().remove(&label)) {
            let _ = unsafe { core2.remove_NavigationCompleted(old_token) };
        }

        let closure: EventClosure<
            Option<ICoreWebView2>,
            Option<ICoreWebView2NavigationCompletedEventArgs>,
        > = Box::new(move |_sender, args| {
            // Chỉ tính khi điều hướng thành công; trang lỗi thì không có gì để ẩn.
            let mut ok = BOOL::default();
            if let Some(args) = args.as_ref() {
                let _ = unsafe { args.IsSuccess(&mut ok) };
            }
            if ok.as_bool() {
                collect_and_apply(&app, &label, &handle);
            }
            Ok(())
        });

        let handler = NavigationCompletedEventHandler::create(closure);
        let mut token: i64 = 0;
        match unsafe { core2.add_NavigationCompleted(&handler, &mut token) } {
            Ok(()) => {
                REGISTRATIONS.with(|r| {
                    r.borrow_mut().insert(label.clone(), (handler, token));
                });
            }
            Err(e) => log::error!("[{label}] đăng ký NavigationCompleted thất bại: {e}"),
        }
    });
}

pub fn detach(webview: &Webview<tauri::Wry>) {
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |pv| {
        let Some((_, token)) = REGISTRATIONS.with(|r| r.borrow_mut().remove(&label)) else {
            return;
        };
        if let Ok(core2) =
            unsafe { pv.controller().CoreWebView2() }.and_then(|c| c.cast::<ICoreWebView2_2>())
        {
            let _ = unsafe { core2.remove_NavigationCompleted(token) };
        }
    });
}

fn collect_and_apply(app: &AppHandle, label: &str, handle: &BlockerHandle) {
    let Some(webview) = app.get_webview(label) else {
        return;
    };
    let app_cb = app.clone();
    let label_cb = label.to_string();
    let blocker = handle.clone();
    let _ = webview.with_webview(move |pv| {
        let Ok(core) = (unsafe { pv.controller().CoreWebView2() }) else {
            return;
        };
        let app_done = app_cb.clone();
        let label_done = label_cb.clone();
        // completed_callback nhận FnOnce (một lần gọi), khác EventClosure là FnMut.
        let step: ExecuteScriptCompletedHandler = ExecuteScriptCompletedHandler::create(Box::new(
            move |status: windows::core::Result<()>, json: String| {
                let json = if status.is_ok() { json } else { String::new() };
                let (classes, ids) = parse_lists(&json);
                let blocker = blocker.clone();
                let app_bg = app_done.clone();
                let label_bg = label_done.clone();
                // Tra engine + ghép CSS: việc nặng, không được giữ luồng UI.
                drop(tauri::async_runtime::spawn_blocking(move || {
                    let Some(engine) = blocker.0.snapshot_engine() else {
                        return;
                    };
                    let url = page_url(&app_bg, &label_bg);
                    // about:blank chỉ là chỗ trống lúc tạo tab lười.
                    if url.is_empty() || url == crate::navigation::NEW_TAB_URL {
                        return;
                    }
                    let css = crate::cosmetic::stylesheet(&engine, &url, &classes, &ids);
                    if css.is_empty() {
                        return;
                    }
                    inject(&app_bg, &label_bg, &css);
                }));
                Ok(())
            },
        ));
        let _ = unsafe { core.ExecuteScript(&HSTRING::from(COLLECT_SCRIPT), &step) };
    });
}

/// Chèn CSS. Phải quay về luồng UI vì script chạy trên webview.
/// Dùng `Webview::eval` của Tauri (nó gọi đúng ExecuteScript bên trong) thay vì
/// tự dựng completed handler: cùng việc, ít chỗ sai hơn nhiều.
fn inject(app: &AppHandle, label: &str, css: &str) {
    let Some(webview) = app.get_webview(label) else {
        return;
    };
    if let Err(e) = webview.eval(apply_script(css)) {
        log::debug!("[{label}] chèn CSS thẩm mỹ thất bại: {e}");
    }
}

/// `[["a","b"],["c"]]` -> (classes, ids). JSON hỏng hoặc sai hình dạng: coi như
/// trang không đóng góp gì — không tin dữ liệu đến từ web.
fn parse_lists(json: &str) -> (Vec<String>, Vec<String>) {
    let Ok(parsed) = serde_json::from_str::<[Vec<String>; 2]>(json) else {
        return (Vec::new(), Vec::new());
    };
    (parsed[0].clone(), parsed[1].clone())
}

fn page_url(app: &AppHandle, label: &str) -> String {
    app.get_webview(label)
        .and_then(|w| w.url().ok())
        .map(|u| u.to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_script_escapes_css_as_a_json_string() {
        let script = apply_script(".a{content:\"]\"}");
        assert!(script.contains("__bytwina_cosmetic__"), "{script}");
        assert!(script.contains(r#"\""#), "phải escape dấu nháy: {script}");
        assert!(!script.contains("tauri"), "không được lộ API ứng dụng: {script}");
    }

    #[test]
    fn collect_script_only_touches_the_dom() {
        assert!(COLLECT_SCRIPT.contains("querySelectorAll"));
        for forbidden in ["fetch", "XMLHttpRequest", "window.cr", "postMessage"] {
            assert!(
                !COLLECT_SCRIPT.contains(forbidden),
                "script đọc trang không được chứa {forbidden}"
            );
        }
    }

    #[test]
    fn malformed_or_unexpected_json_yields_nothing() {
        let (c, i) = parse_lists(r#"[["ad","sp"],["banner"]]"#);
        assert_eq!(c, vec!["ad".to_string(), "sp".to_string()]);
        assert_eq!(i, vec!["banner".to_string()]);
        assert_eq!(parse_lists(""), (Vec::new(), Vec::new()));
        assert_eq!(parse_lists("null"), (Vec::new(), Vec::new()));
        assert_eq!(parse_lists(r#"[["x"]]"#), (Vec::new(), Vec::new()));
        assert_eq!(parse_lists(r#"{"a":1}"#), (Vec::new(), Vec::new()));
    }
}
