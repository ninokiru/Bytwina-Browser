import { useEffect, useRef, useState } from "react";
import { cmd } from "./tabs";
import { getLang } from "./i18n";
import "./DownloadOverlay.css";

// Overlay tải xuống: góc dưới phải, hiển thị các tệp vừa tải xong.
// Poll downloads_list từ DB mỗi 3s; không có sự kiện realtime từ WebView2 ở M3.

interface DownloadItem {
  id: number;
  url: string;
  path: string;
  success: boolean;
  finishedAt: number;
}

interface ToastItem extends DownloadItem {
  key: number; // để React key duy nhất
  visible: boolean;
  exiting: boolean;
}

const POLL_INTERVAL = 3000;
const TOAST_DURATION = 8000;
const MAX_TOASTS = 5;

export default function DownloadOverlay() {
  const en = getLang() === "en";
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenIds = useRef<Set<number>>(new Set());
  const pollTimer = useRef<number | null>(null);

  // Mở tệp hoặc thư mục chứa tệp
  const openPath = async (path: string, openFolder: boolean) => {
    try {
      await cmd("file_open_external", { path: openFolder ? getFolder(path) : path });
    } catch (e) {
      console.error("openPath", e);
    }
  };

  function getFolder(filePath: string): string {
    const i = filePath.lastIndexOf("\\");
    const j = filePath.lastIndexOf("/");
    const sep = Math.max(i, j);
    return sep >= 0 ? filePath.slice(0, sep) : filePath;
  }

  function formatTime(ts: number): string {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Poll DB
  useEffect(() => {
    let alive = true;
    let firstRun = true;

    const poll = async () => {
      if (!alive) return;
      try {
        const list = (await cmd("downloads_list")) as DownloadItem[] | null;
        if (!alive) return;
        if (!list) return;

        // Chỉ lấy các mục mới (success=true, chưa thấy id)
        const newItems = list
          .filter((d) => d.success && !seenIds.current.has(d.id))
          .slice(0, MAX_TOASTS);

        if (newItems.length > 0) {
          setToasts((prev) => {
            const next = [...prev];
            for (const item of newItems) {
              seenIds.current.add(item.id);
              next.unshift({ ...item, key: Date.now() + Math.random(), visible: true, exiting: false });
              if (next.length > MAX_TOASTS) next.pop();
            }
            return next;
          });
        }

        // Đánh dấu seen cho lần đầu (không toast cho lịch sử cũ)
        if (firstRun) {
          for (const d of list) if (d.success) seenIds.current.add(d.id);
          firstRun = false;
        }
      } catch (e) {
        console.error("download poll", e);
      }
    };

    poll();
    pollTimer.current = window.setInterval(poll, POLL_INTERVAL);
    return () => { if (pollTimer.current) window.clearInterval(pollTimer.current); };
  }, []);

  // Tự ẩn toast sau TOAST_DURATION
  useEffect(() => {
    const timers: number[] = [];
    for (const t of toasts) {
      if (t.visible && !t.exiting) {
        const id = window.setTimeout(() => {
          setToasts((prev) => prev.map((x) => (x.key === t.key ? { ...x, exiting: true } : x)));
        }, TOAST_DURATION);
        timers.push(id);
      }
    }
    return () => { for (const id of timers) window.clearTimeout(id); };
  }, [toasts]);

  // Xóa toast sau animation exit
  useEffect(() => {
    const exiting = toasts.filter((t) => t.exiting);
    if (exiting.length === 0) return;
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => !t.exiting));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="dl-overlay" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.key}
          className={`dl-toast${t.exiting ? " exiting" : ""}`}
          onAnimationEnd={() => t.exiting && setToasts((prev) => prev.filter((x) => x.key !== t.key))}
        >
          <div className="dl-icon">
            {t.success ? "✓" : "✕"}
          </div>
          <div className="dl-info">
            <div className="dl-name" title={t.path}>
              {t.path.split(/[\\/]/).pop() || t.path}
            </div>
            <div className="dl-meta">
              <span>{formatTime(t.finishedAt)}</span>
              <span>·</span>
              <a className="dl-link" href={t.url} target="_blank" rel="noopener">{t.url.slice(0, 50)}…</a>
            </div>
          </div>
          <div className="dl-actions">
            <button className="dl-btn" onClick={() => void openPath(t.path, false)} title={en ? "Open file" : "Mở tệp"}>
              📄
            </button>
            <button className="dl-btn" onClick={() => void openPath(t.path, true)} title={en ? "Open folder" : "Mở thư mục"}>
              📁
            </button>
            <button className="dl-btn close" onClick={() => setToasts((prev) => prev.filter((x) => x.key !== t.key))} aria-label={en ? "Dismiss" : "Đóng"}>
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}