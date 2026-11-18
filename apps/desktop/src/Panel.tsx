import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { cmd, type TabInfo } from "./tabs";
import { t, useLang, type Key } from "./i18n";
import Settings from "./Settings";

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

interface ReadingItem {
  id: number;
  title: string;
  url: string;
  addedAt: number;
}

export type PanelKind = "bookmarks" | "history" | "downloads" | "reading" | "tabs" | "settings";

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
  privateMode,
  onHomeChange,
}: {
  kind: PanelKind;
  onClose: () => void;
  onNavigate: (url: string) => void;
  privateMode: boolean;
  onHomeChange: (url: string) => void;
}) {
  useLang();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [tabList, setTabList] = useState<TabInfo[]>([]);
  const [tabQuery, setTabQuery] = useState("");
  const [reading, setReading] = useState<ReadingItem[]>([]);
  const [siteHost, setSiteHost] = useState("");
  const [query, setQuery] = useState("");

  const reload = async () => {
    if (kind === "bookmarks") {
      setBookmarks(((await cmd("bookmark_list")) as Bookmark[]) ?? []);
    } else if (kind === "history") {
      setHistory(((await cmd("history_search", { query })) as HistoryItem[]) ?? []);
    } else if (kind === "tabs") {
      const s = (await cmd("state")) as { tabs: TabInfo[] } | null;
      setTabList(s?.tabs ?? []);
    } else if (kind === "reading") {
      setReading(((await cmd("reading_list")) as ReadingItem[]) ?? []);
    } else if (kind === "downloads") {
      setDownloads(((await cmd("downloads_list")) as DownloadItem[]) ?? []);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, query]);

  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{t(titleKey(kind))}</strong>
        <button onClick={onClose} title={t("panel.close")}>×</button>
      </div>

      {kind === "bookmarks" && (
        <ul style={list}>
          {bookmarks.map((b) => (
            <li key={b.id}>
              <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(b.url); }}>
                {b.title || b.url}
              </a>{" "}
              <button onClick={() => void cmd("bookmark_remove", { id: String(b.id) }).then(reload)}>
                {t("panel.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {kind === "history" && (
        <>
          <input
            placeholder={t("panel.searchHistory")}
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
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            <input
              placeholder={t("panel.siteHost")}
              value={siteHost}
              onChange={(e) => setSiteHost(e.target.value)}
              style={{ flex: 1 }}
            />
            <button onClick={() => void cmd("site_clear_data", { host: siteHost }).then(reload)}>
              {t("panel.clearSite")}
            </button>
          </div>
          <button onClick={() => void cmd("history_clear").then(reload)}>
            {t("panel.clearHistory")}
          </button>
        </>
      )}

      {kind === "tabs" && (
        <>
          <input
            placeholder={t("panel.searchTabs")}
            value={tabQuery}
            onChange={(e) => setTabQuery(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box" }}
          />
          <ul style={list}>
            {tabList
              .filter((tb) => {
                const q = tabQuery.trim().toLowerCase();
                return !q || tb.title.toLowerCase().includes(q) || tb.url.toLowerCase().includes(q);
              })
              .map((tb) => (
                <li key={tb.id}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      void cmd("activate_tab", { id: String(tb.id) });
                      onClose();
                    }}
                  >
                    {tb.title || tb.url}
                  </a>
                </li>
              ))}
          </ul>
        </>
      )}

      {kind === "reading" && (
        <ul style={list}>
          {reading.map((r) => (
            <li key={r.id}>
              <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(r.url); }}>
                {r.title || r.url}
              </a>{" "}
              <button onClick={() => void cmd("reading_remove", { id: String(r.id) }).then(reload)}>
                {t("panel.remove")}
              </button>
            </li>
          ))}
        </ul>
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
          <button onClick={() => void cmd("downloads_clear").then(reload)}>
            {t("panel.clearList")}
          </button>
        </>
      )}

      {kind === "settings" && (
        <div style={{ marginTop: 8 }}>
          <Settings privateMode={privateMode} onHomeChange={onHomeChange} />
        </div>
      )}
    </div>
  );
}

function titleKey(kind: PanelKind): Key {
  switch (kind) {
    case "bookmarks":
      return "title.bookmarks";
    case "history":
      return "title.history";
    case "downloads":
      return "title.downloads";
    case "tabs":
      return "title.tabs";
    case "reading":
      return "title.reading";
    default:
      return "title.settings";
  }
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
