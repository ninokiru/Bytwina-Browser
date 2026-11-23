import { useEffect } from "react";
import "./ShortcutHelp.css";

// Bảng phím tắt tĩnh. Mục nào thay đổi thì sửa ở đây và ở App.tsx cùng lúc.
const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Tab",
    rows: [
      ["Ctrl+T", "Tab mới"],
      ["Ctrl+W", "Đóng tab"],
      ["Ctrl+Shift+T", "Mở lại tab vừa đóng"],
      ["Ctrl+Tab / Ctrl+Shift+Tab", "Tab kế tiếp / trước đó"],
      ["Ctrl+PageUp / Ctrl+PageDown", "Tab trước / kế tiếp"],
      ["Ctrl+1 … Ctrl+8, Ctrl+9", "Chọn tab theo số, Ctrl+9 là tab cuối"],
    ],
  },
  {
    title: "Điều hướng",
    rows: [
      ["Ctrl+L, Alt+D, F6", "Chọn thanh địa chỉ"],
      ["Ctrl+Enter (thanh địa chỉ)", "Thêm www. và .com"],
      ["Alt+←, Alt+→", "Quay lại / tiến tới"],
      ["Alt+Home", "Về trang chủ"],
      ["F5, Ctrl+R", "Tải lại"],
      ["Ctrl+F5, Ctrl+Shift+R", "Tải lại bỏ bộ nhớ đệm"],
      ["Esc", "Dừng tải hoặc đóng bảng"],
    ],
  },
  {
    title: "Công cụ",
    rows: [
      ["Ctrl+K", "Bảng lệnh"],
      ["Ctrl+D", "Đánh dấu trang"],
      ["Ctrl+J", "Tải xuống"],
      ["Ctrl+O", "Mở tệp trên máy (ảnh, code, Markdown, PDF)"],
      ["Ctrl+F", "Tìm trong trang"],
      ["Ctrl+P", "In trang"],
      ["Ctrl+S", "Lưu trang"],
      ["Ctrl+Shift+R", "Chế độ đọc"],
      ["Ctrl+Shift+Q", "Mã QR cho trang hiện tại"],
      ["Ctrl+H", "Lịch sử"],
      ["Ctrl+Shift+Delete", "Xóa dữ liệu duyệt web"],
      ["Ctrl+Shift+F", "Chế độ tập trung"],
      ["Ctrl+=, Ctrl+-, Ctrl+0", "Phóng to, thu nhỏ, 100%"],
      ["F11", "Toàn màn hình"],
      ["Ctrl+N", "Cửa sổ mới"],
      ["Ctrl+Shift+B", "Hiện/ẩn thanh dấu trang"],
      ["F3", "Tìm kết quả tiếp theo (trong trang)"],
      ["Shift+F3", "Tìm kết quả trước đó (trong trang)"],
      ["Ctrl+Shift+D", "Đánh dấu tất cả tab đang mở"],
      ["F12 / Ctrl+Shift+I", "Mở công cụ phát triển (DevTools)"],
      ["Ctrl+Shift+J", "Mở Console"],
      ["Ctrl+U", "Xem mã nguồn trang"],
    ],
  },
  {
    title: "Cửa sổ",
    rows: [
      ["Ctrl+Shift+N", "Cửa sổ riêng tư"],
      ["Ctrl+Shift+O", "Mở ứng dụng mặc định"],
      ["Ctrl+\\", "Chia màn hình (split)"],
      ["Ctrl+Q", "Thoát"],
      ["F1, Ctrl+/", "Hiện bảng này"],
    ],
  },
];

export default function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sh-overlay" onMouseDown={onClose}>
      <div
        className="sh-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Phím tắt"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sh-head">
          <h2>Phím tắt</h2>
          <button className="sh-close" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        <div className="sh-grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([keys, desc]) => (
                  <div className="sh-row" key={keys}>
                    <dt>{keys}</dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
