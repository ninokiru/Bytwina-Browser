# Quyết định kiến trúc (ADR)

## ADR-001: Dùng Window::add_child để đặt WebView2 native trong cửa sổ

- **Trạng thái:** Chấp nhận cho M0–M2; cần đánh giá lại trước production.
- **Bối cảnh:** Trình duyệt phải dùng WebView2 native, không dùng iframe.
- **Quyết định:** Dùng `tauri::Window::add_child(WebviewBuilder, position, size)`.
- **Rủi ro đã xác minh (docs.rs, Tauri 2.12.6):**
  - Hàm chỉ khả dụng với feature `unstable`. Prototype bật feature này trong `Cargo.toml`.
  - Trên Windows, hàm có thể deadlock nếu gọi từ command đồng bộ hoặc event handler. Mọi command gọi `add_child` phải là `async`.
- **Hệ quả:** Có thể bị thay đổi ở bản Tauri sau. Trước M1 cần quyết định giữ hay thay thế.
- **Phương án thay thế:** Tách trình duyệt thành cửa sổ/tiến trình riêng, hoặc dùng API WebView không thuộc Tauri (wry trực tiếp).

## ADR-002: Một lệnh IPC duy nhất cho toàn bộ thao tác của toolbar

- **Trạng thái:** Chấp nhận (M1).
- **Bối cảnh:** Webview nội dung là trang web xa, không bao giờ được gọi IPC; chỉ toolbar tin cậy được gọi (capabilities/default.json). Số lượng thao tác trình duyệt sẽ tăng nhiều theo milestone.
- **Quyết định:** Toolbar gọi một lệnh `browser_command(action, args)` (action dạng chuỗi, args JSON). Backend kiểm tra action trong danh sách tường minh.
- **Lý do:** Giảm bề mặt capability, tránh trùng tên lệnh, dễ mở rộng ở M2–M5 mà không sửa capabilities.
- **Đánh đổi:** Mất type-check tự động giữa TS và Rust ở biên IPC — bù bằng cách định nghĩa payload trong `src/tabs.ts` và test Rust cho parsing action.

## ADR-003: Chặn mọi điều hướng phía trang; URL chỉ đổi qua toolbar

- **Trạng thái:** Chấp nhận (M1).
- **Bối cảnh:** Back/forward/history của tab phải là sự thật duy nhất giữa frontend và backend. WebView2 native child không có API back/forward phía Tauri.
- **Quyết định:** Mỗi webview nội dung đăng ký `on_navigation` trả `false` với mọi URL. Trang web không tự chuyển location, không bấm link ngoài. Mọi điều hướng đi qua toolbar → `Webview::navigate` (bỏ qua on_navigation). Lịch sử back/forward tự quản trong `BrowserState` (giới hạn 50 mục/tab).
- **Hạn chế đã biết:** Người dùng không click được link trong trang — đây là giới hạn tạm thời của M1, sẽ xử lý ở M4/M5 bằng cơ chế cho phép điều hướng cùng origin có kiểm soát. Ghi rõ trong docs/SECURITY.md khi hoàn thiện.

## ADR-004: Popup chặn cửa sổ mới, URL hợp lệ mở thành tab nền

- **Trạng thái:** Chấp nhận (M1), cập nhật 2026-11-18.
- **Bối cảnh:** `window.open`/target=_blank phải xử lý an toàn; không tạo cửa sổ lạ che toolbar. Bản đầu dùng cờ `allow_next` do toolbar bật khi người dùng giữ Ctrl, nhưng webview nội dung không có bridge và toolbar không thấy phím Ctrl của trang, nên tính năng chưa bao giờ chạy.
- **Quyết định:** `on_new_window` luôn trả `NewWindowResponse::Deny`. URL popup đi qua chính sách `page_navigation_allowed` (https, trừ danh sách chặn), rồi vào `PopupQueue` (tối đa 16 mục). Toolbar poll `popup_drain` và mở thành tab **nền** (không cướp focus, không tạo webview cho tới khi kích hoạt).
- **Lý do:** popup thường do người dùng bấm link nên mở tab nền là hành vi quen thuộc; giới hạn hàng đợi chặn trang spam; vẫn không có cửa sổ WebView2 lạ nào được tạo.
- **Hệ quả:** bỏ action `popup_allow` và state `AtomicBool`; `popup_drain` không còn tạo webview rỗng.

## ADR-005: rusqlite + bundled cho SQLite

- **Trạng thái:** Chấp nhận (M2).
- **Bối cảnh:** Spec yêu cầu SQLite cho bookmarks/history/preferences/session, có migrations, WAL, transaction, không block UI thread.
- **Quyết định:** `rusqlite` bản `bundled` (compile SQLite kèm app — không phụ thuộc runtime hệ thống), kết nối bọc `Arc<Mutex<Connection>>`, mở tại `app_data_dir/bytwina.db`, WAL + synchronous=NORMAL, bảng `schema_version` cho versioning. Lệnh DB chạy trong command async (luồng tokio), giữ khóa mutex ngắn.
- **Lý do chọn rusqlite thay vì sqlx/diesel:** đồng bộ, ít phụ thuộc, hợp máy dev 8 GB; sqlx async-heavy và diesel thiên về server SQL lớn.
- **Giới hạn:** Một connection duy nhất; nếu M6 đo thấy contention thì tách read pool.

## ADR-003: Điều hướng trong trang đang bị chặn (`deny_all`)

- **Trạng thái:** ĐÃ CHẤP NHẬN (2026-11-19), xem ADR-011.
- **Bối cảnh:** `on_navigation(deny_all)` trả về `false`, nên link trong trang và `target=_blank` không hoạt động. Chỉ thanh địa chỉ (IPC) được đổi URL.
- **Hệ quả:** Trình duyệt chưa thể duyệt web bình thường qua link. Nếu bỏ chặn, cần kiểm tra xem `on_navigation` có áp dụng cả cho `webview.navigate()` từ Rust hay không.
- **Phương án:** (a) cho phép http/https và áp dụng danh sách chặn; (b) giữ chặn và chỉ dùng thanh địa chỉ.

---
# Đề xuất cho M10–M15 (trạng thái: CHƯA CHẤP NHẬN, chưa có code)

## ADR-004 (đề xuất): M10 còn lại — giao diện và trải nghiệm
- Theme sáng/tối: toolbar đang dùng style inline với màu cố định. Cần chuyển sang biến CSS trước, rồi mới thêm theme. Ước lượng: một lượt, nhỏ.
- Split view, workspace, tab sleep, PiP: cần thay đổi bố cục Rust (nhiều webview cùng lúc, đo lại tài nguyên). Cần đo hiệu năng trước (xem docs/PERFORMANCE.md).
- Cử chỉ, quick actions, toolbar tùy biến: làm sau khi bố cục ổn định.
- **Quyết định cần bạn:** có làm theme trước không, và thứ tự còn lại.

## ADR-005 (đề xuất): M11 — Đồng bộ
- Không thể làm trong môi trường hiện tại: cần backend, xác thực, mã hóa đầu cuối và quản lý khóa. Đây là hạ tầng bạn chưa có.
- Phần làm được trước (không cần máy chủ): thiết kế định dạng dữ liệu đồng bộ, mô hình xung đột (last-write-wins hoặc CRDT), và xuất/nhập sao lưu cục bộ (Backup/Restore).
- **Quyết định cần bạn:** có chấp nhận làm sao lưu/khôi phục cục bộ trước không.

## ADR-006 (đề xuất): M12 — Hệ sinh thái mở rộng
- Rủi ro cao nhất trong roadmap. WebView2 không hỗ trợ đầy đủ tiện ích Chrome; cần kiểm chứng trên tài liệu chính thức trước khi thiết kế.
- Phần làm được: thiết kế API plugin nội bộ và mô hình quyền (permission manifest) mà không chạy mã bên thứ ba.
- Trước khi làm: cần ADR riêng về việc có giữ WebView2 hay chuyển sang engine khác.
- **Quyết định cần bạn:** có chấp nhận ràng buộc "chỉ WebView2" cho M12 không.

## ADR-007 (đề xuất): M13 — Đa nền tảng
- Không làm code trong giai đoạn này. Phần làm được: tách module platform-specific (hiện đã gọi `webview_version` và đường dẫn Windows) và viết tài liệu nghiên cứu Linux/macOS.
- Roadmap khuyến nghị Linux trước. Chưa có số liệu hay thử nghiệm nào.

## ADR-008 (đề xuất): M14 — Trợ lý thông minh (AI)
- Yêu cầu của roadmap: tùy chọn, không chạy nền, không gửi dữ liệu trang lên cloud mặc định.
- Không làm được khi chưa chọn mô hình (local hoặc cloud) và chính sách dữ liệu. Không tạo tính năng giả lập.
- **Quyết định cần bạn:** dùng mô hình nào (cloud có chủ đích hay local), và có chấp nhận AI là tính năng tùy chọn tắt mặc định không.

## ADR-009 (đề xuất): M15 — Bảo mật và riêng tư nâng cao
- Có thể làm một phần cục bộ: chặn theo danh sách mở rộng (cần filter list bảo trì, hiện chỉ có danh sách tối thiểu), chính sách HTTPS-first (cần xử lý điều hướng; liên quan ADR-003).
- Cần WebView2 API chưa kiểm chứng: chặn tài nguyên (WebResourceRequested), quản lý quyền site, DNS an toàn.
- Chống theo dõi vân tay (fingerprinting): cần chèn script vào trang, mâu thuẫn với nguyên tắc "không chèn JS đặc quyền". Cần quyết định riêng.
- Phát hiện lừa đảo: cần nguồn dữ liệu đáng tin cậy (dịch vụ bên ngoài) — hạ tầng.
- **Quyết định cần bạn:** có chấp nhận chèn script cho chống vân tay không, và nguồn danh sách chặn.

## ADR-006 (cập nhật): M12 — các phương án ngoài WebView2
- **Giữ WebView2 + API tiện ích riêng:** tiện ích của Bywina viết theo API nội bộ (quyền khai báo trước, không chạy mã bên thứ ba trong trang). Không tương thích tiện ích Chrome.
- **Chromium Embedded Framework (CEF):** là Chromium đầy đủ, có khả năng hỗ trợ tiện ích Chrome tốt hơn, nhưng RAM và kích thước lớn hơn nhiều và tích hợp Rust phức tạp.
- **Electron:** Chromium đầy đủ, nhưng nặng và trái với mục tiêu tài nguyên thấp trong spec.
- **Verso (Servo) qua Tauri:** thử nghiệm, chưa đủ chín cho trình duyệt đầy đủ.
- **WebView2 Extensions:** Microsoft có đặc tả thử nghiệm cho tiện ích trên WebView2 (github.com/MicrosoftEdge/WebView2Feedback). Cần kiểm chứng trên bản Runtime thật trước khi dùng.
- Nguồn tham khảo: https://github.com/MicrosoftEdge/WebView2Feedback/blob/main/specs/Extensions.md , https://v2.tauri.app/blog/tauri-verso-integration/ , https://blog.scottlogic.com/2023/02/01/webview2-electron-challengers-and-slightly-lighter-desktop-web-applications.html
- **Đề xuất:** giữ WebView2 + API nội bộ cho M12; chỉ xét CEF nếu yêu cầu tương thích tiện ích Chrome là bắt buộc.

## ADR-008 (cập nhật): M14 — trợ lý AI chỉ dùng cloud, bật tùy chọn
- Mặc định TẮT. Không chạy mô hình cục bộ (theo yêu cầu).
- Khi bật, người dùng nhập khóa API của nhà cung cấp. Nội dung trang chỉ gửi khi người dùng bấm "tóm tắt" hoặc "hỏi", không tự động.
- **Chưa làm** vì hai lý do:
  1. Lấy nội dung trang cần chèn script vào trang web từ xa. Nguyên tắc hiện tại cấm điều này (xem SECURITY.md). Cần ADR riêng về cách lấy nội dung (ví dụ: chỉ đọc khi người dùng cho phép theo từng trang).
  2. Khóa API không được lưu plaintext trong SQLite (spec). Cần thiết kế lưu trữ bằng Windows Credential Manager, phải được xem xét bảo mật trước.
- Đề xuất bước đầu: khóa API chỉ giữ trong bộ nhớ phiên (mất khi thoát), và chỉ gửi văn bản do người dùng dán vào.

## ADR-010 (đề xuất): Cập nhật tự động (self-update)
- Dùng `tauri-plugin-updater`. Bắt buộc có khóa ký (không tắt được).
- Các bước người dùng cần làm một lần: tạo cặp khóa (`npm run tauri signer generate`), đặt khóa công khai vào `tauri.conf.json`, đặt khóa bí mật vào GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`.
- Nguồn cập nhật: `https://github.com/<chủ-repo>/releases/latest/download/latest.json` (dùng GitHub Releases, không cần máy chủ riêng).
- **Chưa kích hoạt** vì: đăng ký plugin khi chưa có khóa có thể làm app không khởi động. Sẽ kích hoạt sau khi có khóa công khai.

## ADR-011: Chấp nhận điều hướng trong trang theo HTTPS-first (thay cho `deny_all`)
- **Trạng thái:** Chấp nhận (2026-11-19). Thay thế ADR-003.
- **Quyết định:** cho phép điều hướng trong trang theo chính sách `page_navigation_allowed`:
  https (trừ danh sách chặn), localhost qua http, about:blank. Chặn http của trang khác và mọi giao thức khác.
  Nhập địa chỉ có `http://` được nâng cấp lên `https://` (trừ localhost).
- **Lý do:** không cho bấm link khiến trình duyệt không dùng được. Chính sách này giữ ranh giới: nội dung từ xa vẫn không có quyền IPC.
- **Hệ quả và rủi ro:**
  - Nhiều trang chỉ có http sẽ không mở được. Chưa có cơ chế cho phép thủ công từng trang.
  - Chưa kiểm chứng: `on_navigation` có áp dụng cho `navigate()` từ Rust không. Nếu có, điều hướng do app khởi tạo vẫn đi qua chính sách này (các URL đó đều https/about:blank nên không bị chặn).
  - Chưa kiểm chứng trên Windows: bấm link, chuyển hướng (redirect) từ https sang http sẽ bị chặn.
- **Việc tiếp theo:** kiểm thử trên Windows với 20 trang thực tế; cân nhắc cho phép http theo từng trang sau xác nhận của người dùng.

## ADR-012: Phiên làm việc lưu trạng thái tab; chế độ riêng tư tạo lại webview

- **Trạng thái:** Chấp nhận (2026-11-18).
- **Bối cảnh:**
  - Phiên chỉ lưu `url` và `title`, nên khôi phục xong mất tab ghim và nhóm tab.
  - `incognito(true)` của Tauri chỉ có hiệu lực lúc tạo webview; bật chế độ riêng tư khi tab đang mở vẫn tiếp tục dùng cookie của profile thường.
- **Quyết định:**
  - Schema v2 thêm cột `pinned` và `group_name` vào `session_tabs`; DB bản cũ tự `ALTER TABLE` khi mở. Hai bảng M3/M10 (`downloads`, `reading_list`) vào cùng hệ thống migration.
  - `private_set` đóng mọi webview và tạo lại, tab nạp lại URL hiện hành với profile InPrivate (hoặc profile thường khi tắt).
- **Đánh đổi:** đổi chế độ riêng tư làm mất trạng thái tạm của trang (vị trí cuộn, form đang nhập). Chấp nhận vì đúng ngữ nghĩa riêng tư hơn là giữ trạng thái mà cookie vẫn dùng chung.
- **Giới hạn còn lại:** WebView2 vẫn dùng chung user data folder trên đĩa; chưa tách profile (xem ROADMAP M2).

## ADR-013: Bảng nổi phủ toàn cửa sổ bằng cách nới webview toolbar

- **Trạng thái:** Chấp nhận (2026-11-18). Thay cách render bảng nổi cũ.
- **Bối cảnh:** Giao diện và mọi bảng (dấu trang, lịch sử, cài đặt…) nằm trong webview `toolbar` cao đúng `TOOLBAR_HEIGHT = 96`. Bảng đặt `position: absolute` bên trong bị cắt ở 96 px, gần như không dùng được. Webview con của Tauri xếp theo thứ tự tạo và không có API đổi z-order, nên không thể vẽ bảng đè lên webview nội dung.
- **Quyết định:**
  - Thêm cờ `PANEL_OPEN`; khi bật, `toolbar_height_for` trả về toàn bộ chiều cao cửa sổ, `layout` nới webview toolbar và ẩn mọi webview nội dung đã tạo.
  - Lệnh `panel_open` bật/tắt cờ này; đóng bảng thì `layout` trả toolbar về 96 px và gọi `focus_tab` để hiện lại tab đang hoạt động.
  - `focus_tab` giữ tab mới ở trạng thái ẩn khi `PANEL_OPEN` bật, tránh webview vừa tạo che bảng.
  - Frontend vẽ lớp phủ `.scrim` bắt đầu từ 96 px, nên hai hàng thanh công cụ vẫn bấm được (đổi bảng, đóng bảng).
- **Đánh đổi:** Trong lúc mở bảng, nội dung trang bị ẩn (không phải thu nhỏ) và không thể cuộn/đọc song song; đổi lại bảng có đủ chiều cao và hoạt động ổn định trên WebView2 mà không cần cửa sổ phụ.
- **Hướng thay thế sau này:** cửa sổ/webview riêng cho bảng, hoặc webview toolbar trong suốt phủ toàn cửa sổ nếu WebView2 cho phép hit-test theo vùng.
