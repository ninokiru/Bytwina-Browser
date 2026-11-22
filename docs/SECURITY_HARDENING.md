# Security hardening

## Dữ liệu và mã hóa

- Kho mật khẩu dùng Argon2id để suy khóa và AES-256-GCM cho từng bản ghi.
- Khóa và mật khẩu tạm thời được zeroize khi không còn dùng.
- Mở khóa sai 5 lần trong một phiên sẽ bị cooldown 30 giây.
- SQLite, lịch sử, bookmark và extension source chưa phải là database mã hóa toàn bộ. Không nên coi thư mục dữ liệu app là nơi an toàn nếu máy đã bị chiếm quyền; bật BitLocker/Windows Device Encryption để bảo vệ dữ liệu khi ổ đĩa bị tháo.

## Bản phát hành

- Release dùng `panic = "abort"`, không chứa debug symbols và bật overflow checks.
- Updater phải giữ minisign public key trong release config; không phát hành bản production với `pubkey` rỗng.
- Extension tải từ xa phải kiểm tra SHA-256 và chỉ cài sau khi người dùng duyệt quyền.

## Giới hạn

Không có cách đáng tin cậy để giấu hoàn toàn mã Rust/React trong ứng dụng desktop. Mục tiêu là bảo vệ secret, dữ liệu người dùng, IPC, updater và tính toàn vẹn bản phát hành; không dựa vào obfuscation để bảo vệ khóa.
