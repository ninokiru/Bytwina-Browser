import { useEffect, useRef, useState } from "react";
import { getLang } from "./i18n";
import { cmd } from "./tabs";
import CodeView from "./CodeView";
import PdfView from "./PdfView";
import "./FileViewer.css";

// Xem tệp trên máy (ảnh, văn bản/code, Markdown, PDF) ngay trong Bytwina.
// Không dùng file:// trong tab: Rust mở hộp thoại hệ thống, đọc tệp và trả nội
// dung qua IPC. Chỉ tệp người dùng đã chọn trong phiên hiện tại mới đọc được
// (allowlist phía Rust). Ảnh nạp dưới dạng data:; PDF do pdf.js vẽ từ base64
// (không qua mạng); SVG bị loại vì có thể chứa script.

interface FileText {
  kind: "text";
  path: string;
  name: string;
  size: number;
  text: string;
  truncated: boolean;
  markdown: boolean;
}

interface FileImage {
  kind: "image";
  path: string;
  name: string;
  size: number;
  mime: string;
  dataUrl: string;
}

interface FilePdf {
  kind: "pdf";
  path: string;
  name: string;
  size: number;
  mime: string;
  base64: string;
}

interface FileNotice {
  kind: "unsupported" | "binary" | "too_large";
  path: string;
  name: string;
  size: number;
  message: string;
  external?: boolean;
}

type Loaded = FileText | FileImage | FilePdf | FileNotice;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function FileViewer({ onClose }: { onClose: () => void }) {
  const en = getLang() === "en";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rendered, setRendered] = useState<string | null>(null);
  const [markdownView, setMarkdownView] = useState<"rendered" | "source">("rendered");

  // Ảnh: zoom bằng con lăn và kéo để di chuyển khi phóng to.
  const [imgScale, setImgScale] = useState(1);
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  const imgWrap = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    setImgScale(1);
    setImgPos({ x: 0, y: 0 });
    dragging.current = null;
  }, [loaded]);

  useEffect(() => {
    const el = imgWrap.current;
    if (!el || loaded?.kind !== "image") return;
    // React gắn wheel ở root dạng passive; phải nghe trực tiếp để chặn cuộn trang.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      setImgScale((value) => Math.min(8, Math.max(0.15, value * factor)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loaded]);

  // Markdown: render bằng Rust (pulldown-cmark + ammonia) để HTML đã được làm sạch.
  useEffect(() => {
    if (loaded?.kind !== "text" || !loaded.markdown || markdownView !== "rendered") {
      setRendered(null);
      return;
    }
    let alive = true;
    void cmd("note_render", { content: loaded.text })
      .then((html) => {
        if (alive) setRendered(String(html ?? ""));
      })
      .catch(() => {
        if (alive) setRendered(null);
      });
    return () => {
      alive = false;
    };
  }, [loaded, markdownView]);

  const open = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await cmd("file_pick");
      // null = người dùng bấm hủy trong hộp thoại.
      if (result == null) return;
      setLoaded(result as Loaded);
      setMarkdownView("rendered");
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const openExternal = async () => {
    if (!loaded || !("path" in loaded)) return;
    try {
      await cmd("file_open_external", { path: loaded.path });
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const zoomImage = (factor: number) => {
    setImgScale((value) => Math.min(8, Math.max(0.15, value * factor)));
  };

  const canOpenExternal = loaded != null && "path" in loaded;

  return (
    <div
      className="fv-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="fv-panel"
        role="dialog"
        aria-modal="true"
        aria-label={en ? "File viewer" : "Xem tệp"}
      >
        <header className="fv-head">
          <div className="fv-title">
            <b title={loaded?.name}>{loaded ? loaded.name : en ? "Open a file" : "Mở tệp"}</b>
            {loaded && <small>{formatBytes(loaded.size)}</small>}
          </div>
          {canOpenExternal && (
            <button type="button" className="btn" onClick={() => void openExternal()}>
              {en ? "Open externally" : "Mở ngoài"}
            </button>
          )}
          <button type="button" className="btn primary" disabled={busy} onClick={() => void open()}>
            {busy
              ? en
                ? "Reading…"
                : "Đang đọc…"
              : loaded
                ? en
                  ? "Open another"
                  : "Mở tệp khác"
                : en
                  ? "Choose file"
                  : "Chọn tệp"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {en ? "Close" : "Đóng"}
          </button>
        </header>

        <div className={`fv-body${loaded?.kind === "pdf" ? " fv-body-flush" : ""}`}>
          {error && <p className="fv-error">{error}</p>}

          {!loaded && !error && (
            <p className="fv-empty">
              {en
                ? "Choose an image, text or code file, Markdown or a PDF. Files are read on this device and never exposed to websites."
                : "Chọn ảnh, tệp văn bản hoặc code, Markdown hay PDF. Tệp chỉ được đọc trên thiết bị này và không lộ cho trang web."}
            </p>
          )}

          {loaded?.kind === "image" && (
            <div className="fv-image" ref={imgWrap}>
              <div
                className="fv-image-stage"
                onPointerDown={(e) => {
                  if (imgScale <= 1) return;
                  dragging.current = {
                    x: e.clientX,
                    y: e.clientY,
                    ox: imgPos.x,
                    oy: imgPos.y,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const start = dragging.current;
                  if (!start) return;
                  setImgPos({
                    x: start.ox + (e.clientX - start.x),
                    y: start.oy + (e.clientY - start.y),
                  });
                }}
                onPointerUp={() => {
                  dragging.current = null;
                }}
                onDoubleClick={() => setImgScale((value) => (value > 1 ? 1 : 2))}
              >
                <img
                  src={loaded.dataUrl}
                  alt={loaded.name}
                  draggable={false}
                  style={{
                    transform: `translate(${imgPos.x}px, ${imgPos.y}px) scale(${imgScale})`,
                  }}
                />
              </div>
              <div className="fv-image-bar">
                <button type="button" className="btn" onClick={() => zoomImage(1 / 1.2)}>
                  −
                </button>
                <span className="fv-pdf-zoom">{Math.round(imgScale * 100)}%</span>
                <button type="button" className="btn" onClick={() => zoomImage(1.2)}>
                  +
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setImgScale(1);
                    setImgPos({ x: 0, y: 0 });
                  }}
                >
                  {en ? "Reset" : "Về mặc định"}
                </button>
                <a className="btn" href={loaded.dataUrl} download={loaded.name}>
                  {en ? "Download" : "Tải xuống"}
                </a>
              </div>
            </div>
          )}

          {loaded?.kind === "pdf" && (
            <PdfView base64={loaded.base64} name={loaded.name} path={loaded.path} />
          )}

          {loaded?.kind === "text" && (
            <>
              {loaded.markdown && (
                <div className="fv-switch" role="group">
                  <button
                    type="button"
                    className={`btn${markdownView === "rendered" ? " primary" : ""}`}
                    onClick={() => setMarkdownView("rendered")}
                  >
                    {en ? "Preview" : "Xem trước"}
                  </button>
                  <button
                    type="button"
                    className={`btn${markdownView === "source" ? " primary" : ""}`}
                    onClick={() => setMarkdownView("source")}
                  >
                    {en ? "Source" : "Nguồn"}
                  </button>
                </div>
              )}
              {loaded.markdown && markdownView === "rendered" && rendered != null ? (
                <div
                  className="fv-markdown"
                  // HTML do Rust render và ammonia làm sạch trước khi trả về.
                  dangerouslySetInnerHTML={{ __html: rendered }}
                />
              ) : (
                <CodeView
                  name={loaded.name}
                  text={loaded.text}
                  truncated={loaded.truncated}
                />
              )}
            </>
          )}

          {(loaded?.kind === "unsupported" ||
            loaded?.kind === "binary" ||
            loaded?.kind === "too_large") && (
            <div className="fv-notice">
              <p>{loaded.message}</p>
              {loaded.external && (
                <button type="button" className="btn primary" onClick={() => void openExternal()}>
                  {en ? "Open with another app" : "Mở bằng ứng dụng khác"}
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
