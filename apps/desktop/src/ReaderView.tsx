import { useEffect, useState, type MouseEvent } from "react";
import { cmd } from "./tabs";
import "./ReaderView.css";

interface Article {
  title: string;
  html: string;
  text_length: number;
  site_name: string | null;
}

type State =
  | { status: "loading" }
  | { status: "ok"; article: Article }
  | { status: "error"; error: string };

export default function ReaderView({
  open,
  url,
  onClose,
  onNavigate,
}: {
  open: boolean;
  url: string;
  onClose: () => void;
  onNavigate: (url: string) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    cmd("reader_extract", { url })
      .then((res) => {
        if (!cancelled) setState({ status: "ok", article: res as Article });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  if (!open) return null;

  // Liên kết trong bài đọc mở ở tab hiện tại, không để thanh công cụ tự điều hướng.
  const onBodyClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href");
    if (href && /^https?:\/\//.test(href)) onNavigate(href);
  };

  return (
    <div className="rv-overlay" onMouseDown={onClose}>
      <article className="rv-panel" role="dialog" aria-modal="true" aria-label="Chế độ đọc" onMouseDown={(e) => e.stopPropagation()}>
        <div className="rv-head">
          <span className="rv-tag">Chế độ đọc</span>
          <button className="rv-close" onClick={onClose} aria-label="Đóng">×</button>
        </div>
        {state.status === "loading" && <p className="rv-status">Đang tách nội dung bài viết…</p>}
        {state.status === "error" && (
          <p className="rv-status">
            Không đọc được trang này. {state.error}
          </p>
        )}
        {state.status === "ok" && (
          <>
            <h1 className="rv-title">{state.article.title || url}</h1>
            <p className="rv-meta">
              {state.article.site_name ? `${state.article.site_name} · ` : ""}
              {Math.max(1, Math.round(state.article.text_length / 1000))} nghìn ký tự
            </p>
            {state.article.text_length < 200 && (
              <p className="rv-status">Trang này có ít nội dung chữ, có thể không đọc đầy đủ được.</p>
            )}
            <div className="rv-body" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: state.article.html }} />
          </>
        )}
      </article>
    </div>
  );
}
