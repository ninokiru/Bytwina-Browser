# Hỗ trợ và báo lỗi

## Kênh

- **Báo lỗi / đề nghị tính năng:** [GitHub Issues](https://github.com/ninokiru/Bytwina-Browser/issues).
- **Lỗi bảo mật:** KHÔNG mở issue công khai; xem [SECURITY.md](SECURITY.md).

Trước khi mở issue, chạy bản mới nhất trong [Releases](https://github.com/ninokiru/Bytwina-Browser/releases/latest) — lỗi về cài đặt hoặc cập nhật thường đã được sửa ở bản sau.

## Issue cần có gì

1. **Phiên bản:** Cài đặt ⚙ → "Chẩn đoán", chép phiên bản app và WebView2 (và Windows).
2. **Các bước tái hiện:** làm gì, trang nào (URL), thấy gì, mong đợi gì.
3. **Nhật ký:** `bytwina.log` trong thư mục dữ liệu ứng dụng (`%APPDATA%\dev.bytwina.browser\`), chỉ phần có lỗi. Nhật ký không ghi URL, nhưng nên đọc qua trước khi gửi.
4. **Ảnh chụp** nếu là lỗi giao diện.

Không gửi `bytwina.db` (chứa lịch sử, dấu trang) và không gửi kho mật khẩu.

## Môi trường được hỗ trợ

| | Được hỗ trợ |
|---|---|
| Windows | 10/11 x64, có WebView2 Runtime |
| Kiến trúc | x86_64 (không có bản ARM) |
| Ngôn ngữ UI | Tiếng Việt, English |
| Cài đặt | Bộ cài NSIS, cài cho người dùng hiện tại |

Không hỗ trợ: Windows 7/8, máy không có WebView2, chạy bản portable từ thư mục chỉ đọc.

## Những lỗi đã biết (tính đến 0.0.4)

- SmartScreen cảnh báo khi cài vì bộ cài chưa ký số.
- Luật chặn phần tử **chung** (`.advert` không kèm tên miền) chưa khớp; luật theo tên miền vẫn chạy.
- Tự cập nhật chỉ hoạt động khi bản phát hành được ký (xem [RELEASE.md](RELEASE.md)); nếu thiếu, menu báo không kiểm tra được.
- Reader Mode, in/PDF, tự động điền mật khẩu, nhiều hồ sơ: chưa có.

## Thời gian phản hồi

Dự án một người làm, không có SLA. Issue được đọc, nhưng có thể mất vài ngày mới có phản hồi.
