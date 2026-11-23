import { useEffect, useMemo, useRef, useState } from "react";
import { getLang } from "./i18n";

// Trình xem PDF dùng pdf.js (đã có trong dependencies) thay cho iframe mặc định
// của WebView2: có zoom, xoay, nền tối, chép chữ và tải xuống. Tệp được giải mã
// từ base64 do Rust trả về, không đi qua file:// hay mạng.
// pdf.js được lazy-load chỉ khi mở file PDF đầu tiên để giảm kích thước bundle.
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback cho webview không cấp quyền clipboard.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export default function PdfView({ base64, name }: { base64: string; name: string }) {
  const en = getLang() === "en";
  const [doc, setDoc] = useState<any>(null);
  const [pdfjsModule, setPdfjsModule] = useState<any>(null);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const [fit, setFit] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const blobUrl = useRef("");
  const pageText = useRef("");

  // Lazy-load pdf.js chỉ khi component mount (giảm bundle size ban đầu).
  useEffect(() => {
    let alive = true;
    void import("pdfjs-dist").then((mod) => {
      if (!alive) return;
      setPdfjsModule(mod);
      // Trỏ worker đến file worker minified đi kèm pdf.js.
      try {
        mod.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      } catch {
        // Nếu không trỏ được worker, pdf.js sẽ dùng mặc định (có thể lỗi ở một số môi trường).
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Nạp tài liệu một lần cho mỗi tệp; dọn blob URL và tài liệu khi đổi tệp.
  useEffect(() => {
    if (!pdfjsModule) return;
    let alive = true;
    setDoc(null);
    setError("");
    setNotice("");
    setPageNum(1);
    setRotation(0);
    setFit(true);
    const bytes = decodeBase64(base64);
    const url = URL.createObjectURL(
      new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
    );
    blobUrl.current = url;
    const task = pdfjsModule.getDocument({ data: bytes });
    task.promise
      .then((loaded: any) => {
        if (alive) setDoc(loaded);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(
          en
            ? `Could not open the PDF: ${e instanceof Error ? e.message : String(e)}`
            : `Không mở được PDF: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    return () => {
      alive = false;
      void task.destroy();
      URL.revokeObjectURL(url);
    };
  }, [base64, en]);

  // Vừa khung: tính lại tỉ lệ theo bề rộng vùng xem mỗi khi đổi trang/xoay.
  useEffect(() => {
    if (!doc || !fit || !stageRef.current) return;
    let alive = true;
    void doc.getPage(pageNum).then((page: any) => {
      if (!alive) return;
      const base = page.getViewport({ scale: 1, rotation });
      const width = stageRef.current?.clientWidth ?? 0;
      if (width > 64) {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (width - 40) / base.width));
        setScale(next);
      }
    });
    return () => {
      alive = false;
    };
  }, [doc, fit, pageNum, rotation]);

  // Vẽ trang vào canvas và dựng lớp chữ để chọn/copy.
  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let alive = true;
    let task: any = null;
    setNotice("");
    void (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (!alive) return;
        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        // pdf.js v6 yêu cầu `canvas: null` khi dùng canvasContext.
        task = page.render({
          canvas: null,
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });
        await task.promise;
        if (!alive) return;

        // Lớp chữ trong suốt phủ lên canvas: bôi đen để chọn, Ctrl+C để copy.
        const textContent = await page.getTextContent();
        if (!alive) return;
        pageText.current = textContent.items
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        const layer = textRef.current;
        const pageBox = pageRef.current;
        if (!layer || !pageBox) return;
        pageBox.style.width = `${Math.round(viewport.width)}px`;
        pageBox.style.height = `${Math.round(viewport.height)}px`;
        layer.style.width = `${Math.round(viewport.width)}px`;
        layer.style.height = `${Math.round(viewport.height)}px`;
        layer.style.setProperty("--total-scale-factor", String(viewport.scale));
        layer.style.setProperty("--scale-round-x", "1px");
        layer.style.setProperty("--scale-round-y", "1px");
        layer.replaceChildren();
        try {
          const textLayer = new pdfjsModule.TextLayer({
            textContentSource: textContent,
            container: layer,
            viewport,
          });
          await textLayer.render();
        } catch {
          // Lớp chữ lỗi không được kéo cả trình xem xuống; vẫn còn nút chép chữ.
          layer.replaceChildren();
        }
      } catch (e: unknown) {
        if (!alive) return;
        // Hủy render do đổi trang/zoom là bình thường, không báo lỗi.
        if (e instanceof Error && e.name === "RenderingCancelledException") return;
        setError(
          en
            ? `Could not render the page: ${e instanceof Error ? e.message : String(e)}`
            : `Không vẽ được trang: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, pageNum, scale, rotation, en]);

  const zoom = (factor: number) => {
    setFit(false);
    setScale((value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value * factor)));
  };

  const doCopy = async () => {
    if (!pageText.current) return;
    const ok = await copyText(pageText.current);
    setNotice(
      ok
        ? en
          ? "Page text copied."
          : "Đã chép chữ của trang."
        : en
          ? "Could not copy text."
          : "Không chép được chữ.",
    );
  };

  const total = doc?.numPages ?? 0;
  const percent = useMemo(() => Math.round(scale * 100), [scale]);

  if (!doc && !error) {
    return <p className="fv-empty">{en ? "Loading PDF…" : "Đang tải PDF…"}</p>;
  }
  if (error && !doc) {
    return <p className="fv-error">{error}</p>;
  }

  return (
    <div className="fv-pdf">
      <div className="fv-pdf-bar">
        <button
          type="button"
          className="btn"
          disabled={pageNum <= 1}
          onClick={() => setPageNum((p) => Math.max(1, p - 1))}
          aria-label={en ? "Previous page" : "Trang trước"}
        >
          ‹
        </button>
        <span className="fv-pdf-count">
          <input
            type="number"
            min={1}
            max={total || 1}
            value={pageNum}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next) && total) {
                setPageNum(Math.min(total, Math.max(1, Math.round(next))));
              }
            }}
            aria-label={en ? "Page number" : "Số trang"}
          />
          / {total || "?"}
        </span>
        <button
          type="button"
          className="btn"
          disabled={!total || pageNum >= total}
          onClick={() => setPageNum((p) => Math.min(total || p, p + 1))}
          aria-label={en ? "Next page" : "Trang sau"}
        >
          ›
        </button>
        <span className="fv-pdf-sep" />
        <button type="button" className="btn" onClick={() => zoom(1 / 1.2)} aria-label="−">
          −
        </button>
        <span className="fv-pdf-zoom">{percent}%</span>
        <button type="button" className="btn" onClick={() => zoom(1.2)} aria-label="+">
          +
        </button>
        <button
          type="button"
          className={`btn${fit ? " primary" : ""}`}
          onClick={() => setFit(true)}
        >
          {en ? "Fit width" : "Vừa khung"}
        </button>
        <button type="button" className="btn" onClick={() => setRotation((r) => (r + 90) % 360)}>
          {en ? "Rotate" : "Xoay"}
        </button>
        <button
          type="button"
          className={`btn${dark ? " primary" : ""}`}
          aria-pressed={dark}
          onClick={() => setDark((v) => !v)}
        >
          {en ? "Dark paper" : "Nền tối"}
        </button>
        <button type="button" className="btn" onClick={() => void doCopy()}>
          {en ? "Copy text" : "Chép chữ"}
        </button>
        <a className="btn" href={blobUrl.current} download={name}>
          {en ? "Download" : "Tải xuống"}
        </a>
      </div>

      {notice && <p className="fv-note">{notice}</p>}
      {error && <p className="fv-error">{error}</p>}

      <div className="fv-pdf-stage" ref={stageRef}>
        <div className={`fv-pdf-page${dark ? " fv-pdf-dark" : ""}`} ref={pageRef}>
          <canvas ref={canvasRef} />
          <div className="fv-text-layer" ref={textRef} />
        </div>
      </div>
    </div>
  );
}
