# Nova Browser (Bytwina Browser)

Trình duyệt desktop cho Windows x64, xây dựng bằng Rust + Tauri 2 + WebView2.

## Trạng thái

- **M0 — Nền tảng kỹ thuật** (đang làm): khung dự án, CI, prototype đa WebView.
- Chưa có tính năng trình duyệt hoàn chỉnh. Không dùng bản này để duyệt web thực tế.

## Build

Build chạy trên GitHub Actions (`windows-2025`):

- `ci.yml`: typecheck/build frontend, rồi fmt, clippy, check, test Rust (tự chạy khi push).
- `build-windows.yml`: tạo bộ cài NSIS (chạy thủ công qua `workflow_dispatch`).

Build cục bộ trên Windows cần: Rust stable (MSVC), Node.js 22, WebView2 Runtime.

## Tài liệu

- `CLAUDE.md`: quy tắc làm việc cho agent.
- `docs/`: quyết định kiến trúc, lộ trình.
