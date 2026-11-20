# Góp ý và gửi thay đổi

## Trước khi viết mã

- Dự án một người, phạm vi hẹp. Thay đổi lớn (đổi kiến trúc, thay thư viện nền,
  thêm plugin Tauri) nên mở issue trước để tránh làm xong lại bỏ.
- Đọc [docs/DECISIONS.md](docs/DECISIONS.md): nếu đề xuất của bạn trái một ADR,
  nói rõ ADR nào và vì sao nên đổi.

## Ngôn ngữ

- Trao đổi, commit, tài liệu: **tiếng Việt**. Định danh trong mã: **tiếng Anh**.
- Chuỗi giao diện: thêm vào cả hai bảng Việt và Anh trong
  `apps/desktop/src/i18n.ts`, cùng bộ khóa.

## Mã

- Rust: `cargo fmt --all` trước khi commit; `cargo clippy --all-targets -- -D warnings`
  phải sạch. CI coi cảnh báo là lỗi.
- Không thêm phụ thuộc khi chưa dùng thật. Crate đã có trong `Cargo.lock` qua
  chuỗi phụ thuộc thì khai báo trực tiếp được; crate mới phải có lý do trong
  `Cargo.toml`.
- Lệnh mới từ giao diện: thêm một nhánh trong `browser_command` của `commands.rs`,
  và nhớ rằng chỉ webview `toolbar` gọi được — đừng thêm đường gọi từ tab.
- Không chèn JS có đặc quyền vào trang remote. Nếu tính năng "cần" điều đó
  (Reader Mode chẳng hạn), viết rõ trong issue trước.
- Ghi chú trong mã chỉ giữ khi giải thích **vì sao** (ràng buộc ẩn, bẫy đã gặp),
  không mô tả lại điều tên hàm đã nói.

## Kiểm thử

- Thêm test cho mọi logic không phụ thuộc WebView2 (chuẩn hóa URL, bộ chặn,
  kho mật khẩu, sao lưu, cài đặt).
- Test tạo thư mục tạm phải dùng tên duy nhất theo tiến trình/đếm, vì các test
  chạy song song trong cùng tiến trình.
- Đừng săn lỗi bằng cách thêm `#[test] #[ignore]` rồi quên: test bỏ qua phải nêu
  rõ nó đo gì và khi nào chạy lại.

## Commit

- Một commit một việc; tiêu đề theo dạng `lĩnh vực: việc đã làm` (ví dụ
  `fix(m4b): …`, `docs: …`, `M14: …`).
- Trong phần thân, nói **vì sao** đổi và bằng chứng (lỗi CI, số đo, test nào).
- Không commit khoá riêng tư, `.env`, tệp dữ liệu người dùng.

## Báo lỗi

Xem [docs/SUPPORT.md](docs/SUPPORT.md). Lỗi bảo mật: **không** mở issue công
khai, làm theo [docs/SECURITY.md](docs/SECURITY.md).
