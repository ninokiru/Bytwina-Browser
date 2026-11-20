# Nhật ký thay đổi

## 0.0.4 — 2026-11-20
### Thêm
- Kho mật khẩu cục bộ (M11): mật khẩu chủ suy khóa Argon2id (19 MiB, 2 vòng, salt 16 byte), từng mục mã hóa AES-256-GCM; thêm/sửa/xóa/tìm, hiện và sao chép mật khẩu, tự khóa sau 1–60 phút hoặc khóa tay, xóa toàn bộ kho khi quên mật khẩu chủ. Không lưu mật khẩu chủ; khóa chỉ nằm trong RAM phiên chạy. Chưa tự động điền hoặc bắt mật khẩu từ trang web.
- Cài đặt: mục "Quyền trang web" riêng, liệt kê quyền đã lưu theo trang và cho xóa từng trang.
- Cài đặt: xóa lịch sử và danh sách tải xuống theo khoảng thời gian (1 giờ / 24 giờ / 7 ngày / toàn bộ) như chrome://settings/clearBrowserData. Chỉ "toàn bộ" mới quên danh sách tab của phiên, để trang vừa xóa không tự mở lại.
- Cài đặt là master–detail như Cốc Cốc/Chrome: mục lục chọn một trang để hiện (không còn một trang cuộn dài + nhảy neo), thêm ô "Tìm kiếm trong Cài đặt" lọc theo nhãn đã dịch hoặc từ khóa, bỏ dấu tiếng Việt nên gõ "mat khau" vẫn khớp "mật khẩu".
- Menu ⋮ theo mẫu Cốc Cốc: nhãn phím tắt cột phải (Ctrl+T, Ctrl+H, Ctrl+J, Ctrl+D, Ctrl+Shift+O, Ctrl+Shift+N, Ctrl+Shift+Del, Ctrl+Q), hàng thu phóng − 100% +, hàng hồ sơ ("Hồ sơ khách" — nói thẳng chưa có tài khoản thay vì giả đã đăng nhập), hàng chuyển tab dọc/ngang và thoát. Các hàng đều gọi lệnh có thật; chưa có hàng "Tiện ích mở rộng" hay "In trang" vì backend chưa có.
- Trang tab mới: logo, lời chào theo giờ, ô tìm kiếm lớn bo tròn, lưới quick link lấy từ dấu trang rồi bù bằng lịch sử, gợi ý tìm kiếm khi chưa có dữ liệu, dòng ghi chú riêng tư. Trang nằm trong webview toolbar nên không cần thay đổi Rust.
- Thanh địa chỉ: pill cố định 34 px, hover đổi nền, focus bằng vòng accent — không còn co giãn chiều cao khi bấm vào.
### Thay đổi
- Công cụ tìm kiếm chuyển hẳn vào Cài đặt dưới dạng danh sách radio kèm mô tả như Chrome; trang tab mới không còn bộ chọn engine.
- Tab dọc: tab đang chọn có vạch accent 3 px bên trái; nút ghim chỉ hiện khi rê tab để tab đang chọn không bị hai nút chiếm chỗ.
- Menu ⋮ thu về 320 px như menu trình duyệt; bảng danh sách giữ 430 px.
- Ô địa chỉ để trống khi ở tab mới thay vì hiện `about:blank`.
- Tôn trọng thiết lập giảm chuyển động của Windows (`prefers-reduced-motion`).

## 0.0.3 — 2026-11-19
### Thêm
- Tab dọc: mục Cài đặt "Bố cục tab và workspace" chuyển thanh công cụ thành cột trái 260 px, tab và thanh địa chỉ xếp dọc, nội dung dịch sang phải.
- Chia màn hình: hai tab cạnh nhau, có khe 4 px; mở bằng nút chia trên thanh công cụ (chọn ô phải trong danh sách tab) hoặc nút chia ở từng hàng tab. Bấm tab đang ở ô phải để hoán đổi hai ô.
- Workspace: thư mục dữ liệu WebView2 riêng theo tên workspace (`WebviewBuilder::data_directory`), tên chỉ gồm chữ, số, `-`, `_` (tối đa 24 ký tự). Đổi workspace tải lại tab đang mở. Chưa kiểm chứng runtime trên Windows.

## 0.0.2 — 2026-11-19
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

- Trang Cài đặt chiếm toàn bộ vùng dưới thanh công cụ, có mục lục bên trái (Chung, Giao diện, Chặn quảng cáo, Quyền riêng tư, Tải xuống, Giới thiệu) và cuộn tới từng nhóm, thay cho thẻ nổi 430 px.
- Cài đặt: công cụ tìm kiếm (DuckDuckGo, Google, Bing, Brave), hành vi khi khởi động (mở lại tab / trang chủ / trang trống), thư mục tải xuống tùy chọn, phóng to trang 50–200%, chủ đề sáng/tối/theo hệ thống, xóa cookie và dữ liệu khi thoát, tab ngủ sau 5/15/30 phút rảnh.
- Tra từ điển: panel mở Wiktionary tiếng Anh hoặc tiếng Việt trong tab mới (dịch vụ bên ngoài).
- Chế độ riêng tư dùng `incognito` cho tab mở sau khi bật (cần WebView2 ≥ 101.0.1210.39).
### Sửa
- CSDL: `migrate()` ghi phiên bản trước khi tạo bảng nên các bảng không bao giờ được tạo; đã đổi thứ tự.
- Clippy: bỏ `.clone()` thừa, `filter().next_back()` → `rfind`, bỏ `let` thừa khi trả kết quả, sửa doc list trong `navigation.rs`.
- Bộ chặn: `load()` bỏ cache engine khi có `.txt` mới hơn, nên danh sách người dùng tự đặt vào thư mục có hiệu lực ở lần mở trình duyệt sau mà không cần bấm "Tải lại".
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
- Chặn quảng cáo bản 0.0.2 mới ở mức network (chặn request); chưa lọc thẩm mỹ — chưa ẩn phần tử theo luật `##`, chưa scriptlet, chưa `:has()`.
- Danh sách lọc tải lúc chạy: mở trình duyệt lần đầu (hoặc khi mất mạng) thì engine còn trống, bộ đếm hiện 0 cho tới khi cập nhật xong.
