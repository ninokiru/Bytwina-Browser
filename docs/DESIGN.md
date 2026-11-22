# Thiết kế giao diện Bytwina Browser

Tài liệu này ghi lại token, thành phần, chuyển động, và các quyết định đã chốt so với đề xuất thiết kế ban đầu. Mục nào chưa làm được ghi rõ là "chưa làm", không mô tả như đã có.

Nguyên tắc: cấu trúc theo Chromium (tab, thanh địa chỉ, menu ⋮), vật liệu và chuyển động theo Fluent 2, nhưng chỉ dùng những gì app thực sự có backend.

## 1. Quyết định đã chốt

| Hạng mục | Đề xuất ban đầu | Quyết định đã áp dụng | Tác động |
|---|---|---|---|
| Vật liệu | Mica/Acrylic + backdrop-filter | Nền đặc (solid), không blur. Gỡ `backdrop-filter` khỏi thanh công cụ, tab đang chọn, bảng nổi, gợi ý omnibox | Không đổi kiến trúc |
| Thư viện animation | framer-motion / react-spring | Không dùng thư viện. Gỡ `framer-motion` khỏi `package.json`. Chuyển động bằng CSS `cubic-bezier` | Không thêm phụ thuộc |
| Bố cục Cài đặt | Nhiều card nhóm | Một card mỗi trang, các hàng cách nhau bằng dải phân cách. Giữ sidebar | Không đổi mục lục |
| HTTPS-First | Công tắc bật/tắt | Badge chỉ đọc "Luôn bật (theo điều khoản)" | Xóa điều khiển giả |
| Telemetry | Công tắc báo cáo lỗi | Không có trong onboarding. Chưa có backend | Trung thực |
| Persona | Ảnh hưởng nhiều tính năng | Chỉ tab dọc (Làm việc) và giao diện tối (Giải trí). Học tập và Tùy chỉnh giữ mặc định | Dùng hạ tầng có sẵn |
| Nhập dữ liệu | Dấu trang + lịch sử + mật khẩu | Chỉ dấu trang Chrome, qua `bookmark_import_chrome` | Khớp backend hiện có |

## 2. Token

Nguồn: `src/styles.css` (màu, bo góc, bóng, font) và `src/design.css` (khoảng cách, độ nổi, công tắc, toast, stagger, vật liệu đặc). `design.css` được import sau `styles.css` trong `main.tsx`, để các luật bổ sung thắng khi cùng độ ưu tiên.

| Nhóm | Token | Giá trị |
|---|---|---|
| Nền | `--bg` | `#eaf0f8` sáng · `#0d1117` tối |
| Bề mặt (đặc) | `--surface`, `--surface-2`, `--surface-3` | `#ffffff`, `#f2f6fc`, `#e4ecf7` sáng · `#1c2430`, `#232d3b`, `#2d3a4b` tối |
| Thanh công cụ | `--toolbar` | `#f3f6fb` sáng · `#161c25` tối |
| Viền | `--border`, `--border-strong`, `--divider` | rgba |
| Chữ | `--text`, `--muted`, `--faint` | `#1a1c20` / `#f0f6fc` |
| Accent | `--accent`, `--accent-soft`, `--accent-text` | `#0b57d0` · `#58a6ff` |
| Trạng thái | `--brand` (an toàn), `--danger` | xanh lá · đỏ |
| Khoảng cách | `--space-xxs` … `--space-xxl` | 4, 8, 12, 16, 24, 32, 48 px |
| Bo góc | `--radius-sm/md/lg/full`, `--radius-control` (4), `--radius-overlay` (8) | |
| Độ nổi | `--depth-2/4/8/16` | bóng hai lớp, đậm hơn ở tối |
| Chuyển động | `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |

Font: `"Segoe UI Variable Text", "Segoe UI", system-ui`. Cỡ chữ: 12–13px cho giao diện, 14px cho nội dung onboarding, 24px cho tiêu đề onboarding.

Giao diện sáng/tối: `data-theme` trên `<html>` do `theme.ts` đặt. Chế độ "system" theo `prefers-color-scheme`.

## 3. Thành phần

| Thành phần | Trạng thái | Ghi chú |
|---|---|---|
| Thanh tab, tab dọc/ngang | Đã có | Tab có spring nhẹ khi rê và chọn |
| Omnibox dạng pill, gợi ý, chip ngôi sao/khiên/ghi chú | Đã có | |
| Trang tab mới | Đã có | Ô tìm lớn, quick link từ dấu trang và lịch sử |
| Cài đặt master-detail có tìm kiếm | Đã có | Một card mỗi trang, dải phân cách giữa các hàng |
| Badge HTTPS-First (chỉ đọc) | Đã có | Trong mục Quyền riêng tư |
| Công tắc 44×24 | Đã có (`design.css`) | Nút tròn có spring; áp dụng cho mọi checkbox |
| Toast "Đã lưu" | Đã có | Chỉ hiện khi `save()` trong Cài đặt thành công. Đổi zoom, tab layout, workspace chưa hiện toast |
| Onboarding 5 bước | Đã có | Chào mừng, mục đích, nhập dấu trang Chrome, quyền riêng tư, hoàn tất |
| Danh sách có stagger | Đã có | Áp dụng cho `.list-row` (lịch sử, dấu trang, tab, tải xuống) |

## 4. Chuyển động

- Chỉ animate `transform` và `opacity`.
- Hiệu ứng vào/ra cho card, toast, onboarding: 180–260 ms.
- Stagger danh sách: 35 ms mỗi hàng, tối đa 400 ms.
- Tôn trọng `prefers-reduced-motion`: animation và transition còn ~0.01 ms (`design.css` và cuối `styles.css`).

Chưa xác minh: trên Windows, "Giảm hiệu ứng" có được WebView2 báo về `prefers-reduced-motion` hay không. Cần kiểm tra trên máy thật.

## 5. Chưa làm

| Hạng mục | Lý do |
|---|---|
| Thanh tiến trình "bắn" về 100% | Thanh tiến trình hiện là indeterminate |
| Kiểm tra tương phản WCAG 2.1 AA | Cần đo trên màn hình thật |
| Toast cho zoom, tab layout, workspace | Chỉ `save()` có toast hiện tại |
| Nhập lịch sử và mật khẩu | Chưa có backend |
| Báo cáo lỗi ẩn danh | Chưa có backend |
| Gỡ các phụ thuộc không dùng trong `package.json` | Nhiều gói (dnd-kit, tiptap, tailwind, radix…) được thêm trước đó nhưng chưa dùng. Cần rà soát riêng |

## 6. Kiểm tra trước khi phát hành

- `npm install` (cập nhật `package-lock.json` sau khi gỡ `framer-motion`), rồi `npm run typecheck` và `npm run build`.
- Xem trực tiếp: Cài đặt (sáng/tối), tab mới, onboarding từ đầu (xóa `onboardingDone`), danh sách lịch sử và dấu trang.
- Chọn từng persona để kiểm tra tab dọc và giao diện tối.
- Thử điều hướng bằng bàn phím trong onboarding.
- Bật giảm hiệu ứng của Windows và kiểm tra.

Trạng thái: **chưa được compile hoặc chạy**. Mọi thay đổi giao diện chưa được kiểm tra bằng mắt.
