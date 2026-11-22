import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { cmd, type TabInfo } from "./tabs";
import { getLang } from "./i18n";
import "./CommandPalette.css";

// Bảng lệnh Ctrl+K: tìm tab đang mở, dấu trang, lịch sử và các hành động thường dùng.
// Lọc tự làm (shouldFilter=false) để gộp nhiều nguồn dữ liệu và bỏ dấu khi so khớp.

export type PaletteAction =
  | "newTab"
  | "closeTab"
  | "togglePrivate"
  | "bookmark"
  | "settings"
  | "history"
  | "bookmarks"
  | "downloads"
  | "toggleVertical"
  | "reload"
  | "reader";

type Lang = "vi" | "en";

const TEXT: Record<
  Lang,
  {
    placeholder: string;
    label: string;
    empty: string;
    gActions: string;
    gTabs: string;
    gBookmarks: string;
    gHistory: string;
    actions: Record<PaletteAction, string>;
    activeTab: string;
  }
> = {
  vi: {
    placeholder: "Tìm tab, dấu trang, lịch sử hoặc lệnh…",
    label: "Bảng lệnh",
    empty: "Không có kết quả",
    gActions: "Lệnh",
    gTabs: "Tab đang mở",
    gBookmarks: "Dấu trang",
    gHistory: "Lịch sử",
    activeTab: "Tab hiện tại",
    actions: {
      newTab: "Tab mới",
      closeTab: "Đóng tab hiện tại",
      togglePrivate: "Bật/tắt chế độ riêng tư",
      bookmark: "Lưu trang này vào dấu trang",
      settings: "Mở Cài đặt",
      history: "Mở lịch sử",
      bookmarks: "Mở dấu trang",
      downloads: "Mở tải xuống",
      toggleVertical: "Bật/tắt tab dọc",
      reload: "Tải lại trang",
      reader: "Chế độ đọc (bài viết)",
    },
  },
  en: {
    placeholder: "Search tabs, bookmarks, history or commands…",
    label: "Command palette",
    empty: "No results",
    gActions: "Commands",
    gTabs: "Open tabs",
    gBookmarks: "Bookmarks",
    gHistory: "History",
    activeTab: "Current tab",
    actions: {
      newTab: "New tab",
      closeTab: "Close current tab",
      togglePrivate: "Toggle private mode",
      bookmark: "Bookmark this page",
      settings: "Open Settings",
      history: "Open history",
      bookmarks: "Open bookmarks",
      downloads: "Open downloads",
      toggleVertical: "Toggle vertical tabs",
      reload: "Reload page",
      reader: "Reader mode (article view)",
    },
  },
};

const ACTION_ORDER: PaletteAction[] = [
  "newTab",
  "closeTab",
  "reload",
  "reader",
  "bookmark",
  "togglePrivate",
  "toggleVertical",
  "settings",
  "history",
  "bookmarks",
  "downloads",
];

interface Bookmark {
  title: string;
  url: string;
}
interface HistoryItem {
  title: string;
  url: string;
}

interface Item {
  key: string;
  title: string;
  sub?: string;
  search: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tabs: TabInfo[];
  activeTabId: number | null;
  privateMode: boolean;
  onActivateTab: (id: number) => void;
  onNavigate: (input: string) => void;
  onAction: (action: PaletteAction) => void;
}

export default function CommandPalette({
  open,
  onClose,
  tabs,
  activeTabId,
  privateMode,
  onActivateTab,
  onNavigate,
  onAction,
}: Props) {
  const lang: Lang = getLang() === "en" ? "en" : "vi";
  const T = TEXT[lang];
  const [query, setQuery] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Mỗi lần mở: đặt lại ô tìm và đọc dấu trang mới nhất.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHistory([]);
    void cmd("bookmark_list")
      .then((list) => setBookmarks((list as Bookmark[]) ?? []))
      .catch(() => setBookmarks([]));
  }, [open]);

  // Lịch sử chỉ tìm khi có từ khóa; chế độ riêng tư không đọc lịch sử (như tab mới).
  useEffect(() => {
    const q = query.trim();
    if (!open || !q || privateMode) {
      setHistory([]);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      void cmd("history_search", { query: q })
        .then((list) => {
          if (alive) setHistory(((list as HistoryItem[]) ?? []).slice(0, 8));
        })
        .catch(() => {
          if (alive) setHistory([]);
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query, open, privateMode]);

  if (!open) return null;

  const close = () => {
    setQuery("");
    onClose();
  };

  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  const actionItems: Item[] = ACTION_ORDER.map((a) => ({
    key: `act:${a}`,
    title: T.actions[a],
    search: T.actions[a],
    run: run(() => onAction(a)),
  }));

  const tabItems: Item[] = tabs.map((tb) => ({
    key: `tab:${tb.id}`,
    title: tb.title || tb.url || T.activeTab,
    sub: tb.url,
    search: `${tb.title} ${tb.url}`,
    run: run(() => onActivateTab(tb.id)),
  }));

  const bookmarkItems: Item[] = bookmarks.map((b) => ({
    key: `bm:${b.url}`,
    title: b.title || b.url,
    sub: b.url,
    search: `${b.title} ${b.url}`,
    run: run(() => onNavigate(b.url)),
  }));

  const historyItems: Item[] = history.map((h) => ({
    key: `hist:${h.url}`,
    title: h.title || h.url,
    sub: h.url,
    search: `${h.title} ${h.url}`,
    run: run(() => onNavigate(h.url)),
  }));

  const q = fold(query.trim());
  const match = (it: Item) => !q || fold(it.search).includes(q);

  // Không gõ gì: hiện lệnh, tab, và 5 dấu trang đầu. Có gõ: lọc tất cả nguồn.
  const groups: { heading: string; items: Item[] }[] = [
    { heading: T.gActions, items: actionItems.filter(match) },
    { heading: T.gTabs, items: tabItems.filter(match) },
    {
      heading: T.gBookmarks,
      items: (q ? bookmarkItems.filter(match) : bookmarkItems.slice(0, 5)),
    },
    { heading: T.gHistory, items: q ? historyItems : [] },
  ].filter((g) => g.items.length > 0);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div
      className="cp-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <Command className="cp-panel" shouldFilter={false} label={T.label}>
        <Command.Input
          className="cp-input"
          value={query}
          onValueChange={setQuery}
          placeholder={T.placeholder}
          autoFocus
        />
        <Command.List className="cp-list">
          {total === 0 && <div className="cp-empty">{T.empty}</div>}
          {groups.map((g) => (
            <Command.Group key={g.heading} heading={g.heading} className="cp-group">
              {g.items.map((it) => (
                <Command.Item
                  key={it.key}
                  value={it.key}
                  onSelect={it.run}
                  className="cp-item"
                >
                  <span className="cp-item-title">{it.title}</span>
                  {it.sub && <small className="cp-item-sub">{it.sub}</small>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

/// Bỏ dấu tiếng Việt để gõ "dau trang" vẫn khớp "dấu trang".
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .toLowerCase();
}
