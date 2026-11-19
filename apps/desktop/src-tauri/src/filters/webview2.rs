//! Chặn request ở tầng WebView2 (COM) cho từng webview nội dung.
//!
//! Phải xuống COM vì wry/Tauri 2.12 không mở hook cho tài nguyên con — Tauri chỉ
//! có `on_navigation` và `on_download`, còn `on_web_resource_request` chỉ chạy cho
//! protocol `tauri`, không áp dụng cho trang từ xa.
#![cfg(target_os = "windows")]

use std::cell::RefCell;
use std::collections::HashMap;

use tauri::Webview;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_OTHER,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SIGNED_EXCHANGE, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET,
    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST,
    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL, ICoreWebView2, ICoreWebView2Environment,
    ICoreWebView2WebResourceRequest, ICoreWebView2WebResourceRequestedEventArgs,
    ICoreWebView2WebResourceRequestedEventHandler, ICoreWebView2_22,
};
use webview2_com::{take_pwstr, EventClosure, WebResourceRequestedEventHandler};
use windows::core::{HSTRING, Interface, PCWSTR, PWSTR};
use windows::Win32::System::Com::IStream;

use crate::filters::BlockerHandle;

/// Handler + registration token, giữ theo nhãn webview.
///
/// Interface COM của windows 0.62 không phải `Send`/`Sync`, nên đăng ký nằm trong
/// `thread_local`: mọi callback WebView2 và mọi closure của `with_webview` đều chạy
/// trên đúng luồng UI này.
thread_local! {
    static REGISTRATIONS: RefCell<HashMap<String, (ICoreWebView2WebResourceRequestedEventHandler, i64)>> =
        RefCell::new(HashMap::new());
}

/// Đăng ký bộ chặn cho MỘT webview vừa tạo. Phải gọi trước navigation đầu tiên vì
/// WebView2 chỉ bắn event cho request xảy ra sau khi đặt filter.
pub fn attach(webview: &Webview<tauri::Wry>, handle: BlockerHandle) {
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |pv| {
        let Ok(core) = (unsafe { pv.controller().CoreWebView2() }) else {
            log::error!("[{label}] không lấy được ICoreWebView2");
            return;
        };
        let environment = pv.environment();

        // Tab ngủ rồi mở lại, hoặc attach lặp: bỏ đăng ký cũ để một request
        // không bắn event nhiều lần.
        if let Some((_, old_token)) = REGISTRATIONS.with(|r| r.borrow_mut().remove(&label)) {
            let _ = unsafe { core.remove_WebResourceRequested(old_token) };
        }

        unsafe {
            // Bản 3 tham số (uri, context, sourceKinds) nằm trên ICoreWebView2_22; runtime
            // cũ hơn không có thì rơi về bản 2 tham số — bản đó được Microsoft đánh dấu
            // deprecated vì chỉ bắn event cho khung chính và iframe cùng nguồn.
            if let Ok(core22) = core.cast::<ICoreWebView2_22>() {
                if let Err(e) = core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                    &HSTRING::from("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                ) {
                    log::error!("[{label}] đặt filter 3 tham số thất bại: {e}");
                }
            } else if let Err(e) =
                core.AddWebResourceRequestedFilter("*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)
            {
                log::error!("[{label}] đặt filter thất bại: {e}");
            }
        }

        let closure: EventClosure<
            Option<ICoreWebView2>,
            Option<ICoreWebView2WebResourceRequestedEventArgs>,
        > = Box::new(move |sender, args| {
            let Some(args) = args else { return Ok(()) };
            // Callback chạy trên luồng UI: không pump message, không I/O đồng bộ.
            if let Err(e) =
                unsafe { on_requested(&args, sender.as_ref(), &environment, &handle) }
            {
                log::error!("bộ chặn WebView2: {e}");
            }
            Ok(())
        });

        let handler = WebResourceRequestedEventHandler::create(closure);
        // webview2-com 0.39 sinh token dạng i64 thô, không phải EventRegistrationToken.
        let mut token: i64 = 0;
        unsafe {
            match core.add_WebResourceRequested(handler.clone(), &mut token) {
                Ok(()) => REGISTRATIONS
                    .with(|r| r.borrow_mut().insert(label.clone(), (handler, token))),
                Err(e) => log::error!("[{label}] đăng ký WebResourceRequested thất bại: {e}"),
            };
        }
    });
}

/// Huỷ đăng ký; gọi TRƯỚC khi đóng webview để handler giải phóng cùng tab.
pub fn detach(webview: &Webview<tauri::Wry>) {
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |pv| {
        let Some((_, token)) = REGISTRATIONS.with(|r| r.borrow_mut().remove(&label)) else {
            return;
        };
        if let Ok(core) = unsafe { pv.controller().CoreWebView2() } {
            let _ = unsafe { core.remove_WebResourceRequested(token) };
        }
    });
}

unsafe fn on_requested(
    args: &ICoreWebView2WebResourceRequestedEventArgs,
    sender: Option<&ICoreWebView2>,
    environment: &ICoreWebView2Environment,
    handle: &BlockerHandle,
) -> windows::core::Result<()> {
    let _ = sender;
    let mut context: COREWEBVIEW2_WEB_RESOURCE_CONTEXT = Default::default();
    args.ResourceContext(&mut context)?;

    let request = args.Request()?;
    let uri = request_uri(&request);
    if uri.is_empty() {
        return Ok(());
    }
    let source = source_url(&request);

    if handle.0.should_block(&uri, &source, resource_type(context)) {
        // Sự kiện này không có Cancel(): chặn nghĩa là tự trả một đáp án rỗng.
        // content = nullptr là hợp lệ theo mẫu chặn tài nguyên của Microsoft.
        let response = environment.CreateWebResourceResponse(
            None::<&IStream>,
            404,
            "Blocked",
            PCWSTR::null(),
        )?;
        args.SetResponse(&response)?;
    }
    Ok(())
}

/// `Uri(LPWSTR*)` cấp phát bằng CoTaskMem; `take_pwstr` lấy chuỗi và giải phóng.
unsafe fn request_uri(request: &ICoreWebView2WebResourceRequest) -> String {
    let mut uri = PWSTR::null();
    let _ = request.Uri(&mut uri);
    take_pwstr(uri)
}

/// `ICoreWebView2WebResourceRequest` không có initiator, nên nguồn gần đúng nhất là
/// `Referer`, rồi `Origin`.
///
/// Hệ quả: request không có cả hai header (navigation cấp cao nhất, ảnh
/// `referrerpolicy=noreferrer`) sẽ có `source_url` rỗng → `filters` coi là same-origin
/// và không chặn. Chọn này cố ý: thà chặn thiếu còn hơn làm trắng trang người dùng.
unsafe fn source_url(request: &ICoreWebView2WebResourceRequest) -> String {
    let Ok(headers) = request.Headers() else {
        return String::new();
    };
    for name in ["Referer", "Origin"] {
        let mut value = PWSTR::null();
        if headers.GetHeader(&HSTRING::from(name), &mut value).is_ok() {
            let header = take_pwstr(value);
            if !header.is_empty() {
                return header;
            }
        } else {
            // Lời gọi lỗi vẫn có thể để lại con trỏ đã cấp phát.
            let _ = take_pwstr(value);
        }
    }
    String::new()
}

/// Ánh xạ loại tài nguyên WebView2 sang tên adblock-rs dùng.
/// `document` giữ nguyên: `filters::Blocker` tự hạ xuống `subdocument` khi thấy
/// request là bên thứ ba, vì WebView2 không phân biệt khung gốc với iframe ở đây.
fn resource_type(context: COREWEBVIEW2_WEB_RESOURCE_CONTEXT) -> &'static str {
    match context {
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT => "document",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET => "stylesheet",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE => "image",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA => "media",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT => "font",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT => "script",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST => "xmlhttprequest",
        // adblock-rs không có loại "fetch"; WebView2 cũng gộp fetch vào xhr.
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH => "xmlhttprequest",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET => "websocket",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING => "ping",
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK
        | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE
        | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST
        | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SIGNED_EXCHANGE
        | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT
        | COREWEBVIEW2_WEB_RESOURCE_CONTEXT_OTHER => "other",
        _ => "other",
    }
}
