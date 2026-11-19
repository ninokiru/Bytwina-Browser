# Hiệu năng

**Chưa có số đo nào.** Mọi con số phải lấy từ máy Windows thật bằng `scripts/bench.ps1`.

## Cách đo
1. Đóng các ứng dụng dùng WebView2 khác (Teams, Outlook mới, v.v.).
2. Build bản release và chạy: `pwsh scripts/bench.ps1 -Exe "...\bytwina-browser.exe" -IdleSeconds 30`.
3. Ghi kèm: phiên bản WebView2 (cột `WebView2Runtime`), số tab, cấu hình máy.

## Chỉ số cần đo (theo spec)
Cold/warm startup, RAM khi rảnh, 1/5/10 tab, chuyển tab, CPU nền, chu kỳ mở/đóng lặp lại.
Hiện chỉ có RAM khi rảnh được script hỗ trợ; các chỉ số còn lại chưa có công cụ.

## Đã làm (M6) và chưa làm
- Lưu phiên định kỳ mỗi 30 giây (giảm mất tab khi thoát bất thường).
- Ngủ tab nền: đã có (`settings/sleepMinutes`, đóng webview tab rảnh và nạp lại khi chọn). Mất trạng thái tạm của trang — vị trí cuộn, form chưa gửi.
- Chưa đo: ngưỡng rảnh nào hợp lý, tiết kiệm được bao nhiêu RAM.

## Đã giảm việc phải làm (2026-11-19, chưa có số đo)
Những thay đổi này chỉ làm giảm khối lượng công vụ ở đường nóng; chưa kiểm chứng bằng số:
- `Tab.label` tạo một lần thay vì `format!` mỗi lần đọc trạng thái.
- Bố cục/ẩn tab/phóng to dùng `created_labels()` (chỉ nhãn) thay vì `snapshot()` (clone URL + tiêu đề mọi tab).
- `layout()` tính kích thước vùng nội dung một lần thay vì gọi lại `content_size()` cho từng tab.
- `layout()` bỏ qua sự kiện resize trùng (kéo mép cửa sổ sinh nhiều event có cùng hình học).
- Vòng lặp 30 giây không còn gửi trạng thái cho toolbar khi không có tab nào ngủ.
- Bộ chặn quảng cáo: bỏ qua soát theo tên miền khi chưa tắt chặn ở trang nào, so sánh host không cấp phát.

## Đo trong CI (micro-probe)
`cargo test --release -- --ignored --nocapture` chạy các probe trong `browser.rs` và `filters.rs`:
- `probe_state_read_paths` — chi phí đọc trạng thái khi bố cục (20 tab).
- `probe_should_block_throughput` — chi phí quyết định chặn mỗi request (trúng/không trúng luật).

Workflow `benchmarks.yml` chạy chúng theo lịch và khi bấm tay, xuất kết quả vào Summary của lần chạy.
Runner GitHub là máy chia sẻ nên số chỉ dùng để so sánh giữa các lần chạy, không phải số trên máy người dùng.

## Bộ cấp phát
`cargo build --release --features alloc-mimalloc` đổi sang mimalloc để so sánh. Mặc định tắt vì chưa có số đo,
và phần lớn RAM của trình duyệt nằm ở tiến trình WebView2 chứ không ở phần Rust này.
