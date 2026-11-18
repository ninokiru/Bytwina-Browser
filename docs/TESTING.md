# Kiểm thử

## Tự động (đã viết, CHƯA chạy trên máy này)
- `apps/desktop/src-tauri/src/db.rs` (module `tests`): bookmark, lịch sử, cài đặt, phiên, tải xuống, danh sách đọc.
- `navigation.rs`: chuẩn hóa địa chỉ, chặn giao thức nguy hiểm, danh sách chặn popup.
- `browser.rs`: tab, ghim, riêng tư, lịch sử back/forward, giới hạn lịch sử, tên file tải xuống.
- Chạy: `cargo test --all-targets` trong `apps/desktop/src-tauri` (CI đã có bước này).

**Trạng thái:** chưa biên dịch và chưa chạy. CI là nơi duy nhất kiểm tra.

## Thủ công trên Windows (chưa thực hiện)
Đánh dấu [x] khi làm xong và ghi kết quả + phiên bản WebView2.

- [ ] Mở app, 2 tab, chuyển tab, đóng tab, đóng tab cuối (tự mở tab mới).
- [ ] Gõ địa chỉ có/không có `https://`, từ khóa tìm kiếm, `javascript:` (phải bị từ chối).
- [ ] Đổi kích thước cửa sổ: toolbar không bị đè, tab nội dung khớp.
- [ ] Đổi DPI (125%, 150%): nội dung không lệch.
- [ ] Mở 10 tab trong 1 giờ: không crash, RAM không tăng liên tục.
- [ ] Tải một file (PDF, ZIP): có trong panel ⤓, file nằm trong Downloads, không ghi đè file cũ.
- [ ] Lịch sử và dấu trang: thêm, tìm, xóa.
- [ ] Chế độ 🕶: trang mới không vào lịch sử.
- [ ] Xóa dữ liệu duyệt web: lịch sử, tải xuống, phiên đều trống.
- [ ] Đóng app bất thường (kết thúc tiến trình): mở lại, tab được khôi phục (tối đa 30 giây mất).
- [ ] Thiếu WebView2 Runtime: `nova.log` có dòng lỗi rõ ràng.
- [ ] Cài đặt, gỡ cài đặt NSIS: không để lại lỗi; dữ liệu người dùng có/không bị xóa (ghi rõ).
- [ ] Nâng cấp từ bản cũ sang bản mới: CSDL được giữ nguyên.
- [ ] Profile: hai cửa sổ không dùng chung lịch sử riêng tư (hiện CHƯA cô lập cookie; xem SECURITY.md).

## Chưa có
- Kiểm thử nhiều website thật (cần danh sách và quy trình); kiểm thử hồi quy tự động cho UI.
