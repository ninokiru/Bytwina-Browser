import { useEffect, useState } from "react";
import { cmd } from "./tabs";
import { FaviconImg } from "./favicon";
import "./BookmarksBar.css";

interface Bookmark {
  id: number;
  title: string;
  url: string;
  folder: string;
}

// Thanh dấu trang ngay dưới ô địa chỉ (như Chrome/Edge).
// Lấy danh sách từ `bookmark_list` (đã có IPC), click vào nút để điều hướng.
export default function BookmarksBar({
  onNavigate,
}: {
  onNavigate: (url: string) => void;
}) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void cmd("bookmark_list")
      .then((list) => {
        if (!alive) return;
        setBookmarks((list as Bookmark[]) ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!loaded) return null;

  return (
    <div className="bm-bar">
      <div className="bm-inner">
        {bookmarks.length === 0 ? (
          <span className="bm-empty">Chưa có dấu trang</span>
        ) : (
          <ul className="bm-list">
            {bookmarks.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="bm-item"
                  onClick={() => onNavigate(b.url)}
                  title={b.url}
                  aria-label={b.title || b.url}
                >
                  <span className="bm-icon">
                    <FaviconImg host={hostOf(b.url)} className="bm-favicon" />
                    <span className="bm-letter">{letterOf(b.title || b.url)}</span>
                  </span>
                  <span className="bm-label">{b.title || hostOf(b.url)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function letterOf(text: string): string {
  const m = text.match(/[A-Za-zÀ-ỹ]/i);
  return m ? m[0].toUpperCase() : "?";
}