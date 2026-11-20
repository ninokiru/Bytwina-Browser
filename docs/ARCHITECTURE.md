# Kiến trúc

Bytwina là ứng dụng Tauri 2 trên Windows x64: một tiến trình Rust điều khiển nhiều
WebView2 thật (Edge Chromium), giao diện viết bằng React và dựng bằng Vite.

Những quyết định lớn đều có ADR trong [DECISIONS.md](DECISIONS.md); tài liệu này
chỉ ghép chúng thành bức tranh tổng thể.

## 1. Cửa sổ và webview

```
┌──────────────────────────── cửa sổ Tauri ─────────────────────────────┐
│ webview "toolbar"  (React: tab, địa chỉ, menu, bảng nổi, cài đặt)     │
│   • origin cục bộ, là webview DUY NHẤT được gọi lệnh IPC              │
├───────────────────────────────────────────────────────────────────────┤
│ webview tab-1   webview tab-2   …   (một WebView2 / tab, URL thật)    │
│   • không có quyền IPC; mọi thứ đi qua mạng/COM                       │
└───────────────────────────────────────────────────────────────────────┘
```

- Windows dùng `Window::add_child` (Tauri feature `unstable`) để đặt webview
  native — ADR-001. Không nhúng iframe: iframe không có phiên, không chặn được
  bằng WebResourceRequested, và trang có thể khung-buster.
- Tab dọc/ngang và split đều chỉ là bố trí lại các webview con bằng
  `LogicalPosition`/`LogicalSize`.
- Tab "ngủ" khi rảnh quá `sleepMinutes`: đóng webview và nạp lại URL khi mở — mất
  vị trí cuộn nhưng trả lại RAM cho hệ điều hành.
- Chế độ riêng tư tạo lại webview với profile InPrivate (ADR-012).

## 2. Ranh giới tin cậy

- **Chỉ webview `toolbar` gọi được `browser_command(action, args)`.** Lệnh kiểm
  `webview.label() != "toolbar"` trước khi làm bất cứ việc gì. Capability
  `capabilities/default.json` cũng chỉ gắn cho webview đó.
- Lý do phải kiểm trong mã: build.rs gọi `tauri_build::build()` trần, dự án
  không sinh app manifest, nên ACL của Tauri **không** chặn lệnh tùy biến gọi
  từ origin cục bộ của ứng dụng.
- Trang web (webview tab) không có IPC. Dữ liệu duy nhất chạy từ web về app là
  JSON class/id do bộ lọc thẩm mỹ đọc, và nó bị coi là không đáng tin (sai hình
  dạng → bỏ).
- Điều hướng do toolbar quyết định; trang không tự đổi URL của tab khác
  (ADR-003, ADR-011 cho HTTPS-first).

## 3. Thành phần Rust

| Tệp | Việc |
|---|---|
| `main.rs` | Dựng builder, đăng ký plugin, thời điểm tạo tab, vòng nền 30 giây |
| `browser.rs` | Vòng đời tab: tạo/đóng webview, kích hoạt, bố trí, phiên, popup, sự kiện tải trang |
| `commands.rs` | `browser_command`: bảng `match` duy nhất cho mọi thao tác từ toolbar |
| `tabs.rs` | Trạng thái tab (tiêu đề, URL, ghim, nhóm, đang tải) và phát trạng thái về UI |
| `navigation.rs` | Chuẩn hóa URL, trang nội bộ `bytwina://…`, chặn origin của chính app |
| `filters.rs`, `filters/webview2.rs` | Chặn request bằng adblock-rust qua `WebResourceRequested` (ADR-015) |
| `cosmetic.rs`, `cosmetic/webview2.rs` | Ẩn phần tử bằng CSS sau khi tải trang (M4b) |
| `permissions.rs`, `permissions/webview2.rs` | `PermissionRequested`: hỏi người dùng, nhớ theo origin |
| `passwords.rs` | Kho mật khẩu: Argon2id + AES-256-GCM, khóa chỉ trong RAM |
| `db.rs` | SQLite (rusqlite bundled, ADR-005): lịch sử, dấu trang, đọc, tải xuống, cài đặt, phiên |
| `backup.rs` | `VACUUM INTO` ra bản sao; khôi phục ghi marker, áp dụng lúc mở DB |
| `update.rs` | Hỏi GitHub Releases, xác minh chữ ký minisign, cài NSIS (ADR-010) |
| `diagnostics.rs` | Phiên bản app/webview, đường dẫn dữ liệu cho trang Cài đặt |

**Luồng một thao tác điển hình** (mở địa chỉ): React → `cmd("navigate", {input})`
→ `browser_command` → `navigation::to_url_with` → `tabs` cập nhật trạng thái →
`emit_state` → React vẽ lại. Việc nặng (ghi lịch sử, tra bộ lọc, `VACUUM`) chạy
trong `spawn_blocking`, không giữ luồng UI.

**Luồng chặn quảng cáo:** WebView2 bắn `WebResourceRequested` (luồng UI) → tra
engine đã snapshot khỏi `RwLock` → trả lời chặn/cho qua. Không gọi JS vào trang.

## 4. Frontend

| Tệp | Việc |
|---|---|
| `App.tsx` | Trạng thái toolbar, phím tắt, bảng nổi, sự kiện từ Rust |
| `Panel.tsx` | Menu ⋮, dấu trang, lịch sử, tải xuống, tab, đọc |
| `Settings.tsx` | Cài đặt master–detail + ô tìm kiếm, mỗi mục một `<Section>` |
| `PasswordVault.tsx`, `PermissionPrompt.tsx` | Kho mật khẩu, hộp hỏi quyền |
| `i18n.ts` | Chuỗi Việt/Anh; hai bảng phải cùng bộ khóa |
| `preview.tsx`, `../preview.html` | Chạy giao diện trong trình duyệt thường với IPC giả — dùng để phát triển và để CI chụp ảnh |

Quy ước: mọi lời gọi native đi qua `cmd(action, args)` trong `tabs.ts`; giao diện
không biết tên lệnh Tauri của plugin.

## 5. Dữ liệu trên đĩa

- `app_data_dir/bytwina.db`: SQLite (WAL) — xem `db.rs` cho schema và migration.
- `app_data_dir/filters/`: các tệp `.txt` của danh sách lọc và cache engine.
- `app_data_dir/backups/`: bản sao `VACUUM INTO`.
- `app_data_dir/bytwina.log`: nhật ký xoay vòng 512 KB, không ghi URL.
- WebView2 tự giữ cookie/cache/IndexedDB trong profile của nó; chế độ riêng tư
  dùng profile InPrivate.

## 6. Vòng nền

Một luồng `std::thread` chạy mỗi 30 giây: lưu phiên (bỏ qua khi private, đánh
thức ít), cho tab ngủ, và tự khóa kho mật khẩu theo `vaultAutoLock`. Lỗi trong
một vòng không được phép làm chết luồng.

## 7. Kiểm chứng

CI (`ci.yml`) là bằng chứng duy nhất về biên dịch/test: `fmt --check`,
`clippy -D warnings`, `check/test --all-targets`, `tsc --noEmit` + `vite build`.
Những gì CI **không** chứng minh (hành vi WebView2 thật, cài đặt, cập nhật) ghi
trong [TESTING.md](TESTING.md).
