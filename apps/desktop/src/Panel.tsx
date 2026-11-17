import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { cmd } from "./tabs";

interface Bookmark {
  id: number;
  title: string;
  url: string;
  folder: string;
}
interface HistoryItem {
  id: number;
  title: string;
  url: string;
  visitedAt: number;
}

export type PanelKind = "bookmarks" | "history" | "settings";

export default function Panel({
  kind,
  onClose,
  onNavigate,
}: {
  kind: PanelKind;
  onClose: () => void;
  onNavigate: (url: string) => void;
}) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [home, setHome] = useState("https://example.com/");

  const reload = async () => {
    if (kind === "bookmarks") {
      setBookmarks(((await cmd("bookmark_list")) as Bookmark[]) ?? []);
    } else if (kind === "history") {
      setHistory(
        ((await cmd("history_search", { query })) as HistoryItem[]) ?? [],
      );
    } else {
      const v = (await cmd("settings_get", { key: "homeUrl" })) as string | null;
      if (v) setHome(v);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, query]);

  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{title(kind)}</strong>
        <button onClick={onClose}>×</button>
      </div>

      {kind === "bookmarks" && (
        <ul style={list}>
          {bookmarks.map((b) => (
            <li key={b.id}>
              <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(b.url); }}>
                {b.title || b.url}
              </a>{" "}
              <button
                onClick={() => void cmd("bookmark_remove", { id: String(b.id) }).then(reload)}
              >
                xóa
              </button>
            </li>
          ))}
        </ul>
      )}

      {kind === "history" && (
        <>
          <input
            placeholder="Tìm trong lịch sử"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <ul style={list}>
            {history.map((h) => (
              <li key={h.id}>
                <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(h.url); }}>
                  {h.title || h.url}
                </a>
              </li>
            ))}
          </ul>
          <button onClick={() => void cmd("history_clear").then(reload)}>Xóa toàn bộ lịch sử</button>
        </>
      )}

      {kind === "settings" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          Trang chủ
          <input
            value={home}
            onChange={(e) => setHome(e.target.value)}
            onBlur={() => void cmd("settings_set", { key: "homeUrl", value: home })}
          />
        </label>
      )}
    </div>
  );
}

function title(kind: PanelKind): string {
  return kind === "bookmarks" ? "Đã lưu" : kind === "history" ? "Lịch sử" : "Cài đặt";
}

const panel: CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  width: 320,
  maxHeight: "calc(100vh - 16px)",
  overflowY: "auto",
  background: "#fff",
  border: "1px solid #d0d0d6",
  borderRadius: 8,
  boxShadow: "0 4px 16px rgba(0,0,0,.15)",
  padding: 10,
  fontSize: 13,
};
const list: CSSProperties = { margin: "8px 0", paddingLeft: 18, display: "grid", gap: 4 };
