# Thư viện phụ thuộc

Danh sách này lấy từ `apps/desktop/src-tauri/Cargo.toml` và `apps/desktop/package.json`, và chỉ liệt kê các phụ thuộc **trực tiếp** cùng lý do có mặt. Phụ thuộc gián tiếp (hàng trăm crate kéo theo từ Tauri, wry, tokio…) nằm trong `Cargo.lock`.

## Rust (backend)

| Crate | Phiên bản khai báo | Dùng để |
|---|---|---|
| `tauri` | 2 (feature `unstable`) | Vỏ ứng dụng, cửa sổ, nhiều webview con, IPC. `unstable` cần cho `Window::add_child` (ADR-001) |
| `tauri-build` | 2 | Sinh mã/manifest lúc build |
| `serde`, `serde_json` | 1 | Chuyển dữ liệu giữa Rust và giao diện |
| `url` | 2 | Phân tích và kiểm tra URL |
| `tokio` | 1 (`time`) | Chờ không đồng bộ (ví dụ đợi webview tạo xong) |
| `log` | 0.4 | Mức nhật ký |
| `rusqlite` | 0.43 (`bundled`) | SQLite nhúng, không cần cài sẵn |
| `adblock` | 0.13 | Engine chặn quảng cáo/tracker theo cú pháp AdBlock Plus (adblock-rust) |
| `ureq` | 3 | Tải danh sách lọc, HTTP đồng bộ, chạy ở luồng nền |
| `psl` | 2 | Public Suffix List: xác định tên miền gốc để phân biệt bên thứ nhất/thứ ba |
| `argon2` | 0.5 | Suy khóa từ mật khẩu chủ của kho mật khẩu |
| `aes-gcm` | 0.10 | Mã hóa từng mục trong kho mật khẩu |
| `base64` | 0.22 | Lưu salt và khối kiểm tra dạng chữ trong bảng cài đặt |
| `zeroize` | 1 | Xóa khóa và mật khẩu tạm khỏi bộ nhớ |
| `tauri-plugin-autostart` | 2 | Khởi động cùng Windows |
| `tauri-plugin-updater` | 2 | Tự cập nhật, kiểm chữ ký minisign |
| `mimalloc` | 0.1 (tùy chọn) | Bộ cấp phát thay thế, chỉ bật khi đo hiệu năng (feature `alloc-mimalloc`) |
| `webview2-com` | 0.39 (Windows) | Gọi trực tiếp API COM của WebView2 (chặn request, quyền trang, lọc thẩm mỹ) |
| `windows` | 0.62 (Windows) | Kiểu và hằng số Win32/COM |

Ghi chú: `webview2-com` và `windows` phải khớp phiên bản mà Tauri/wry đang dùng, nếu không sẽ có hai bản song song không tương thích (xem comment trong `Cargo.toml`).

## JavaScript / TypeScript (giao diện)

| Gói | Phiên bản khai báo | Dùng để |
|---|---|---|
| `@tauri-apps/api` | ^2 | Gọi IPC và nghe sự kiện từ Rust |
| `react`, `react-dom` | ^18.3.1 | Giao diện thanh công cụ, cài đặt, bảng nổi |
| `@tauri-apps/cli` | ^2 (dev) | Lệnh `tauri build` |
| `vite` | ^6.4.6 (dev) | Build giao diện |
| `@vitejs/plugin-react` | ^4.7.0 (dev) | Hỗ trợ React trong Vite |
| `typescript` | ^5.5.0 (dev) | Kiểm tra kiểu (`npm run typecheck`) |
| `@types/react`, `@types/react-dom` | ^18.3.0 (dev) | Kiểu cho React |

## Giấy phép của phụ thuộc

Chưa có bảng giấy phép tự động cho toàn bộ cây phụ thuộc. Trước khi phát hành bản công khai, nên sinh bảng bằng công cụ như `cargo-about`, `cargo-deny` hoặc `license-checker` và đưa vào `third_party/`. Riêng **danh sách lọc** không nằm trong repo mà tải lúc chạy; mỗi danh sách giữ giấy phép riêng của nguồn (EasyList, uBlock Origin, ABPvn), và cần đối chiếu trước khi phân phối lại. Xem [third_party/LICENSES.md](../third_party/LICENSES.md).

## Cập nhật phụ thuộc

- Không nâng `webview2-com`/`windows` đơn lẻ; nâng cùng Tauri để giữ khớp.
- Workflow `security.yml` là nơi kiểm tra bảo mật tự động; đọc nội dung workflow để biết công cụ nào đang chạy trước khi tin vào kết quả của nó.
- Mọi thay đổi phụ thuộc phải kèm ghi chú trong [CHANGELOG.md](CHANGELOG.md).

*Tài liệu này chỉ mô tả phụ thuộc theo file cấu hình; chưa kiểm chứng biên dịch trong phiên làm việc này.*
