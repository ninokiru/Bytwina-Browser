# Bảo mật — giới hạn đã biết

- Chế độ riêng tư: khi bật, các tab được nạp lại bằng profile InPrivate của WebView2 nên không dùng chung cookie với profile thường; vẫn chưa tách user data folder trên đĩa. Xem ADR-012.
- Popup: cửa sổ mới luôn bị chặn; URL hợp lệ mở thành tab nền (tối đa 16 mục trong hàng đợi). Danh sách tên miền chặn tối thiểu trong `navigation.rs` — không phải filter list được bảo trì và không chặn tài nguyên trong trang.
- Thư mục tải xuống: file được đặt trong thư mục Downloads của người dùng; file thực thi/script bị đổi đuôi `.download` (chưa quét nội dung).
- Trang http không mã hóa (trừ localhost) bị chặn theo HTTPS-first (ADR-011). Chưa có cách cho phép thủ công từng trang.
- Lệnh IPC chỉ nhận lời gọi từ webview có nhãn `toolbar`. Trước đây điều này dựa vào `capabilities/default.json`, nhưng Tauri **bỏ qua kiểm tra ACL** với lệnh tùy biến khi origin gọi là cục bộ và dự án không sinh app manifest (`build.rs` gọi `tauri_build::build()` trần) — nên từ bản này `browser_command` tự chặn theo nhãn webview gọi tới (`commands.rs`).
- Liên kết tới origin của chính ứng dụng (`*.tauri.localhost`, `ipc.localhost`) bị chặn ở cả hai lớp: ô địa chỉ coi là tìm kiếm, và `page_navigation_allowed` từ chối trong tab. Lý do: ở origin đó, nội dung web rơi vào vùng Tauri coi là "cục bộ" và gọi được mọi lệnh IPC, gồm cả kho mật khẩu.

## Ghi chú gắn URL và phiên lưu có tên

- Nội dung ghi chú (`page_notes`) và danh sách tab của phiên lưu (`saved_sessions`) nằm **chữ rõ** trong SQLite, giống lịch sử và dấu trang. Không đặt mật khẩu hay thông tin nhạy cảm vào ghi chú nếu máy có người khác dùng chung.
- Markdown chỉ được parse và làm sạch phía Rust (`pulldown-cmark` + `ammonia`) trước khi hiển thị; frontend không dùng `eval` và không tự render Markdown.
- Ghi chú không tự gửi đi đâu; xuất `.md` chỉ tạo tệp tải xuống cục bộ.

## Kho mật khẩu (M11)

- Mật khẩu chủ không được lưu ở bất kỳ đâu. Khi tạo kho, ứng dụng sinh salt ngẫu nhiên 16 byte, suy khóa 32 byte bằng Argon2id (19 MiB, 2 vòng, song song 1) rồi lưu **salt** và một **bản mã kiểm tra** dạng base64 trong bảng `settings` để lần sau biết nhập đúng hay sai.
- Mỗi mục mật khẩu được mã hóa AES-256-GCM với nonce ngẫu nhiên 12 byte; mật khẩu và ghi chú nằm trong cột `secret` dạng `nonce || bản mã`. Sửa mục sẽ dùng nonce mới.
- Khóa chỉ tồn tại trong bộ nhớ tiến trình khi kho đang mở; thoát ứng dụng là mất. Có thể khóa tay hoặc tự khóa sau 1–60 phút không thao tác.
- Xóa toàn bộ kho không cần mật khẩu chủ để người quên vẫn thoát được trạng thái khóa; thao tác này xóa mọi bản mã và salt/check, không làm lộ dữ liệu.
- Tiêu đề, URL và tên đăng nhập vẫn là chữ rõ trong SQLite để tìm kiếm. Bản thân tệp SQLite chưa được mã hóa; ai đọc được tệp vẫn thấy các trường này và số lượng mục.
- Chưa có tự động điền hoặc tự bắt mật khẩu từ trang web: người dùng phải thêm/sửa/xem/sao chép thủ công. Chưa kiểm chứng runtime trên Windows.
- Chưa có giới hạn số lần thử mật khẩu chủ trong một phiên; Argon2id làm mỗi lần thử tốn thời gian và RAM nhưng không chặn dò ngoại tuyến nếu kẻ tấn công lấy được tệp CSDL.

## Hệ tiện ích (v1)

- Tiện ích chỉ được cài từ **thư mục hoặc tệp .zip** do người dùng chọn; không có marketplace, không tự tải mã từ mạng, không có chữ ký số. Chỉ cài tiện ích bạn tin cậy.
- Đường dẫn trong manifest bị giới hạn ở dạng tương đối (không `..`, không ổ đĩa tuyệt đối). Zip được kiểm tra zip-slip, số tệp, kích thước từng tệp và tổng dung lượng trước khi giải nén; symlink trong thư mục nguồn bị từ chối.
- Mỗi tiện ích có tối đa 5 MB storage riêng trong bảng `ext_storage`; gỡ tiện ích xóa luôn storage và quyền trong cùng giao dịch.
- Quyền nằm trong manifest và được người dùng duyệt lúc cài: `dom:read`, `dom:write`, `storage:own`, `network:restricted`, `network:unrestricted`, `notifications`, `tabs:read`, `tabs:navigate`, `ui:inject`. Quyền mặc định (`dom:read`, `storage:own`, `notifications`) không thể thu hồi.
- Mọi lời gọi storage/tabs/network đều quay về Rust qua WebView2 WebMessage và được kiểm tra lại token ngẫu nhiên, quyền, URL nguồn, hạn mức gọi mỗi giây và hạn mức dữ liệu. JavaScript trong trang không gọi được IPC của Tauri.
- `network:*` chỉ cho http/https, chặn localhost, mạng nội bộ và địa chỉ IP riêng; không tự đi theo redirect. `network:restricted` chỉ được gọi host khớp `host_permissions`.
- **Giới hạn quan trọng:** content script chạy trong **main world** của trang (WebView2 không cho Tauri tạo isolated world), nên script của trang có thể tương tác với đối tượng bridge và gọi API của tiện ích trong phạm vi trang đó. Token không lộ ra biến toàn cục, nhưng trang khớp mẫu vẫn có thể hành động thay tiện ích. Chưa có background script, popup, options page, clipboard hay native API; chưa có cơ chế cập nhật.
- Việc bật/tắt/đổi quyền tải lại các tab đang mở để nạp lại script `document_start`; trạng thái trang (vị trí cuộn, form) sẽ mất.

## Trạng thái các biện pháp bảo mật (M15)

| Biện pháp | Trạng thái |
|---|---|
| IPC chỉ cho webview `toolbar` (capabilities) | Đã cấu hình |
| Trang web không có quyền gọi lệnh Tauri | Đã cấu hình (không có capability cho nội dung) |
| Chặn giao thức nguy hiểm (javascript:, file:, data:) khi nhập địa chỉ | Đã có, có test |
| Điều hướng trong trang theo chính sách HTTPS-first | Đã có, có test (ADR-011) |
| Chặn popup theo danh sách tối thiểu | Đã có, có test; popup hợp lệ mở tab nền |
| File thực thi/script tải về đổi đuôi `.download` | Đã có, có test |
| Chế độ riêng tư dùng profile InPrivate khi tab được tạo lại | Đã có (ADR-012) |
| Xóa lịch sử theo tên miền | Đã có, có test (khớp đúng tên miền, không khớp tên miền con) |
| Không có telemetry / gửi dữ liệu ra ngoài | Đã kiểm tra mã: không có mã mạng trong app |
| Điều khoản và quyền riêng tư khi mở lần đầu | Đã có (bản nháp) |
| Chính sách quyền site (camera, micro, vị trí…) | Đã có mã: bảng hỏi trong trang, nhớ lựa chọn theo origin, xem/xóa trong Cài đặt (chưa kiểm chứng runtime) |
| HTTPS-first | Một phần: chặn http trang khác; chưa nâng cấp tự động link trong trang |
| Chặn tài nguyên quảng cáo/tracker trong trang | CHƯA làm: cần WebResourceRequested |
| Cô lập cookie theo hồ sơ | Một phần: chế độ riêng tư tạo lại webview bằng InPrivate; chưa tách user data folder |
| Mã hóa dữ liệu cục bộ (SQLite) | Một phần: kho mật khẩu mã hóa AES-256-GCM; các bảng khác (lịch sử, dấu trang, phiên, ghi chú) vẫn chữ rõ |
| Kiểm tra lừa đảo qua nguồn đáng tin cậy | CHƯA làm: cần dịch vụ bên ngoài |
| Cập nhật bảo mật | Quét phụ thuộc định kỳ (security.yml); cập nhật tự động chưa kích hoạt |
| Content Security Policy cho giao diện | CHƯA bật: cần kiểm thử IPC trước vì sai CSP sẽ làm hỏng toolbar |
