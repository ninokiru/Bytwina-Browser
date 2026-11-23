# Bytwina Browser extensions

> **Preview:** Tiện ích tắt mặc định trong v1.0. Bật trong trang Tiện ích chỉ
> khi bạn tin cậy mã đã cài. Content script chạy trong main world của website;
> bridge trên `window` không cô lập extension với trang hay extension khác.

## Manifest tối thiểu

```json
{
  "manifest_version": 1,
  "name": "Ví dụ",
  "version": "1.0.0",
  "popup": "popup.html",
  "options_page": "options.html",
  "background": "background.js",
  "permissions": ["storage:own"],
  "optional_permissions": ["tabs:read"],
  "host_permissions": ["https://example.com/*"],
  "content_scripts": [
    { "matches": ["https://example.com/*"], "js": ["content.js"] }
  ]
}
```

Các quyền mặc định là `dom:read`, `storage:own` và `notifications`. Quyền khác phải
được khai báo trong manifest và được người dùng cấp trước khi API hoạt động.

## Cài đặt an toàn

Lệnh inspect trả về `sourceSha256`, là SHA-256 ổn định của toàn bộ file trong gói.
Khi cài đặt, frontend có thể truyền thêm `expectedSha256`; nếu hash không khớp,
Bytwina sẽ từ chối cài đặt. Đây là kiểm tra toàn vẹn, không thay thế chữ ký số.

Gói được giải nén vào thư mục tạm, kiểm tra path traversal/symlink/kích thước rồi
mới đổi tên nguyên tử vào thư mục cài đặt. Cập nhật lỗi sẽ khôi phục bản cũ.
Không cho phép hạ version; bản update phải có version bằng hoặc cao hơn bản đang cài.

## API bridge

Extension gọi API qua `window.__bytwina__`:

- `storage.get`, `storage.set`, `storage.remove`, `storage.clear`
- `tabs.query`
- `notifications.create`
- `native.openUrl`
- `runtime.getPlatformInfo`

Mỗi API đều kiểm tra capability và giới hạn dữ liệu ở Rust. Khi gỡ extension,
quyền và storage của extension cũng được xóa khỏi database.

## Injection engine

`document_start` được đăng ký bằng WebView2 `AddScriptToExecuteOnDocumentCreated`,
nên bridge và script chạy sớm trước mã của trang. `document_end` được inject khi
navigation hoàn tất; `document_idle` dùng `requestIdleCallback` và fallback 500 ms.

Rust lọc `matches`/`exclude_matches` trước khi tạo payload. Mỗi script có khóa
idempotency riêng trong `window.__bytwina_injected`, vì vậy event tải trang lặp lại
không chạy script hoặc chèn CSS hai lần. Các script cuối trang được gom vào một
payload để giảm số lần gọi WebView IPC. Mỗi script vẫn chạy trong IIFE riêng và
lỗi của script được bắt độc lập, không làm hỏng trang hay extension khác.

## Giới hạn WebView2

Trường `background` trong manifest hiện chưa được thực thi. Không có service
worker hay tiến trình nền mô phỏng; content script chỉ sống theo trang/tab.

`popup`/`options_page` không phải cửa sổ native và không hỗ trợ
`browser.action.setPopup`. UI tương ứng phải được hiển thị dưới dạng
**Toolbar Dropdown** do React của toolbar quản lý. Nội dung trang chỉ được dùng
như nguồn cấu hình/trạng thái cho dropdown.

WebView2 không cung cấp persistent background process hay Chrome-style extension
popup trong kiến trúc hiện tại; tài liệu và manifest không được hiểu là đã có hai
tính năng đó.

## Cập nhật

Dùng `ext_inspect_from_url` để lấy manifest và hash trước. Hiển thị thay đổi quyền
cho người dùng, sau đó gọi `ext_install_from_url` với danh sách `grants` và tùy chọn
`expectedSha256`. Bản cập nhật giữ trạng thái bật/tắt và quyền hiện có nếu người
dùng không thu hồi chúng.
