# Hiệu năng

**Chưa có số đo nào.** Mọi con số phải lấy từ máy Windows thật bằng `scripts/bench.ps1`.

## Cách đo
1. Đóng các ứng dụng dùng WebView2 khác (Teams, Outlook mới, v.v.).
2. Build bản release và chạy: `pwsh scripts/bench.ps1 -Exe "...\nova-browser.exe" -IdleSeconds 30`.
3. Ghi kèm: phiên bản WebView2 (cột `WebView2Runtime`), số tab, cấu hình máy.

## Chỉ số cần đo (theo spec)
Cold/warm startup, RAM khi rảnh, 1/5/10 tab, chuyển tab, CPU nền, chu kỳ mở/đóng lặp lại.
Hiện chỉ có RAM khi rảnh được script hỗ trợ; các chỉ số còn lại chưa có công cụ.

## Đã làm (M6) và chưa làm
- Lưu phiên định kỳ mỗi 30 giây (giảm mất tab khi thoát bất thường).
- Chưa làm: ngủ tab nền (suspend). Cần đo trước để tránh mất trạng thái trang.
