import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cmd, type TabInfo } from "./tabs";
import { t, useLang, type Key } from "./i18n";
import Settings from "./Settings";
import {
  AlertIcon,
  BookIcon,
  BookTextIcon,
  CheckCircleIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  GridIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  TrashIcon,
} from "./Icons";

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

export type PanelKind =
  | "bookmarks"
  | "history"
  | "downloads"
  | "reading"
  | "tabs"
  | "settings"
  | "dictionary";

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
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [word, setWord] = useState("");
  const [dictLang, setDictLang] = useState<"en" | "vi">("en");

  // Gõ tới đâu tìm tới đó sẽ bắn một truy vấn DB mỗi phím; chờ 250ms.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Mở trang Wiktionary của từ trong tab mới rồi kích hoạt tab đó.
  const lookup = () => {
    const w = word.trim();
    if (!w) return;
    const base =
      dictLang === "vi" ? "https://vi.wiktionary.org/wiki/" : "https://en.wiktionary.org/wiki/";
    void cmd("new_tab", { url: base + encodeURIComponent(w) }).then((r) => {
      const tabId = (r as { tabId: number }).tabId;
      return cmd("activate_tab", { id: String(tabId) });
    });
    onClose();
  };

  const reload = async () => {
    if (kind === "bookmarks") {
      setBookmarks(((await cmd("bookmark_list")) as Bookmark[]) ?? []);
    } else if (kind === "history") {
      setHistory(((await cmd("history_search", { query: debouncedQuery })) as HistoryItem[]) ?? []);
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
  }, [kind, debouncedQuery]);

  const remove = (command: string, id: number) => {
    void cmd(command, { id: String(id) }).then(reload);
  };

  const visibleTabs = tabList.filter((tb) => {
    const q = tabQuery.trim().toLowerCase();
    return !q || tb.title.toLowerCase().includes(q) || tb.url.toLowerCase().includes(q);
  });

  let body: ReactNode;
  let foot: ReactNode = null;

  switch (kind) {
    case "bookmarks":
      body =
        bookmarks.length === 0 ? (
          <EmptyState icon={<StarIcon />} text={t("panel.emptyBookmarks")} />
        ) : (
          <ul className="list">
            {bookmarks.map((b) => (
              <li key={b.id} className="list-row">
                <span className="row-icon">
                  <StarIcon />
                </span>
                <button type="button" className="list-main" onClick={() => onNavigate(b.url)}>
                  <span className="list-title">{b.title || b.url}</span>
                  <span className="list-sub">{b.folder ? `${b.folder} · ${b.url}` : b.url}</span>
                </button>
                <button
                  type="button"
                  className="row-remove"
                  title={t("panel.remove")}
                  onClick={() => remove("bookmark_remove", b.id)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        );
      break;

    case "history":
      body =
        history.length === 0 ? (
          <EmptyState icon={<ClockIcon />} text={t("panel.emptyHistory")} />
        ) : (
          <ul className="list">
            {history.map((h) => (
              <li key={h.id} className="list-row">
                <span className="row-icon">
                  <ClockIcon />
                </span>
                <button type="button" className="list-main" onClick={() => onNavigate(h.url)}>
                  <span className="list-title">{h.title || h.url}</span>
                  <span className="list-sub">{h.url}</span>
                </button>
              </li>
            ))}
          </ul>
        );
      foot = (
        <>
          <div className="row-inline">
            <input
              className="field"
              placeholder={t("panel.siteHost")}
              value={siteHost}
              onChange={(e) => setSiteHost(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => void cmd("site_clear_data", { host: siteHost }).then(reload)}
            >
              {t("panel.clearSite")}
            </button>
          </div>
          <button
            type="button"
            className="btn danger block"
            onClick={() => void cmd("history_clear").then(reload)}
          >
            <TrashIcon /> {t("panel.clearHistory")}
          </button>
        </>
      );
      break;

    case "tabs":
      body = (
        <>
          <label className="search-box">
            <SearchIcon />
            <input
              placeholder={t("panel.searchTabs")}
              value={tabQuery}
              onChange={(e) => setTabQuery(e.target.value)}
            />
          </label>
          {visibleTabs.length === 0 ? (
            <EmptyState icon={<GridIcon />} text={t("panel.emptyTabs")} />
          ) : (
            <ul className="list">
              {visibleTabs.map((tb) => (
                <li key={tb.id} className="list-row">
                  <span className="row-icon">
                    <GridIcon />
                  </span>
                  <button
                    type="button"
                    className="list-main"
                    onClick={() => {
                      void cmd("activate_tab", { id: String(tb.id) });
                      onClose();
                    }}
                  >
                    <span className="list-title">{tb.title || tb.url}</span>
                    <span className="list-sub">{tb.url}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      );
      break;

    case "reading":
      body =
        reading.length === 0 ? (
          <EmptyState icon={<BookIcon />} text={t("panel.emptyReading")} />
        ) : (
          <ul className="list">
            {reading.map((r) => (
              <li key={r.id} className="list-row">
                <span className="row-icon">
                  <BookIcon />
                </span>
                <button type="button" className="list-main" onClick={() => onNavigate(r.url)}>
                  <span className="list-title">{r.title || r.url}</span>
                  <span className="list-sub">{r.url}</span>
                </button>
                <button
                  type="button"
                  className="row-remove"
                  title={t("panel.remove")}
                  onClick={() => remove("reading_remove", r.id)}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        );
      break;

    case "downloads":
      body =
        downloads.length === 0 ? (
          <EmptyState icon={<DownloadIcon />} text={t("panel.emptyDownloads")} />
        ) : (
          <ul className="list">
            {downloads.map((d) => (
              <li key={d.id} className="list-row" title={d.path}>
                <span className={`row-icon ${d.success ? "ok" : "fail"}`}>
                  {d.success ? <CheckCircleIcon /> : <AlertIcon />}
                </span>
                <span className="list-main">
                  <span className="list-title">{d.path ? fileName(d.path) : d.url}</span>
                  <span className="list-sub">
                    {d.success ? t("panel.downloadOk") : t("panel.downloadFail")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        );
      foot = (
        <button
          type="button"
          className="btn danger block"
          onClick={() => void cmd("downloads_clear").then(reload)}
        >
          <TrashIcon /> {t("panel.clearList")}
        </button>
      );
      break;

    case "dictionary":
      body = (
        <div className="dict">
          <input
            className="field"
            placeholder={t("dict.placeholder")}
            value={word}
            autoFocus
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") lookup();
            }}
          />
          <select value={dictLang} onChange={(e) => setDictLang(e.target.value as "en" | "vi")}>
            <option value="en">{t("dict.en")}</option>
            <option value="vi">{t("dict.vi")}</option>
          </select>
          <button type="button" className="btn primary block" onClick={lookup}>
            <BookTextIcon /> {t("dict.lookup")}
          </button>
        </div>
      );
      break;

    default:
      body = <Settings privateMode={privateMode} onHomeChange={onHomeChange} />;
      break;
  }

  return (
    <div className="panel" role="dialog" aria-label={t(titleKey(kind))}>
      <div className="panel-head">
        <div className="panel-title">
          {titleIcon(kind)} {t(titleKey(kind))}
        </div>
        <button type="button" className="icon-btn" title={t("panel.close")} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="panel-body">
        {kind === "history" && (
          <label className="search-box">
            <SearchIcon />
            <input
              placeholder={t("panel.searchHistory")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
        {body}
      </div>
      {foot && <div className="panel-foot">{foot}</div>}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="empty">
      {icon}
      <span>{text}</span>
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
    case "dictionary":
      return "title.dictionary";
    default:
      return "title.settings";
  }
}

function titleIcon(kind: PanelKind): ReactNode {
  switch (kind) {
    case "bookmarks":
      return <StarIcon />;
    case "history":
      return <ClockIcon />;
    case "downloads":
      return <DownloadIcon />;
    case "tabs":
      return <GridIcon />;
    case "reading":
      return <BookIcon />;
    case "dictionary":
      return <BookTextIcon />;
    default:
      return <SettingsIcon />;
  }
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
