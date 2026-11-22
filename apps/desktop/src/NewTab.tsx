import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { cmd } from "./tabs";
import { t, useLang } from "./i18n";
import { GlassesIcon, SearchIcon, SettingsIcon, ShieldIcon } from "./Icons";
import { FaviconImg } from "./favicon";

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

interface QuickLink {
  title: string;
  url: string;
  color: string;
}

interface Props {
  privateMode: boolean;
  onNavigate: (input: string) => void;
  onOpenSettings: () => void;
}

// Trang tab mới: bố cục một cột giữa màn hình như trang chủ của các công cụ
// tìm kiếm (Brave/DuckDuckGo/Google), thêm quick link lấy từ dấu trang và
// lịch sử. Chỉ dùng IPC đã có, không cần thay đổi backend.
export default function NewTab({ privateMode, onNavigate, onOpenSettings }: Props) {
  useLang();
  const [query, setQuery] = useState("");
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Chế độ riêng tư không đọc lịch sử (Chrome cũng ẩn shortcut trong incognito);
      // dấu trang vẫn dùng được vì người dùng chủ động lưu.
      const [marks, hist] = await Promise.all([
        cmd("bookmark_list").catch(() => []),
        privateMode
          ? Promise.resolve([])
          : cmd("history_search", { query: "" }).catch(() => []),
      ]);
      if (!alive) return;
      setLinks(quickLinks((marks as Bookmark[]) ?? [], (hist as HistoryItem[]) ?? []));
      setLoaded(true);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [privateMode]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 11) return t("newtab.morning");
    if (h < 18) return t("newtab.afternoon");
    return t("newtab.evening");
  }, []);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (q) onNavigate(q);
  };

  return (
    <main className="newtab-page">
      <div className="newtab-inner">
        {privateMode && (
          <span className="newtab-private">
            <GlassesIcon /> {t("app.private")}
          </span>
        )}

        <div className="newtab-brand">
          <img src="/brand-mark.png" alt="" />
          <b>Bytwina</b>
        </div>

        <p className="newtab-greeting">{greeting}</p>

        <form className="ntp-search" onSubmit={submit} role="search">
          <SearchIcon />
          <input
            // Tự focus khi mở tab mới, giống Chrome: gõ được ngay, không cần bấm.
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("newtab.placeholder")}
            aria-label={t("newtab.placeholder")}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="ntp-go" disabled={!query.trim()}>
            {t("newtab.search")}
          </button>
        </form>

        {links.length > 0 && (
          <section className="ntp-links">
            <header className="ntp-links-head">
              <h2>{t("newtab.shortcuts")}</h2>
              <button type="button" className="ntp-manage" onClick={onOpenSettings} title={t("bar.settings")}>
                <SettingsIcon />
                <span>{t("newtab.customize")}</span>
              </button>
            </header>
            <ul>
              {links.map((l) => (
                <li key={l.url}>
                  <button type="button" className="ntp-link" onClick={() => onNavigate(l.url)} title={l.url}>
                    <span className="ntp-link-icon" style={{ ["--tile" as string]: l.color }}>
                      <FaviconImg host={hostOf(l.url)} className="ntp-favicon-img" />
                      <span className="ntp-fallback-letter">{letterOf(l.title || l.url)}</span>
                    </span>
                    <span className="ntp-link-label">{l.title || hostOf(l.url)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {loaded && links.length === 0 && (
          <div className="ntp-suggest">
            <span>{t("newtab.tryThese")}</span>
            <div className="ntp-suggest-row">
              {(["news", "weather", "rate", "calendar"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="ntp-suggest-chip"
                  onClick={() => onNavigate(t(`newtab.suggest.${key}`))}
                >
                  {t(`newtab.suggest.${key}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="ntp-hint">{t("newtab.hint")}</p>
        <p className="ntp-privacy">
          <ShieldIcon /> {t("newtab.privacy")}
        </p>
      </div>
    </main>
  );
}

// Dấu trang đứng trước (người dùng chủ động lưu), sau đó lịch sử gần đây.
// Mỗi tên miền chỉ một ô để lưới không lặp cùng một trang.
function quickLinks(marks: Bookmark[], hist: HistoryItem[]): QuickLink[] {
  const seen = new Set<string>();
  const out: QuickLink[] = [];
  const add = (title: string, url: string) => {
    if (out.length >= 10) return;
    if (!url.startsWith("https://") && !url.startsWith("http://")) return;
    const host = hostOf(url);
    if (!host || seen.has(host)) return;
    seen.add(host);
    out.push({ title: title || host, url, color: colorOf(host) });
  };
  for (const b of marks) add(b.title, b.url);
  for (const h of hist) add(h.title, h.url);
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function letterOf(text: string): string {
  const cleaned = hostOf(text) || text;
  return (cleaned.trim().charAt(0) || "?").toUpperCase();
}

function colorOf(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${hash} 58% 42%)`;
}
