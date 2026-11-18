# Bytwina Browser

Trình duyệt desktop cho Windows x64, xây dựng bằng Rust + Tauri 2 + WebView2.

## Trạng thái

- **M1–M5 + một phần M7/M8/M10** (đang hoàn thiện): đa tab WebView2, thanh địa chỉ, SQLite (dấu trang/lịch sử/cài đặt/phiên), tải xuống, riêng tư, tìm tab, danh sách đọc, chẩn đoán.
- Bản thử nghiệm: thiếu tính năng và chưa được kiểm thử thủ công đầy đủ trên Windows. Không dùng bản này để duyệt web thực tế.

## Build

Build chạy trên GitHub Actions (`windows-2025`):

- `ci.yml`: fmt, clippy, check, test, lint/build frontend (tự chạy khi push).
- `build-windows.yml`: tạo bộ cài NSIS (chạy thủ công qua `workflow_dispatch`).
- `release.yml`: đẩy tag `v*.*.*` để tạo bản phát hành nháp kèm bộ cài.

Build cục bộ trên Windows cần: Rust stable (MSVC), Node.js 22, WebView2 Runtime.

## Tài liệu

- `CLAUDE.md`: quy tắc làm việc cho agent.
- `docs/`: kiến trúc, roadmap, quyết định, bảo mật, hiệu năng, kiểm thử, build.
