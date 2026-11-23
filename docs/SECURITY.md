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

- Mật khẩu chủ không được lưu ở bất kỳ đâu. Khi tạo kho, ứng dụng sinh salt ngẫu nhiên 16 byte, suy khóa 32 byte bằng Argon2id (64 MiB, 3 vòng, song song 4) rồi lưu **salt** và một **bản mã kiểm tra** dạng base64 trong bảng `settings` để lần sau biết nhập đúng hay sai.
- Mỗi mục mật khẩu được mã hóa AES-256-GCM với nonce ngẫu nhiên 12 byte; mật khẩu và ghi chú nằm trong cột `secret` dạng `nonce || bản mã`. Sửa mục sẽ dùng nonce mới.
- Khóa chỉ tồn tại trong bộ nhớ tiến trình khi kho đang mở; thoát ứng dụng là mất. Có thể khóa tay hoặc tự khóa theo thời gian không thao tác; mặc định 15 phút. Khi cửa sổ app mất focus, vault bị khóa sau 30 giây nếu cửa sổ chưa được focus lại.
- Xóa toàn bộ kho không cần mật khẩu chủ để người quên vẫn thoát được trạng thái khóa; thao tác này xóa mọi bản mã và salt/check, không làm lộ dữ liệu.
- Tiêu đề, URL và tên đăng nhập vẫn là chữ rõ trong SQLite để tìm kiếm. Bản thân tệp SQLite chưa được mã hóa; ai đọc được tệp vẫn thấy các trường này và số lượng mục.
- Chưa có tự động điền hoặc tự bắt mật khẩu từ trang web: người dùng phải thêm/sửa/xem/sao chép thủ công. Chưa kiểm chứng runtime trên Windows.
- Sau 5 lần mở khóa sai liên tiếp, app áp dụng cooldown 30 giây trong bộ nhớ. Bộ đếm reset khi app khởi động lại; cơ chế này không chặn dò ngoại tuyến nếu kẻ tấn công lấy được tệp CSDL.

## Hệ tiện ích (preview, tắt mặc định trong v1.0)

- Tiện ích chỉ chạy khi người dùng bật **Chế độ xem trước**. Mặc định tắt; khi tắt, registry không nạp script, WebView không đăng ký bridge và protocol không phục vụ asset tiện ích.
- Có thể cài từ thư mục, zip hoặc URL do người dùng nhập; không có marketplace hay chữ ký số. Chỉ cài tiện ích bạn tin cậy.
- Đường dẫn trong manifest bị giới hạn ở dạng tương đối (không `..`, không ổ đĩa tuyệt đối). Zip được kiểm tra zip-slip, số tệp, kích thước từng tệp và tổng dung lượng trước khi giải nén; symlink trong thư mục nguồn bị từ chối.
- Mỗi tiện ích có tối đa 5 MB storage riêng trong bảng `ext_storage`; gỡ tiện ích xóa luôn storage và quyền trong cùng giao dịch.
- Quyền nằm trong manifest và được người dùng duyệt lúc cài: `dom:read`, `dom:write`, `storage:own`, `network:restricted`, `network:unrestricted`, `notifications`, `tabs:read`, `tabs:navigate`, `ui:inject`. Quyền mặc định (`dom:read`, `storage:own`, `notifications`) không thể thu hồi.
- Mọi lời gọi storage/tabs/network đều quay về Rust qua WebView2 WebMessage và được kiểm tra token, quyền, URL nguồn, hạn mức gọi và hạn mức dữ liệu. JavaScript trong trang không gọi trực tiếp lệnh IPC Tauri.
- `network:*` chỉ cho http/https, chặn localhost, mạng nội bộ và địa chỉ IP riêng; không tự đi theo redirect. `network:restricted` chỉ được gọi host khớp `host_permissions`.
- **Giới hạn quan trọng:** content script chạy trong **main world** của trang. Bridge hiện đặt trên `window` và có `get(id)`; vì vậy các tiện ích khớp cùng trang không được cô lập đáng tin cậy, và mã trang có thể tương tác với bridge. Đây là tính năng preview, không nên dùng với tiện ích không tin cậy. Chưa có background script, popup hay options page kiểu Chrome; không có tiến trình chạy nền bền vững.
- Việc bật/tắt/đổi quyền tải lại các tab đang mở để nạp lại script `document_start`; trạng thái trang (vị trí cuộn, form) sẽ mất.

## Trạng thái các biện pháp bảo mật (M15)

| Biện pháp | Trạng thái trong mã / mức xác minh |
|---|---|
| Lệnh `browser_command` chỉ nhận webview `toolbar` | Có kiểm tra nhãn ở `commands.rs`; chưa xác minh runtime bằng tấn công web |
| CSP cho giao diện ứng dụng | Có trong `tauri.conf.json`; chưa chạy UI để xác minh mọi luồng hoạt động |
| Chặn tài nguyên quảng cáo/tracker | Có `WebResourceRequested` hook trong `filters/webview2.rs`; hiệu quả phụ thuộc danh sách lọc và chưa đo trên runtime |
| Cooldown mở kho mật khẩu | Có cooldown trong tiến trình sau nhiều lần sai; reset khi app khởi động lại |
| Cập nhật bảo mật | Updater chỉ hoạt động khi build có khóa công khai và manifest/chữ ký hợp lệ; chưa xác nhận mọi bản phát hành đã ký |
| Kết nối mạng | Có updater, tải danh sách lọc, tải favicon và tải nguồn tiện ích theo yêu cầu người dùng; xem `PRIVACY.md` |
| Dữ liệu SQLite | Chưa mã hóa toàn bộ DB; các bảng ngoài vault vẫn có thể chứa dữ liệu chữ rõ |
| Khóa tiện ích mặc định | Tắt mặc định; khi bật preview, bridge main-world chưa cô lập extension với nhau hoặc với trang |
