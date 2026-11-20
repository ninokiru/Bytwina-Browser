# Giấy phép của thành phần bên thứ ba

Mã nguồn Bytwina Browser theo MIT (`../LICENSE`). Dưới đây là các thành phần khác đi kèm hoặc được tải lúc chạy.

## Thư viện (Cargo / npm)

Giấy phép của từng crate và gói npm theo chính chúng công bố; danh sách đầy đủ nằm ở `apps/desktop/src-tauri/Cargo.lock` và `apps/desktop/package-lock.json`.

Thành phần có đóng góp chính:

| Thành phần | Giấy phép | Dùng cho |
|---|---|---|
| Tauri 2, tauri-plugin-updater, tauri-plugin-autostart, wry (Tauri Programme) | MIT hoặc Apache-2.0 | Khung ứng dụng, webview, tự cập nhật |
| webview2-com, windows (Microsoft) | MIT | Liên kết COM với WebView2 |
| adblock-rust (Brave) | MPL-2.0 | Bộ chặn quảng cáo |
| rusqlite, SQLite | MIT (rusqlite); SQLite public domain | Cơ sở dữ liệu |
| argon2, aes-gcm, zeroize (RustCrypto) | MIT hoặc Apache-2.0 | Kho mật khẩu |
| psl | MIT hoặc Apache-2.0 | Đăng ký domain theo Public Suffix List |
| React, React DOM | MIT | Giao diện |
| Vite | MIT | Dựng frontend (chỉ lúc build) |

## WebView2 Runtime

Do Microsoft cung cấp và phân phối theo **Microsoft Software License Terms**. Bytwina không đóng gói runtime; app dùng bản đã có trên máy hoặc bản cài do Microsoft phát hành.

## Danh sách lọc quảng cáo (tải lúc chạy, không nằm trong repo)

| Danh sách | Nguồn | Giấy phép |
|---|---|---|
| EasyList, EasyPrivacy | https://easylist.to | **CC BY-SA 3.0** (theo giấy phép của EasyList, trích dẫn + chia sẻ tương tự) |
| uBlock filters, uBlock Privacy | https://github.com/uBlockOrigin/uAssets | **GPL-3.0** |
| ABPvn | https://github.com/abpvn/abpvn | **GPL-3.0** |

Bytwina **không** nhúng nội dung các danh sách này vào bản cài, không biên dịch thành mã, không bán lại. App tải bản gốc tại thời gian chạy để người dùng chặn quảng cáo, và giữ nguyên tệp trên máy. Vì vậy mã của Bytwina vẫn là MIT; các danh sách thuộc giấy phép ở trên.

Nếu bạn phân phối lại bản cài kèm danh sách lọc đã tải sẵn, bạn phải tuân theo giấy phép của từng danh sách.

## Tài liệu và hình ảnh

- `apps/desktop/public/brand-mark.png`: biểu trưng của Bytwina, © 2026 Lumina, cùng giấy phép MIT.
- Ảnh trong `docs/screenshots/` là ảnh chụp giao diện do CI tạo ra từ mã nguồn, cùng giấy phép MIT.
