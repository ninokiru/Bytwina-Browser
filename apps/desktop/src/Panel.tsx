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

export type PanelKind = "bookmarks" | "history" | "downloads" | "settings";

interface DownloadItem {
  id: number;
  url: string;
  path: string;
  success: boolean;
  finishedAt: number;
}

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
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [diag, setDiag] = useState<string>("");
  const [query, setQuery] = useState("");
  const [home, setHome] = useState("https://example.com/");

  const reload = async () => {
    if (kind === "bookmarks") {
      setBookmarks(((await cmd("bookmark_list")) as Bookmark[]) ?? []);
    } else if (kind === "history") {
      setHistory(
        ((await cmd("history_search", { query })) as HistoryItem[]) ?? [],
      );
    } else if (kind === "downloads") {
      setDownloads(((await cmd("downloads_list")) as DownloadItem[]) ?? []);
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

      {kind === "downloads" && (
        <>
          <ul style={list}>
            {downloads.map((d) => (
              <li key={d.id} title={d.path}>
                {d.success ? "✓ " : "✗ "}
                {d.path ? d.path.split(/[\\/]/).pop() : d.url}
              </li>
            ))}
          </ul>
          <button onClick={() => void cmd("downloads_clear").then(reload)}>Xóa danh sách</button>
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

      {kind === "settings" && (
        <button
          style={{ marginTop: 8 }}
          onClick={() => void cmd("clear_data")}
        >
          Xóa dữ liệu duyệt web (lịch sử, tải xuống, phiên)
        </button>
      )}

      {kind === "settings" && (
        <>
          <button
            style={{ marginTop: 8 }}
            onClick={() =>
              void cmd("diagnostics").then((d) => setDiag(JSON.stringify(d, null, 2)))
            }
          >
            Chẩn đoán
          </button>
          {diag && <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{diag}</pre>}
        </>
      )}
    </div>
  );
}

function title(kind: PanelKind): string {
  if (kind === "bookmarks") return "Đã lưu";
  if (kind === "history") return "Lịch sử";
  if (kind === "downloads") return "Tải xuống";
  return "Cài đặt";
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
