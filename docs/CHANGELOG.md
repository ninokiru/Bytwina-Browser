# Nhật ký thay đổi

## Chưa phát hành
### Thêm
- Tab: thanh địa chỉ, điều hướng, ghim tab, nhóm tab, tìm tab.
- Dữ liệu: dấu trang, lịch sử, cài đặt, phiên (khôi phục khi mở lại, lưu mỗi 30 giây).
- Tải xuống: danh sách, không ghi đè file.
- Riêng tư: không ghi lịch sử; xóa dữ liệu duyệt web.
- Danh sách đọc.
- Chẩn đoán và nhật ký `bytwina.log`.
- Chặn popup theo danh sách tối thiểu.
- Giao diện mới: thanh công cụ hai hàng, tab dạng viên, omnibox, trạng thái rỗng cho từng bảng, icon SVG thay emoji; theme sáng/tối dùng chung một hệ biến CSS.
- Logo thương hiệu cho giao diện, cửa sổ và bộ cài (ICO 16–256 px, nền thẻ trắng để mark đen rõ trên thanh tác vụ tối).
- `preview.html` + `src/preview.tsx`: xem trước giao diện trong trình duyệt thường bằng IPC giả lập (chỉ dùng khi phát triển).
- Giao diện theo token Chrome (ADR-014): dải tab `#D3E3FD`, tab đang chọn trắng bo hai góc trên 10 px, vách ngăn giữa tab, thanh tiến độ khi đang tải, omnibox pill nở thành ô chữ nhật có viền xanh `#0B57D0` khi gõ; chia lại hai hàng 40 + 56 px.
- Menu `⋮` kiểu Chrome gom lịch sử, danh sách đọc, tải xuống, từ điển, chế độ riêng tư, cài đặt; sao đánh dấu và nút thêm vào danh sách đọc chuyển vào trong ô địa chỉ.
- Chặn quảng cáo (ADR-015, bước chặn mạng): engine `adblock` 0.13, tải EasyList + EasyPrivacy + uBlock Filters/Privacy + ABPVN lúc chạy, cache `.txt` và engine đã serialize trong `app_data/filters`; các lệnh `adblock_status/set/site/update/reload`; mục Cài đặt có bật tắt, số danh sách, số request đã chặn và nút cập nhật. Thay cho danh sách chặn popup cứng trước đây.

### Sửa
- Bảng nổi (dấu trang, lịch sử, cài đặt…) bị cắt vì chỉ cao 96 px: mở bảng thì nới webview toolbar phủ cửa sổ và ẩn webview nội dung, đóng thì trả lại bố cục; bảng không còn bị giới hạn chiều cao.
- Cài đặt chuyển từ style inline sang lớp CSS dùng chung; thêm thông báo trạng thái rỗng, nút xóa nguy hiểm và chẩn đoán dạng bảng.
- Tab mới (＋ hoặc Ctrl+T) được kích hoạt ngay; con trỏ vào ô địa chỉ.
- Đóng tab cuối cùng tự mở tab trống thay vì để cửa sổ rỗng.
- Đóng tab đang hoạt động chọn tab kề theo thứ tự hiển thị (đúng cả khi có tab ghim).
- Phiên làm việc lưu cả trạng thái ghim và tên nhóm; DB bản cũ tự nâng cấp lên schema v2.
- Bật/tắt chế độ riêng tư nạp lại các tab để dùng profile InPrivate, không tiếp tục dùng cookie của profile thường.
- Popup hợp lệ mở thành tab nền (hàng đợi tối đa 16); bỏ cơ chế "giữ Ctrl" vốn không có cách báo từ trang.
- Nhập `localhost:3000` hoặc `host:port` mở đúng URL thay vì tìm kiếm.
- Tìm trong lịch sử chờ 250 ms sau khi ngừng gõ, không truy vấn DB mỗi phím.
- CI: thêm `package-lock.json`, `Cargo.lock`, `.gitignore`; bộ cài NSIS khai báo icon.
- Viền dưới thanh công cụ dùng `border-bottom` nên 1 px bị trừ vào 96 px đã chia, hàng dưới bị cắt; đổi thành `box-shadow inset`.
- Tab ghim 76 px làm nút ghim/đóng tràn khỏi tab và mất vùng bấm; bỏ hiển thị tiêu đề và chấm nhóm tab khi ghim.
- Chủ đề tối: chữ trắng trên nền nút accent xanh nhạt (tương phản ~1.5:1) và núm checkbox trắng; chuyển sang biến `--accent-text`.
- Ô địa chỉ: bấm sao hai lần gọi `bookmark_add` lặp, ghi đè tiêu đề/thư mục đã lưu (lệnh này là UPSERT theo URL); chuyển thành bỏ qua khi đã lưu và thêm `.catch`.
- `preview.tsx` mở bảng không còn dò theo `title` (nút đã đổi chỗ) mà theo thuộc tính `data-panel`, tự mở menu `⋮` trước với bảng nằm trong menu.
- Tối ưu đường nóng (ADR-016, chưa có số đo): `Tab.label` tạo một lần; bố cục/ẩn tab/phóng to dùng `created_labels()` thay vì `snapshot()` sao chép URL + tiêu đề mọi tab; `layout()` tính một lần và bỏ sự kiện resize trùng; vòng 30 giây chỉ gửi trạng thái khi có tab ngủ; bộ chặn bỏ soát tên miền khi không có ngoại lệ và so sánh không cấp phát.
- Bản release bật `strip = true`; thêm feature `alloc-mimalloc` (mặc định tắt) và workflow `benchmarks.yml` chạy micro-probe theo lịch, in số vào Summary để so sánh bộ cấp phát.
- CSDL: `get_setting` đọc từ bộ nhớ cache thay vì mỗi lần lấy khóa connection; tìm lịch sử khi để trống ô tìm kiếm dùng chỉ mục thay vì quét cả bảng; không ghi trùng lịch sử khi reload; vòng tự động lưu phiên bỏ qua khi danh sách tab không đổi; lỗi pragma WAL không còn tắt toàn bộ CSDL.

### Biết trước (chưa sửa)
- Trang http không mã hóa bị chặn (ADR-011).
- Chế độ riêng tư chưa tách dữ liệu hồ sơ trên đĩa (WebView2 dùng chung user data folder).
- Tab dọc, reader mode, cập nhật tự động, ký số: chưa có.
