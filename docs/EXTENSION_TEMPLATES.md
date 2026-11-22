# Extension templates

Bytwina có kho template nội bộ trong trang Tiện ích. Người dùng có thể cài bằng một nút, template luôn ở trạng thái tắt để kiểm tra trước.

Các template mẫu hiện có:

- **Focus mode**: ẩn sidebar và khu vực đề xuất.
- **Reading mode**: tăng độ rộng đọc, line-height và giới hạn chiều rộng bài viết.

Template từ xa trong tương lai phải đi kèm `expectedSha256` và chữ ký/phê duyệt danh sách. Không tải và chạy JavaScript từ nguồn không xác thực.

## Ranh giới nền tảng

Matcher, manifest, bridge, capability và payload injection nằm ở lớp dùng chung. Adapter WebView2 chỉ phụ trách document-start, eval payload và WebMessage. Khi port sang Linux/Mac, chỉ cần thay adapter này; không cần viết lại SQLite, UI hoặc lifecycle extension.
