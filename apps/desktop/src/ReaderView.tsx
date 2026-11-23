import { useEffect, useRef, useState } from "react";
import { cmd } from "./tabs";
import { getLang } from "./i18n";
import "./ReaderView.css";

// Chế độ đọc (Reader Mode): trích xuất nội dung bài viết từ trang web,
// hiển thị sạch sẽ không quảng cáo, font to, nền kem/tốt.
// Dùng IPC `reader_extract` (Rust: reqwest fetch + dom_smoothie extract).

interface Props {
  url: string;
  title: string;
  onClose: () => void;
}

export default function ReaderView({ url, title, onClose }: Props) {
  const en = getLang() === "en";
  const [html, setHtml] = useState("");
  const [pageTitle, setPageTitle] = useState(title);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<"sepia" | "light" | "dark">("sepia");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const res = (await cmd("reader_extract", { url })) as {
          html?: string;
          title?: string;
        };
        if (!alive) return;
        if (res.html) {
          setHtml(res.html);
          if (res.title) setPageTitle(res.title);
        } else {
          setError(en ? "Could not extract article." : "Không trích xuất được bài viết.");
        }
      } catch (e) {
        if (!alive) return;
        setError(
          en
            ? `Reader error: ${e instanceof Error ? e.message : String(e)}`
            : `Lỗi chế độ đọc: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [url, en]);

  const applyTheme = () => {
    if (!containerRef.current) return;
    containerRef.current.dataset.theme = theme;
  };

  useEffect(() => {
    applyTheme();
  }, [theme]);

  const changeFontSize = (delta: number) => {
    setFontSize((v) => Math.min(32, Math.max(14, v + delta)));
  };

  if (loading) {
    return (
      <div className="rv-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="rv-panel">
          <div className="rv-body">
            <div className="rv-loading">{en ? "Extracting article…" : "Đang trích xuất bài viết…"}</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rv-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="rv-panel">
          <header className="rv-head">
            <h2>{pageTitle}</h2>
            <button className="rv-close" onClick={onClose} aria-label={en ? "Close" : "Đóng"}>
              ✕
            </button>
          </header>
          <div className="rv-body">
            <div className="rv-error">{error}</div>
            <button className="rv-btn rv-btn-primary" onClick={onClose}>
              {en ? "Close" : "Đóng"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rv-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rv-panel">
        <header className="rv-head">
          <h2>{pageTitle}</h2>
          <div className="rv-controls">
            <button
              className={`rv-btn${theme === "sepia" ? " on" : ""}`}
              onClick={() => setTheme("sepia")}
              title={en ? "Sepia" : "Nền kem"}
            >
              ☕
            </button>
            <button
              className={`rv-btn${theme === "light" ? " on" : ""}`}
              onClick={() => setTheme("light")}
              title={en ? "Light" : "Sáng"}
            >
              ☀
            </button>
            <button
              className={`rv-btn${theme === "dark" ? " on" : ""}`}
              onClick={() => setTheme("dark")}
              title={en ? "Dark" : "Tối"}
            >
              🌙
            </button>
            <button className="rv-btn" onClick={() => changeFontSize(-1)} title="A-">
              A⁻
            </button>
            <span className="rv-font-size">{fontSize}px</span>
            <button className="rv-btn" onClick={() => changeFontSize(1)} title="A+">
              A⁺
            </button>
            <button className="rv-close" onClick={onClose} aria-label={en ? "Close" : "Đóng"}>
              ✕
            </button>
          </div>
        </header>
        <div className="rv-body" ref={containerRef}>
          <div
            className="rv-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        <footer className="rv-foot">
          <a href={url} target="_blank" rel="noopener noreferrer" className="rv-source">
            {en ? "Open original page" : "Mở trang gốc"}
          </a>
        </footer>
      </div>
    </div>
  );
}