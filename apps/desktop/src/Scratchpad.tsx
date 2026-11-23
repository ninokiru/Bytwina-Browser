import { useEffect, useRef, useState } from "react";
import { getLang } from "./i18n";
import "./Scratchpad.css";

// Giấy nháp tạm (Scratchpad) - trang nội bộ bytwina://scratch
// - Textarea lớn, auto-save vào localStorage
// - Đếm từ/ký tự
// - Phím tắt Ctrl+S lưu, Ctrl+Shift+N mới (xóa)

const STORAGE_KEY = "bytwina.scratchpad";
const MAX_CHARS = 500_000;

export default function Scratchpad() {
  const en = getLang() === "en";
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(true);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<number | null>(null);

  // Tải nội dung khi mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setText(stored);
      updateCounts(stored);
    }
  }, []);

  // Auto-save khi gõ (debounce 1s)
  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, text);
      setSaved(true);
    }, 1000);
    setSaved(false);
    updateCounts(text);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [text]);

  function updateCounts(value: string) {
    setCharCount(value.length);
    const words = value.trim() ? value.trim().split(/\s+/).length : 0;
    setWordCount(words);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      localStorage.setItem(STORAGE_KEY, text);
      setSaved(true);
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (text.trim() && !window.confirm(en ? "Clear scratchpad?" : "Xóa giấy nháp?")) return;
      setText("");
      localStorage.removeItem(STORAGE_KEY);
      setSaved(true);
    }
  }

  function clear() {
    if (text.trim() && !window.confirm(en ? "Clear scratchpad?" : "Xóa giấy nháp?")) return;
    setText("");
    localStorage.removeItem(STORAGE_KEY);
    setSaved(true);
  }

  function copy() {
    navigator.clipboard.writeText(text).then(
      () => {},
      () => { textareaRef.current?.select(); document.execCommand("copy"); }
    );
  }

  return (
    <div className="scratch-root" onKeyDown={handleKeyDown}>
      <header className="scratch-head">
        <h1>{en ? "Scratchpad" : "Giấy nháp"}</h1>
        <div className="scratch-stats">
          <span>{wordCount} {en ? "words" : "từ"}</span>
          <span>{charCount.toLocaleString()} {en ? "chars" : "ký tự"}</span>
          <span className={saved ? "saved" : "saving"}>
            {saved ? (en ? "Saved" : "Đã lưu") : (en ? "Saving…" : "Đang lưu…")}
          </span>
        </div>
        <div className="scratch-actions">
          <button className="btn" onClick={copy} disabled={!text.trim()}>
            {en ? "Copy" : "Sao chép"}
          </button>
          <button className="btn danger" onClick={clear} disabled={!text.trim()}>
            {en ? "Clear" : "Xóa"}
          </button>
        </div>
      </header>
      <textarea
        ref={textareaRef}
        className="scratch-area"
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
        placeholder={en ? "Start typing… (Ctrl+S to save, Ctrl+Shift+N to clear)" : "Bắt đầu gõ… (Ctrl+S lưu, Ctrl+Shift+N xóa)"}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
      />
      <footer className="scratch-foot">
        <kbd>Ctrl+S</kbd> {en ? "Save" : "Lưu"} · <kbd>Ctrl+Shift+N</kbd> {en ? "New" : "Mới"} · {en ? "Auto-saves to this device" : "Tự lưu trên thiết bị này"}
      </footer>
    </div>
  );
}