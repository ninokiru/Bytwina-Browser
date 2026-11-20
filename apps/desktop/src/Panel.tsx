import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cmd, type TabInfo } from "./tabs";
import { t, useLang, type Key } from "./i18n";
import Settings from "./Settings";
import {
  AlertIcon,
  BookIcon,
  BookTextIcon,
  BookmarkPlusIcon,
  CheckCircleIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  GlassesIcon,
  GridIcon,
  KeyIcon,
  MoreIcon,
  PaletteIcon,
  PlusIcon,
  PowerIcon,
  SearchIcon,
  SettingsIcon,
  SplitIcon,
  StarIcon,
  TrashIcon,
  UserIcon,
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
  | "dictionary"
  | "menu";

interface DownloadItem {
  id: number;
  url: string;
  path: string;
  success: boolean;
  finishedAt: number;
}

/// Những gì menu ⋮ cần từ App: dữ liệu trang đang mở + hành động thật.
/// Để riêng một object vì menu ngày càng có hàng không phải "mở bảng".
export interface MenuActions {
  url: string;
  title: string;
  zoom: number;
  vertical: boolean;
  settingsPage: string;
  onNewTab: () => void;
  onBookmark: (url: string, title: string) => void;
  onZoom: (percent: number) => void;
  onVertical: (vertical: boolean) => void;
  onOpenSettings: (page: string) => void;
  onExit: () => void;
}

// Bậc thu phóng như Chrome; ngoài danh sách thì giữ nguyên.
const ZOOMS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

function stepZoom(current: number, dir: 1 | -1): number {
  // Phóng to: bậc nhỏ nhất lớn hơn. Thu nhỏ: bậc LỚN NHẤT nhỏ hơn, nên đảo thứ tự.
  const ordered = [...ZOOMS].sort((a, b) => (dir === 1 ? a - b : b - a));
  return ordered.find((z) => (dir === 1 ? z > current : z < current)) ?? current;
}

export default function Panel({
  kind,
  onClose,
  onNavigate,
  onOpen,
  privateMode,
  onHomeChange,
  menu,
}: {
  kind: PanelKind;
  onClose: () => void;
  onNavigate: (url: string) => void;
  onOpen: (kind: PanelKind) => void;
  privateMode: boolean;
  onHomeChange: (url: string) => void;
  menu?: MenuActions;
}) {
  useLang();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [tabList, setTabList] = useState<TabInfo[]>([]);
  const [activeTab, setActiveTab] = useState<number | null>(null);
  const [splitTab, setSplitTab] = useState<number | null>(null);
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
      const s = (await cmd("state")) as {
        tabs: TabInfo[];
        activeTab: number | null;
        splitTab: number | null;
      } | null;
      setTabList(s?.tabs ?? []);
      setActiveTab(s?.activeTab ?? null);
      setSplitTab(s?.splitTab ?? null);
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
                  <button
                    type="button"
                    className={`split-btn${tb.id === splitTab ? " on" : ""}`}
                    title={
                      tb.id === splitTab ? t("panel.splitClear") : t("panel.splitRight")
                    }
                    disabled={tb.id === activeTab}
                    onClick={() => {
                      void cmd("split_set", {
                        id: tb.id === splitTab ? "" : String(tb.id),
                      }).then(onClose);
                    }}
                  >
                    <SplitIcon />
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

    case "menu":
      body = (
        <div className="menu-list">
          <MenuItem
            icon={<PlusIcon />}
            label={t("menu.newTab")}
            shortcut="Ctrl+T"
            onClick={() => menu?.onNewTab()}
          />
          <button
            type="button"
            className={`menu-row${privateMode ? " on" : ""}`}
            onClick={() => {
              void cmd("private_set", { on: privateMode ? "0" : "1" });
              onClose();
            }}
          >
            <GlassesIcon />
            <span className="menu-label">{t("bar.privateToggle")}</span>
            <kbd className="menu-key">Ctrl+Shift+N</kbd>
          </button>
          <div className="menu-sep" />
          {/* Bytwina chưa có tài khoản: hàng này nói đúng sự thật, không giả "đã đăng nhập". */}
          <div className="menu-profile">
            <span className="menu-avatar">
              <UserIcon />
            </span>
            <span className="menu-profile-text">
              <strong>{t("menu.guestProfile")}</strong>
              <small>{t("menu.noAccounts")}</small>
            </span>
          </div>
          <div className="menu-sep" />
          <MenuItem
            icon={<KeyIcon />}
            label={t("menu.passwords")}
            onClick={() => menu?.onOpenSettings("settings-passwords")}
          />
          <MenuItem
            icon={<ClockIcon />}
            label={t("title.history")}
            shortcut="Ctrl+H"
            onOpen={onOpen}
            kind="history"
          />
          <MenuItem
            icon={<DownloadIcon />}
            label={t("title.downloads")}
            shortcut="Ctrl+J"
            onOpen={onOpen}
            kind="downloads"
          />
          <MenuItem
            icon={<StarIcon />}
            label={t("title.bookmarks")}
            shortcut="Ctrl+Shift+O"
            onOpen={onOpen}
            kind="bookmarks"
          />
          <MenuItem
            icon={<BookmarkPlusIcon />}
            label={t("menu.bookmarkThis")}
            shortcut="Ctrl+D"
            onClick={() => {
              if (menu) menu.onBookmark(menu.url, menu.title);
            }}
          />
          <MenuItem icon={<BookIcon />} label={t("title.reading")} onOpen={onOpen} kind="reading" />
          <MenuItem icon={<GridIcon />} label={t("title.tabs")} onOpen={onOpen} kind="tabs" />
          <MenuItem
            icon={<BookTextIcon />}
            label={t("title.dictionary")}
            onOpen={onOpen}
            kind="dictionary"
          />
          <MenuItem
            icon={<PaletteIcon />}
            label={menu?.vertical ? t("menu.horizontalTabs") : t("menu.verticalTabs")}
            onClick={() => {
              if (menu) menu.onVertical(!menu.vertical);
            }}
          />
          <MenuItem
            icon={<TrashIcon />}
            label={t("menu.clearData")}
            shortcut="Ctrl+Shift+Del"
            onClick={() => menu?.onOpenSettings("settings-privacy")}
          />
          <div className="menu-sep" />
          <div className="menu-zoom">
            <span className="menu-label">{t("menu.zoom")}</span>
            <span className="menu-zoom-ctl">
              <button
                type="button"
                className="menu-zoom-btn"
                aria-label={t("menu.zoomOut")}
                onClick={() => {
                  if (menu) menu.onZoom(stepZoom(menu.zoom, -1));
                }}
              >
                −
              </button>
              <span className="menu-zoom-value">{menu?.zoom ?? 100}%</span>
              <button
                type="button"
                className="menu-zoom-btn"
                aria-label={t("menu.zoomIn")}
                onClick={() => {
                  if (menu) menu.onZoom(stepZoom(menu.zoom, 1));
                }}
              >
                +
              </button>
            </span>
          </div>
          <div className="menu-sep" />
          <MenuItem
            icon={<SettingsIcon />}
            label={t("title.settings")}
            onOpen={onOpen}
            kind="settings"
          />
          <MenuItem
            icon={<PowerIcon />}
            label={t("menu.exit")}
            shortcut="Ctrl+Q"
            onClick={() => menu?.onExit()}
          />
        </div>
      );
      break;

    default:
      body = null;
      break;
  }

  // Cài đặt chiếm toàn vùng dưới thanh công cụ thay vì thẻ nổi 430px:
  // nó có mục lục riêng theo bố cục chrome://settings.
  if (kind === "settings") {
    return (
      <Settings
        privateMode={privateMode}
        onHomeChange={onHomeChange}
        onClose={onClose}
        initialPage={menu?.settingsPage || undefined}
      />
    );
  }

  return (
    <div
      className={`panel${kind === "menu" ? " panel-menu" : ""}`}
      role="dialog"
      aria-label={t(titleKey(kind))}
    >
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
    case "menu":
      return "bar.menu";
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
    case "menu":
      return <MoreIcon />;
    default:
      return <SettingsIcon />;
  }
}

function MenuItem({
  icon,
  label,
  kind,
  shortcut,
  onOpen,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  kind?: PanelKind;
  shortcut?: string;
  // Hàng mở bảng thì có kind + onOpen; hàng hành động (thu phóng, thoát) chỉ có onClick.
  onOpen?: (kind: PanelKind) => void;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="menu-row"
      data-panel={kind}
      onClick={() => {
        if (onClick) onClick();
        else if (kind) onOpen?.(kind);
      }}
    >
      {icon}
      <span className="menu-label">{label}</span>
      {shortcut ? <kbd className="menu-key">{shortcut}</kbd> : null}
    </button>
  );
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
