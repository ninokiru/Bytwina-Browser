import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { getLang } from "./i18n";
import { cmd } from "./tabs";
import "./QRCodeView.css";

// Tạo QR code cho URL hiện tại. Mở bằng Ctrl+Shift+Q hoặc menu ⋮ > QR code.
// Dùng thư viện qrcode (đã cài) chạy hoàn toàn cục bộ, không gửi URL ra mạng.

interface Props {
  url: string;
  onClose: () => void;
}

export default function QRCodeView({ url, onClose }: Props) {
  const en = getLang() === "en";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setError("");
    QRCode.toCanvas(canvasRef.current!, url, {
      width: 256,
      margin: 2,
      color: { dark: "#1a1a2e", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then(() => {})
      .catch((e: unknown) => {
        if (alive) setError(en ? "Could not generate QR code" : "Không tạo được mã QR");
        console.error(e);
      });
    return () => { alive = false; };
  }, [url, en]);

  const copyImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png")
      );
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(en ? "Could not copy image" : "Không chép được ảnh");
    }
  };

  const downloadImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `qrcode-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const openInNewTab = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(`<img src="${canvas.toDataURL("image/png")}" alt="QR code" style="max-width:100%;height:auto;">`);
      win.document.close();
    }
  };

  return (
    <div className="qr-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qr-panel" role="dialog" aria-modal="true" aria-label={en ? "QR Code" : "Mã QR"}>
        <header className="qr-head">
          <h3>{en ? "QR Code for this page" : "Mã QR cho trang này"}</h3>
          <button className="qr-close" onClick={onClose} aria-label={en ? "Close" : "Đóng"}>✕</button>
        </header>
        <div className="qr-body">
          {error ? (
            <p className="qr-error">{error}</p>
          ) : (
            <canvas ref={canvasRef} className="qr-canvas" />
          )}
          <p className="qr-url" title={url}>{url}</p>
        </div>
        <footer className="qr-foot">
          <button className="qr-btn" onClick={copyImage}>
            {copied ? (en ? "Copied!" : "Đã chép!") : en ? "Copy image" : "Chép ảnh"}
          </button>
          <button className="qr-btn" onClick={downloadImage}>
            {en ? "Download" : "Tải xuống"}
          </button>
          <button className="qr-btn" onClick={openInNewTab}>
            {en ? "Open in new tab" : "Mở tab mới"}
          </button>
        </footer>
      </div>
    </div>
  );
}