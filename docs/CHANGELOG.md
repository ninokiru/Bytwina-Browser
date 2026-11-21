# Nhật ký thay đổi

Mỗi phiên bản liệt kê thay đổi **so với bản trước**. Nhóm: Thêm · Thay đổi · Gỡ bỏ · Sửa · Bảo mật.

## 0.0.5 — 2026-11-21 (so với 0.0.4)

### Thêm (Add)
- **Tối ưu Adblock chuyên sâu cho YouTube, TikTok, Facebook**:
  - Bổ sung danh sách `ublock-quick-fixes` chuyên trị các chiến dịch chặn adblock của YouTube.
  - Tích hợp luật lọc thẩm mỹ (cosmetic rules) trực tiếp cho các vị trí quảng cáo feeds/video/banner trên YouTube, Facebook (bài viết Được tài trợ/Sponsored), và TikTok ad badge.
- **Omnibox Thông minh (Smart Address Bar)**:
  - **Tính toán nhanh trực tiếp**: Nhập các phép toán (vd `100*5+20`, `25/5 + 10`) sẽ lập tức hiển thị kết quả ngay trong thanh gợi ý. Bấm vào để copy kết quả.
  - **Gợi ý lịch sử tức thì (Instant History Search)**: Khi nhập từ khóa, tự động truy vấn và hiển thị dropdown danh sách các trang web đã từng truy cập để mở nhanh.
  - **Phím tắt tìm kiếm đa công cụ (Search Engine Shortcuts)**: Nhập tiền tố `!g <từ khóa>` (Google), `!d` (DuckDuckGo), `!b` (Bing), `!y` (YouTube), `!w` (Wikipedia) để tìm kiếm trực tiếp trên dịch vụ mong muốn mà không cần đổi cài đặt mặc định.
- **Giao diện Modern Glassmorphism (Phong cách Chrome & Cốc Cốc)**:
  - Thanh Tab bo tròn 12px, tab đang chọn nổi bật với hiệu ứng kính mờ (frosted glass), viền sáng phản quang trên đỉnh và bóng đổ đa tầng.
  - Hỗ trợ hiển thị Favicon thật từ website kèm hiệu ứng bóng tinh tế.
  - Thanh địa chỉ Omnibox dạng Pill mềm mại hoàn toàn bo tròn (`border-radius: 9999px`), có hiệu ứng viền phát sáng (focus glow) và icon khiên bảo mật trực quan.
  - Các mục Cài đặt được tổ chức theo khối Card Group bo góc hiện đại, tự động nổi khối khi rê chuột.
- **Chặn quảng cáo động (Dynamic Adblock & MutationObserver)**:
  - Tích hợp `MutationObserver` phát hiện và dập tắt các phần tử quảng cáo sinh ra động bằng JavaScript trên các Single Page App (SPA) mà không cần tải lại trang.
- **Bộ danh sách chặn quảng cáo tối ưu cho người Việt**:
  - Tích hợp thêm bộ lọc ABPVN, uBlock Filters và uBlock Privacy vào bộ lọc mặc định.

### Thay đổi (Change)
- **Dark Mode**: Chuyển sang tông màu tối sâu (`#0d1117`), tăng độ tương phản và viền phản quang giúp dịu mắt và sang trọng hơn.
- **Tự động khóa Kho mật khẩu**: Nâng cấp thời gian tự động khóa mặc định lên 15 phút (thay vì không bao giờ khóa) để bảo vệ tài khoản khi rời máy.
- **Tối ưu tốc độ CI/CD**: Chạy song song độc lập giữa Frontend và Rust, tự động gom toàn bộ lỗi vào bảng thông báo trong 1 lần chạy duy nhất.

### Sửa lỗi (Fix)
- **Lỗi Race Condition khi tắt trình duyệt**: Khắc phục hiện tượng app bị đóng trước khi WebView2 xóa xong cookie (`clearOnExit`) hoặc trước khi lưu xong phiên duyệt web.
- **Lỗi rò rỉ phiên trong Chế độ riêng tư (Private Mode)**:
  - Ngăn chặn hoàn toàn việc ghi lịch sử tải file khi đang bật InPrivate.
  - Chặn lưu danh sách tab ẩn danh vào bộ nhớ phiên tab tự động.
  - Reset toàn bộ cache hỏi quyền trang web khi bật/tắt chế độ riêng tư.
- **Lỗi cú pháp PowerShell trong Action Release**: Sửa lỗi tham chiếu biến `$sigFile:` gây dừng script build.

### Bảo mật (Security)
- **Content Security Policy (CSP)**: Thiết lập CSP nghiêm ngặt cho webview thanh công cụ, ngăn chặn hoàn toàn nguy cơ chèn script độc hại vào tầng điều khiển.
- **Khắc phục lỗi Path Traversal trong Backup**: Chặn ký tự ổ đĩa `:` trên Windows để đảm bảo tệp sao lưu không bị ghi lệch khỏi thư mục an toàn.
- **Origin Permission chặt chẽ**: Cố định kiểm tra tên miền theo ID phía Rust, loại bỏ lỗ hổng can thiệp từ giao diện.

## 0.0.4 — 2026-11-20 (so với 0.0.3)

### Thêm
- **Kho mật khẩu mã hóa** (M11): mật khẩu chủ suy khóa bằng Argon2id, từng mục mã hóa AES-256-GCM. Thêm, sửa, xóa, tìm; hiện và sao chép mật khẩu; tự khóa sau 1–60 phút hoặc khóa tay; xóa toàn bộ kho khi quên mật khẩu chủ. Mật khẩu chủ không được lưu; khóa chỉ nằm trong RAM. Chưa tự điền mật khẩu vào form.
- **Quyền trang web** (M12): camera, micro, vị trí, thông báo… được hỏi từng lần, có thể nhớ theo origin. Cài đặt liệt kê quyền đã lưu và cho xóa theo từng trang.
- **Sao lưu và khôi phục CSDL** (M13): tạo bản sao bằng `VACUUM INTO` trong thư mục `backups`, xem danh sách kèm kích thước và thời gian, xóa từng bản. Khôi phục được áp dụng ở lần khởi động kế tiếp, trước khi mở CSDL; CSDL cũ được giữ trong thư mục `pre-restore-<thời gian>`.
- **Lọc thẩm mỹ** (M4b): ẩn phần tử quảng cáo bằng CSS sau khi trang tải xong.
- **Tự cập nhật** (M14): kiểm tra và cài bản mới từ GitHub Releases; chỉ cài bản có chữ ký khớp khóa công khai. Mục menu ⋮ "Cập nhật Bytwina".
- **Hệ thống** trong Cài đặt: khởi động cùng Windows; mở trang "Ứng dụng mặc định" của Windows; đặt lại cài đặt về mặc định.
- **Xóa dữ liệu theo khoảng thời gian**: lịch sử và tải xuống, theo 1 giờ / 24 giờ / 7 ngày / toàn bộ.
- **Trang tab mới** mới: lời chào, ô tìm kiếm lớn, lưới liên kết nhanh lấy từ dấu trang rồi đến lịch sử.
- **Menu ⋮** kiểu Cốc Cốc: cột phím tắt, hàng thu phóng, hàng hồ sơ (chưa có tài khoản), chuyển tab dọc/ngang, thoát.
- **Tìm trong Cài đặt**: lọc theo nhãn hoặc từ khóa, không cần dấu tiếng Việt.

### Thay đổi
- **Cài đặt** chuyển sang bố cục hai cột: mục lục bên trái, nội dung bên phải.
- **Thanh địa chỉ** là pill cố định cao 34 px, không co giãn khi bấm vào.
- **Tab dọc** tinh chỉnh: vạch accent cho tab đang chọn; nút ghim chỉ hiện khi rê chuột.
- **Ô địa chỉ** để trống ở tab mới thay vì hiện `about:blank`.
- **Giao diện** tôn trọng thiết lập giảm chuyển động của Windows.
- **Phụ thuộc**: nâng `rusqlite` từ 0.32 lên 0.43 để xử lý RUSTSEC-2026-0459.
- **CI**: lỗi TypeScript hiện thành annotation và đưa 60 dòng cuối vào Summary, giống các bước Rust.

### Gỡ bỏ
- **Bộ chọn công cụ tìm kiếm** trên trang tab mới. Cấu hình công cụ tìm kiếm chuyển hẳn vào Cài đặt.

### Sửa
- **Bảo mật IPC**: lệnh `browser_command` chỉ chấp nhận gọi từ webview thanh công cụ (`toolbar`), kiểm tra ở phía Rust. Trước đó, do ACL không áp dụng với lệnh tùy biến ở origin cục bộ, trang chạy ở origin của chính app có thể gọi được mọi lệnh, kể cả kho mật khẩu.
- **Chế độ riêng tư** không còn ghi phiên tab (URL và tiêu đề) vào CSDL qua vòng lưu tự động 30 giây.
- **Quyền trang web**: không làm mất lời hỏi đang chờ khi trả lời hoặc hủy.
- **Lọc thẩm mỹ**: sửa kiểu gọi API `webview2-com` cho `ExecuteScript` và `NavigationCompleted`.
- **Chặn quảng cáo theo tên miền**: xác định registrable domain theo Public Suffix List, thay cho cách đoán cũ (sai với `co.uk`, `com.vn`).
- **Biên dịch trên CI**: sửa lỗi quyền trang web không biên dịch được và các cảnh báo clippy.
- **Khiên chặn** và trạng thái tắt hiển thị đúng khi trang không có tên miền.
- **Thu phóng**: hàng thu phóng không còn bị lỗi kiểu khi kiểm tra TypeScript.
- **Biểu tượng Panel**: khôi phục import bị thiếu.
- **Build release** không còn lỗi khi chưa có khóa ký cập nhật: tắt sinh artifact cập nhật nếu không có khóa; chỉ bật khi có cả khóa công khai và khóa bí mật.
- **Bố cục tab dọc**: vùng nội dung và webview thanh công cụ tính theo chế độ dọc/ngang. Chưa kiểm chứng trên Windows.

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
- Reader mode và ký số: chưa có.
- Chặn quảng cáo mới ở mức network và lọc thẩm mỹ cơ bản; chưa có scriptlet, chưa `:has()`, luật chung (không kèm tên miền) chưa khớp đầy đủ.
- Danh sách lọc tải lúc chạy: mở trình duyệt lần đầu (hoặc khi mất mạng) thì engine còn trống, bộ đếm hiện 0 cho tới khi cập nhật xong.
- Tab dọc, chia màn hình, workspace: logic đã có nhưng chưa kiểm chứng đầy đủ trên Windows.
- Bản 0.0.4 chưa được kiểm chứng biên dịch và chạy thử trên Windows trong phiên làm việc này; xem kết quả CI.
