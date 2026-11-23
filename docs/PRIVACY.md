# Quyền riêng tư: dữ liệu nằm ở đâu, app kết nối tới đâu

Tài liệu này mô tả hành vi **theo mã nguồn hiện tại** (phiên bản 0.0.5). Nếu mã đổi, cập nhật tài liệu cùng lúc. Đây không phải chính sách pháp lý; xem [TERMS.md](TERMS.md) cho điều khoản sử dụng.

## 1. Dữ liệu được lưu trên máy bạn

Tất cả nằm trong thư mục dữ liệu của ứng dụng (Windows: `%APPDATA%\dev.bytwina.browser\`):

| Tệp / thư mục | Nội dung | Ghi chú |
|---|---|---|
| `bytwina.db` | Lịch sử, dấu trang, danh sách đọc, lịch sử tải xuống, phiên tab, cài đặt, quyền trang web đã nhớ, kho mật khẩu | SQLite. Mật khẩu trong kho được mã hóa từng mục (xem mục 3) |
| `bytwina.log` (và `bytwina.log.old`) | Nhật ký lỗi và sự kiện hệ thống | Nhật ký **không** ghi URL hay nội dung trang. Tự xoay vòng khi quá 512 KB |
| `filters\` | Danh sách lọc quảng cáo đã tải và cache `engine.bin` | Tải lại được bất cứ lúc nào |
| `extensions\` | Tài nguyên tiện ích đã cài | Không tự tải/cập nhật; mã chỉ chạy khi bật chế độ preview |
| `workspaces\<tên>\` | Dữ liệu trình duyệt (cookie, đăng nhập, cache) của một workspace | Chỉ có khi bạn đặt workspace; xem mục 4 |
| Thư mục sao lưu | Bản sao lưu CSDL tạo bằng `VACUUM INTO` | Do bạn tạo; xóa được trong màn hình sao lưu |

Thư mục tải xuống là thư mục bạn chọn trong cài đặt (mặc định là thư mục *Downloads* của Windows). Ứng dụng không tự gửi file đã tải đi đâu.

## 2. Chế độ riêng tư và xóa dữ liệu

- **Chế độ riêng tư** (Ctrl+Shift+N): không ghi lịch sử, không ghi phiên tab, không ghi tải xuống; tab mới dùng InPrivate của WebView2 (yêu cầu WebView2 ≥ 101.0.1210.39). Các tab đang mở được tạo lại để áp dụng.
- **Xóa dữ liệu duyệt web**: xóa lịch sử, tải xuống và phiên theo khoảng thời gian (1 giờ, 1 ngày, 1 tuần hoặc tất cả).
- **Xóa khi thoát** (cài đặt `clearOnExit`): yêu cầu WebView2 xóa dữ liệu duyệt web khi đóng. Lệnh này chạy bất đồng bộ và **chưa được kiểm chứng** là hoàn tất trước khi tiến trình thoát.
- **Đặt lại cài đặt**: đưa cài đặt về mặc định nhưng giữ workspace, sự đồng ý điều khoản và ngôn ngữ.

## 3. Kho mật khẩu

- Khóa mã hóa suy ra từ mật khẩu chủ bằng **Argon2id**; mỗi mục được mã hóa bằng **AES-256-GCM**.
- Mật khẩu chủ tối thiểu 8 ký tự. Ứng dụng **không lưu** mật khẩu chủ; chỉ lưu salt và một khối kiểm tra để xác nhận đúng sai.
- Khóa chỉ nằm trong bộ nhớ khi kho đang mở; tự khóa sau số phút bạn cài đặt (mặc định 15 phút). Khi cửa sổ app mất focus, kho bị khóa sau 30 giây nếu chưa focus lại.
- Sau 5 lần nhập sai, app tạm khóa thử lại 30 giây. Bộ đếm này chỉ nằm trong bộ nhớ và đặt lại khi khởi động app.
- **Quên mật khẩu chủ = mất dữ liệu kho.** Không có cách khôi phục. Có thể xóa kho (xóa toàn bộ mục) mà không cần mật khẩu chủ.
- Mục đã mở (hiện mật khẩu) được giải mã tạm trong bộ nhớ; kho chưa có cơ chế xóa bộ nhớ đệm giao diện một cách bảo đảm.

## 4. Workspace (hồ sơ riêng)

Mỗi workspace dùng một thư mục dữ liệu WebView2 riêng, nên cookie và đăng nhập không lẫn giữa các workspace. Cơ chế này **chưa được kiểm chứng trên Windows**; trước khi dựa vào nó để tách hồ sơ công việc/cá nhân, hãy thử với hai tài khoản giả.

## 5. Kết nối mạng của ứng dụng

| Khi nào | Đi tới đâu | Gửi gì |
|---|---|---|
| Khi mở ứng dụng có build updater được ký (mỗi lần khởi động), hoặc khi bạn kiểm tra cập nhật | GitHub Releases (`latest.json` của dự án) | Web request tới endpoint công khai; gửi IP và header mạng thông thường như user agent. Dự án không gắn tài khoản người dùng |
| Khi tải hoặc làm mới danh sách lọc | `easylist.to`, `raw.githubusercontent.com` (uBlock, ABPvn) | Tải các file luật công khai; chỉ phát sinh khi cập nhật danh sách |
| Khi giao diện cần favicon chưa lưu cache | `www.google.com/s2/favicons` | Gửi tên miền để lấy favicon; nội dung favicon được cache cục bộ |
| Khi người dùng cài tiện ích từ URL | Host trong URL do người dùng nhập | Tải gói/manifest đã chọn; không có marketplace chính thức |
| Khi tiện ích được bật ở chế độ preview và được cấp quyền mạng | Host mà mã tiện ích yêu cầu | Request phụ thuộc mã tiện ích và host permissions. Chỉ bật tiện ích bạn tin cậy |
| Khi bạn duyệt web | Máy chủ của trang bạn mở, và các máy chủ mà trang đó tải về | Như mọi trình duyệt: địa chỉ, cookie, tiêu đề trang gửi theo trang |
| WebView2 | Microsoft (cập nhật engine, dịch vụ của Edge) | Theo chính sách của Microsoft; **chưa liệt kê đầy đủ** tại đây |

Ứng dụng không có tài khoản người dùng và không đồng bộ dữ liệu lên đám mây của dự án. Mã nguồn không triển khai telemetry sản phẩm; chưa đo lưu lượng thực tế bằng Process Monitor/Wireshark và WebView2 có thể tự liên lạc với dịch vụ Microsoft theo cấu hình hệ thống.

## 6. Quyền của trang web

Camera, micro, vị trí, thông báo, clipboard, âm thanh tự phát… được hỏi từng lần. Quyết định có thể nhớ theo origin và xem/thu hồi trong cài đặt. Origin được kiểm tra định dạng trước khi lưu.

## 7. Điều chưa làm

- Chưa có cô lập cookie bên thứ ba ở mức API WebView2 (xem [SECURITY.md](SECURITY.md)).
- Chưa mã hóa `bytwina.db` như một tổng thể; chỉ kho mật khẩu được mã hóa.

## 8. Yêu cầu của bạn

Dữ liệu đều nằm trên máy bạn. Để xóa: dùng *Xóa dữ liệu duyệt web* trong app, hoặc xóa thư mục `%APPDATA%\dev.bytwina.browser\` khi ứng dụng đã đóng. Báo lỗi và câu hỏi về quyền riêng tư: xem [SUPPORT.md](SUPPORT.md).
