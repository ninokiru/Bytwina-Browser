import { useEffect, useState } from "react";
import { cmd } from "./tabs";
import { getLang } from "./i18n";
import "./FindBar.css";

// Tìm trong trang (Ctrl+F): inject script tìm và tô màu vào webview tab hiện tại.
// Tất cả IPC đi qua lệnh duy nhất `browser_command` (chỉ toolbar được gọi).

interface Props {
  tabId: number | null;
  onClose: () => void;
}

export default function FindBar({ tabId, onClose }: Props) {
  const en = getLang() === "en";
  const [text, setText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [error, setError] = useState("");

  const doFind = async (forward: boolean) => {
    if (!text.trim() || tabId == null) return;
    setError("");
    try {
      await cmd("webview_find", {
        id: String(tabId),
        text,
        forward,
        caseSensitive,
        highlightAll: true,
      });
    } catch (e) {
      setError(en ? "Find failed" : "Tìm kiếm lỗi");
      console.error(e);
    }
  };

  const doFindNext = (forward: boolean) => {
    if (!text.trim() || tabId == null) return;
    setError("");
    void cmd("webview_find_next", {
      id: String(tabId),
      forward,
    }).catch(() => setError(en ? "Find failed" : "Tìm kiếm lỗi"));
  };

  const doClear = () => {
    if (tabId == null) return;
    setText("");
    setError("");
    void cmd("webview_find_clear", { id: String(tabId) }).catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        doClear();
        onClose();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void doFind(true);
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void doFind(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [text, onClose, doClear]);

  return (
    <div className="findbar" role="dialog" aria-modal="true" aria-label={en ? "Find on page" : "Tìm trong trang"}>
      <div className="findbar-inner">
        <input
          className="find-input"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={en ? "Find on page…" : "Tìm trong trang…"}
          aria-label={en ? "Find on page" : "Tìm trong trang"}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
        />
        <label className="find-case">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          {en ? "Match case" : "Phân hoa thường"}
        </label>
        <div className="find-buttons">
          <button
            className="find-btn"
            onClick={() => void doFind(false)}
            title={en ? "Find previous (Shift+Enter)" : "Tìm trước (Shift+Enter)"}
          >
            ▲
          </button>
          <button
            className="find-btn"
            onClick={() => void doFind(true)}
            title={en ? "Find next (Enter)" : "Tìm tiếp (Enter)"}
          >
            ▼
          </button>
          <button className="find-btn find-close" onClick={() => void doClear()} onMouseDown={(e) => e.preventDefault()} title={en ? "Close" : "Đóng"}>
            ✕
          </button>
        </div>
        {error && <span className="find-error">{error}</span>}
      </div>
    </div>
  );
}