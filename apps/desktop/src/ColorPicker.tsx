import { useEffect, useRef, useState } from "react";
import { getLang } from "./i18n";
import { cmd } from "./tabs";
import "./ColorPicker.css";

// Color Picker: lấy màu từ trang web.
// Ưu tiên EyeDropper API (Chrome 95+), fallback: chụp màn hình qua canvas (cần quyền).
// Mở bằng Ctrl+Shift+C hoặc menu ⋮ > Color Picker.

interface Props {
  onClose: () => void;
}

interface ColorInfo {
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

async function pickWithEyeDropper(): Promise<string | null> {
  if (typeof window === "undefined" || !(window as any).EyeDropper) return null;
  try {
    const eyeDropper = new (window as any).EyeDropper();
    const result = await eyeDropper.open();
    return result.sRGBHex;
  } catch {
    return null;
  }
}

async function pickWithCanvas(): Promise<string | null> {
  // Fallback: yêu cầu chụp màn hình (getDisplayMedia), vẽ lên canvas, lấy pixel giữa.
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { track.stop(); return null; }
    ctx.drawImage(video, 0, 0);
    track.stop();
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const pixel = ctx.getImageData(centerX, centerY, 1, 1).data;
    return rgbToHex(pixel[0], pixel[1], pixel[2]);
  } catch {
    return null;
  }
}

export default function ColorPicker({ onClose }: Props) {
  const en = getLang() === "en";
  const [color, setColor] = useState<ColorInfo | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const historyRef = useRef<string[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("bytwina.colorHistory");
    if (saved) {
      try { historyRef.current = JSON.parse(saved); } catch {}
    }
  }, []);

  const addToHistory = (hex: string) => {
    const hist = historyRef.current;
    const idx = hist.indexOf(hex);
    if (idx >= 0) hist.splice(idx, 1);
    hist.unshift(hex);
    if (hist.length > 20) hist.pop();
    localStorage.setItem("bytwina.colorHistory", JSON.stringify(hist));
  };

  const startPick = async () => {
    setPicking(true);
    setError("");
    let hex: string | null = null;
    // Ưu tiên EyeDropper
    hex = await pickWithEyeDropper();
    if (!hex) hex = await pickWithCanvas();
    setPicking(false);
    if (hex) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const info = { hex: hex.toUpperCase(), rgb: { r, g, b }, hsl: rgbToHsl(r, g, b) };
      setColor(info);
      addToHistory(hex);
    } else {
      setError(en ? "Could not pick color" : "Không lấy được màu");
    }
  };

  const copyColor = async (format: "hex" | "rgb" | "hsl") => {
    if (!color) return;
    let text = "";
    if (format === "hex") text = color.hex;
    else if (format === "rgb") text = `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`;
    else text = `hsl(${color.hsl.h}, ${color.hsl.s}%, ${color.hsl.l}%)`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select(); document.execCommand("copy");
      ta.remove();
    }
  };

  const openExternal = () => {
    if (!color) return;
    const url = `https://www.google.com/search?q=${encodeURIComponent(color.hex)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="cp-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cp-panel" role="dialog" aria-modal="true" aria-label={en ? "Color Picker" : "Chọn màu"}>
        <header className="cp-head">
          <h3>{en ? "Color Picker" : "Chọn màu"}</h3>
          <button className="cp-close" onClick={onClose} aria-label={en ? "Close" : "Đóng"}>✕</button>
        </header>
        <div className="cp-body">
          {error && <p className="cp-error">{error}</p>}
          <div className="cp-main">
            <button
              className={`cp-pick-btn${picking ? " picking" : ""}`}
              onClick={startPick}
              disabled={picking}
            >
              {picking ? (en ? "Picking…" : "Đang chọn…") : (en ? "Pick Color" : "Chọn màu")}
            </button>
            {color && (
              <div className="cp-color-info">
                <div className="cp-swatch" style={{ backgroundColor: color.hex }} />
                <div className="cp-formats">
                  <div className="cp-format">
                    <label>{en ? "HEX" : "HEX"}</label>
                    <button onClick={() => copyColor("hex")} title={en ? "Copy" : "Sao chép"}>
                      {color.hex}
                    </button>
                  </div>
                  <div className="cp-format">
                    <label>{en ? "RGB" : "RGB"}</label>
                    <button onClick={() => copyColor("rgb")} title={en ? "Copy" : "Sao chép"}>
                      rgb({color.rgb.r}, {color.rgb.g}, {color.rgb.b})
                    </button>
                  </div>
                  <div className="cp-format">
                    <label>{en ? "HSL" : "HSL"}</label>
                    <button onClick={() => copyColor("hsl")} title={en ? "Copy" : "Sao chép"}>
                      hsl({color.hsl.h}, {color.hsl.s}%, {color.hsl.l}%)
                    </button>
                  </div>
                </div>
                <button className="cp-external" onClick={openExternal}>
                  {en ? "Search this color" : "Tìm màu này"}
                </button>
              </div>
            )}
          </div>
          {historyRef.current.length > 0 && (
            <div className="cp-history">
              <h4>{en ? "Recent" : "Gần đây"}</h4>
              <div className="cp-history-list">
                {historyRef.current.map((hex) => (
                  <button
                    key={hex}
                    className="cp-history-item"
                    style={{ backgroundColor: hex }}
                    onClick={() => {
                      const r = parseInt(hex.slice(1, 3), 16);
                      const g = parseInt(hex.slice(3, 5), 16);
                      const b = parseInt(hex.slice(5, 7), 16);
                      setColor({ hex: hex.toUpperCase(), rgb: { r, g, b }, hsl: rgbToHsl(r, g, b) });
                    }}
                    title={hex}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <footer className="cp-foot">
          <kbd>Ctrl+Shift+C</kbd> {en ? "to open" : "để mở"}
        </footer>
      </div>
    </div>
  );
}