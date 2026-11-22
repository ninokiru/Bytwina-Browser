import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cmd, type BrowserStatePayload, type TabInfo } from "./tabs";
import Panel, { type PanelKind } from "./Panel";
import PermissionPrompt, { type PermissionPrompt as SitePrompt } from "./PermissionPrompt";
import NewTab from "./NewTab";
import Onboarding from "./Onboarding";
import { TERMS_SECTIONS } from "./terms";
import { setLang, t, useLang, type Lang } from "./i18n";
import { applyTheme } from "./theme";
import { evaluateArithmetic } from "./calc";
import { FaviconImg } from "./favicon";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  BookmarkPlusIcon,
  FileTextIcon,
  GlassesIcon,
  GlobeIcon,
  GridIcon,
  HomeIcon,
  LockIcon,
  MoreIcon,
  PinIcon,
  PlusIcon,
  ReloadIcon,
  SettingsIcon,
  ShieldIcon,
  SplitIcon,
  StarIcon,
  StopIcon,
  TagIcon,
} from "./Icons";

const DEFAULT_HOME = "https://example.com/";

// Chỉ cần đúng phần App dùng để tô ngôi sao và gợi ý dấu trang.
interface Bookmark {
  title: string;
  url: string;
}

interface Suggestion {
  title: string;
  url: string;
  type: "calc" | "history" | "shortcut";
}

// Ghi chú gắn với URL đang mở; nội dung chỉ dùng cho tooltip của chip.
interface PageNote {
  url: string;
  content: string;
}

// Toolbar là webview tin cậy duy nhất được phép gọi IPC (capabilities/default.json).
export default function App() {
  useLang();
  const [state, setState] = useState<BrowserStatePayload>({
    tabs: [],
    activeTab: null,
    private: false,
    vertical: false,
    splitTab: null,
  });
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<PanelKind | null>(null);
  // Hàng đợi lời hỏi quyền: mỗi lời đang chờ giữ một deferral phía WebView2,
  // nên không được phép mất nó — trả lời lần lượt, cái sau hiện sau cái trước.
  const [prompts, setPrompts] = useState<SitePrompt[]>([]);
  // Menu ⋮ cần hai giá trị này: hàng thu phóng và trang con cần mở.
  const [zoom, setZoom] = useState(100);
  const [settingsPage, setSettingsPage] = useState("");
  // Khiên chặn quảng cáo theo tab hiện hành. `blockedBaseline` là mốc trừ dần:
  // bộ đếm trong backend là TỔNG của cả phiên, không phải của riêng trang này.
  const [shieldOff, setShieldOff] = useState(false);
  // null: đang kiểm tra; false: phải chấp nhận điều khoản trước.
  const [termsOk, setTermsOk] = useState<boolean | null>(null);
  // null: đang đọc; false: chưa hoàn tất chào mừng lần đầu.
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [home, setHome] = useState(DEFAULT_HOME);
  const [starred, setStarred] = useState(false);
  // Chrome làm nhạt dải tab khi cửa sổ mất tiêu điểm.
  const [blurred, setBlurred] = useState(false);
  // Chế độ tập trung (Focus Mode): ẩn toàn bộ thanh công cụ, chỉ để lại webview và progress bar
  const [focusMode, setFocusMode] = useState(false);
  // Omnibox suggestions & quick calc
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [calcResult, setCalcResult] = useState<string | null>(null);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  // Ghi chú gắn URL: hiện chip trong omnibox khi mở lại trang đã có ghi chú.
  const [pageNote, setPageNote] = useState<PageNote | null>(null);

  useEffect(() => {
    void cmd("terms_status")
      .then((s) => setTermsOk((s as { accepted: boolean }).accepted))
      .catch(() => setTermsOk(false));
    void cmd("settings_get", { key: "language" })
      .then((v) => {
        if (v === "vi" || v === "en") setLang(v as Lang);
      })
      .catch(() => undefined);
    void cmd("settings_get", { key: "theme" })
      .then((v) => applyTheme(typeof v === "string" ? v : "system"))
      .catch(() => applyTheme("system"));
    void cmd("settings_get", { key: "homeUrl" })
      .then((v) => {
        if (typeof v === "string" && v) setHome(v);
      })
      .catch(() => undefined);
    void cmd("settings_get", { key: "onboardingDone" })
      .then((v) => setOnboarded(v === "1"))
      // Không đọc được CSDL thì bỏ qua onboarding thay vì chặn người dùng.
      .catch(() => setOnboarded(true));
    loadZoom();
  }, []);

  const active: TabInfo | undefined = state.tabs.find((tb) => tb.id === state.activeTab);

  // Tab mới (about:blank) hiển thị trang tab mới ngay trong webview toolbar,
  // giống Chrome/Brave: ô tìm kiếm lớn, quick link, không cần trang mạng.
  const isNewTab = active != null && (active.url === "about:blank" || active.url === "");
  const showNewTab = isNewTab && panel == null;

  // Đồng bộ ô địa chỉ khi tab chuyển trang, trừ khi người dùng đang gõ.
  // Tab mới hiện ô trống (như Chrome) thay vì chuỗi about:blank.
  useEffect(() => {
    if (!editing && active) setInput(active.url === "about:blank" ? "" : active.url);
  }, [active?.url, active?.id, editing]);

  useEffect(() => {
    const focus = () => setBlurred(false);
    const blur = () => setBlurred(true);
    // Chỉ theo dõi sự kiện: trong webview con, document.hasFocus() không phản ánh
    // tiêu điểm cửa sổ nên khởi tạo theo nó sẽ làm dải tab nhạt vĩnh viễn.
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Ngôi sao sáng khi URL hiện hành đã có trong danh sách đã lưu.
  // panel là phụ thuộc để đọc lại sau khi bảng "Đã lưu" sửa/xóa bookmark.
  useEffect(() => {
    const url = active?.url;
    if (!url || url === "about:blank") {
      setStarred(false);
      return;
    }
    void cmd("bookmark_list")
      .then((list) => setStarred(((list as Bookmark[]) ?? []).some((b) => b.url === url)))
      .catch(() => setStarred(false));
  }, [active?.url, panel]);

  // Ghi chú gắn URL: đọc khi tab đổi trang. Chỉ nhận http(s) và bỏ qua khi
  // chính bảng ghi chú đang mở (tránh thẻ nổi che trình soạn thảo).
  useEffect(() => {
    const url = active?.url;
    if (!url || url === "about:blank" || !/^https?:/i.test(url) || panel === "notes") {
      setPageNote(null);
      return;
    }
    let alive = true;
    void cmd("note_get", { url })
      .then((note) => {
        if (!alive) return;
        if (typeof note !== "string" || !note.trim()) {
          setPageNote(null);
          return;
        }
        setPageNote({ url, content: note });
      })
      .catch(() => {
        if (alive) setPageNote(null);
      });
    return () => {
      alive = false;
    };
  }, [active?.url, active?.id, panel]);

  // Omnibox: chờ 150ms sau lần gõ cuối rồi mới truy vấn, gộp lịch sử và dấu
  // trang, tối đa 8 gợi ý. Tính toán chạy qua parser riêng, không eval.
  useEffect(() => {
    if (!editing) return;
    const val = input.trim();
    setSuggestIndex(-1);
    if (!val) {
      setCalcResult(null);
      setSuggestions([]);
      return;
    }
    setCalcResult(evaluateArithmetic(val));
    // Chuỗi trông như URL thì không cần gợi ý tìm kiếm.
    if (val.length < 2 || /^[a-z][a-z0-9+.-]*:\/\//i.test(val)) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      void Promise.all([
        cmd("history_search", { query: val }).catch(() => []),
        cmd("bookmark_list").catch(() => []),
      ])
        .then(([history, marks]) => {
          if (!alive) return;
          const merged: Suggestion[] = [];
          const seen = new Set<string>();
          const add = (title: string, url: string, type: Suggestion["type"]) => {
            if (merged.length >= 8 || !url || seen.has(url)) return;
            if (!/^https?:/i.test(url)) return;
            if (fuzzyScore(val, `${title} ${url}`) <= 0) return;
            seen.add(url);
            merged.push({ title: title || url, url, type });
          };
          for (const b of (marks as Bookmark[]) ?? []) add(b.title, b.url, "shortcut");
          for (const h of (history as Array<{ title: string; url: string }>) ?? [])
            add(h.title, h.url, "history");
          setSuggestions(merged);
        })
        .catch(() => {
          if (alive) setSuggestions([]);
        });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [input, editing]);

  useEffect(() => {
    const un = listen<BrowserStatePayload>("browser://state", (e) => setState(e.payload));
    void cmd("state").then((s) => setState(s as BrowserStatePayload));
    return () => {
      un.then((f) => f());
    };
  }, []);

  // bytwina://... bị chặn ngay trong lệnh navigate; Rust báo tên trang xuống đây để
  // toolbar mở bảng tương ứng. Không có protocol thật nào được đăng ký.
  useEffect(() => {
    const un = listen<string>("browser://page", (e) => {
      if (e.payload === "newtab") void cmd("new_tab");
      else setPanel(e.payload as PanelKind);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // WebView2 xin quyền (camera, micro, vị trí, thông báo, clipboard): Rust chỉ gửi
  // thông báo, quyết định là của người dùng ở đây.
  useEffect(() => {
    const un = listen<SitePrompt>("browser://permission", (e) =>
      setPrompts((list) => (list.some((p) => p.id === e.payload.id) ? list : [...list, e.payload])),
    );
    return () => {
      un.then((f) => f());
    };
  }, []);

  // popup_drain chỉ có tác dụng khi webview nội dung xin mở cửa sổ mới;
  // backend không thể báo sự kiện cho toolbar nên polled theo chu kỳ ngắn.
  useEffect(() => {
    const id = setInterval(() => {
      void cmd("popup_drain")
        .then((res) => {
          const urls = (res as { urls?: string[] } | null)?.urls ?? [];
          if (urls.length > 0) void cmd("state").then((s) => setState(s as BrowserStatePayload));
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(id);
  }, []);

  // Phím tắt của ứng dụng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      
      // Ctrl+T: Mở tab mới
      if (mod && e.key.toLowerCase() === "t" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        newTab();
      } 
      // Ctrl+W: Đóng tab hiện tại
      else if (mod && e.key.toLowerCase() === "w") {
        e.preventDefault();
        e.stopPropagation();
        if (active) void cmd("close_tab", { id: String(active.id) });
      }
      // Ctrl+L hoặc Alt+D hoặc F6: Chọn thanh địa chỉ
      else if ((mod && e.key.toLowerCase() === "l") || (e.altKey && e.key.toLowerCase() === "d") || e.key === "F6") {
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
        const addr = document.getElementById("address") as HTMLInputElement | null;
        if (addr) {
          addr.focus();
          addr.select();
        }
      } 
      // F5 hoặc Ctrl+R: Tải lại trang
      else if (e.key === "F5" || (mod && e.key.toLowerCase() === "r" && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        void cmd("reload");
      } 
      // Ctrl+F5 hoặc Ctrl+Shift+R: Tải lại trang bỏ qua cache
      else if ((e.ctrlKey && e.key === "F5") || (mod && e.shiftKey && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        e.stopPropagation();
        void cmd("reload");
      }
      // Ctrl+Shift+N: Mở/tắt duyệt web riêng tư
      else if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void cmd("private_set", { on: state.private ? "0" : "1" });
      } 
      // Ctrl+Shift+O: Mở dấu trang
      else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setPanel("bookmarks");
      } 
      // Ctrl+J: Mở danh sách tải xuống
      else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setPanel("downloads");
      } 
      // Ctrl+H: Mở lịch sử duyệt web
      else if (mod && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setPanel("history");
      } 
      // Ctrl+D: Thêm dấu trang
      else if (mod && e.key.toLowerCase() === "d" && !e.altKey) {
        e.preventDefault();
        bookmarkCurrent();
      } 
      // Ctrl+Shift+Del: Xóa dữ liệu duyệt web (mở cài đặt quyền riêng tư)
      else if (mod && e.shiftKey && (e.code === "Delete" || e.key === "Delete")) {
        e.preventDefault();
        openSettingsPage("settings-privacy");
      } 
      // Ctrl+1 đến Ctrl+8: Nhảy đến tab 1 -> 8
      else if (mod && !e.shiftKey && !e.altKey && /^[1-8]$/.test(e.key)) {
        e.preventDefault();
        const tabIndex = parseInt(e.key, 10) - 1;
        if (state.tabs[tabIndex]) {
          void cmd("activate_tab", { id: String(state.tabs[tabIndex].id) });
        }
      }
      // Ctrl+9: Nhảy đến tab cuối cùng
      else if (mod && !e.shiftKey && !e.altKey && e.key === "9") {
        e.preventDefault();
        if (state.tabs.length > 0) {
          const lastTab = state.tabs[state.tabs.length - 1];
          void cmd("activate_tab", { id: String(lastTab.id) });
        }
      }
      // Ctrl+Tab / Ctrl+Shift+Tab: Chuyển tab tiếp theo / trước đó
      else if (mod && e.key === "Tab") {
        e.preventDefault();
        void cycle(state, e.shiftKey ? -1 : 1);
      } 
      // Ctrl+Q: Thoát trình duyệt
      else if (mod && e.key.toLowerCase() === "q") {
        e.preventDefault();
        void cmd("exit").catch(() => undefined);
      } 
      // Alt+Left: Quay lại
      else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        void cmd("back");
      } 
      // Alt+Right: Tiến tới
      else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        void cmd("forward");
      } 
      // Ctrl+Shift+F: Bật/tắt Chế độ tập trung (Focus Mode) — tránh tranh chấp với F11 Fullscreen của Windows
      else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        toggleFocusMode();
      }
      // Alt+Home: Về trang chủ
      else if (e.altKey && e.key === "Home") {
        e.preventDefault();
        if (active) void cmd("navigate", { id: String(active.id), input: home });
      }
      // Escape: Đóng panel hoặc dừng tải
      else if (e.key === "Escape") {
        if (panel) setPanel(null);
        else void cmd("stop");
      }
    };
    // Dùng capture: true để bắt phím tắt trước các phần tử con
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [state, panel, active, home]);

  // Bảng nổi và trang tab mới nằm trong webview thanh công cụ: mở chúng thì nới
  // webview này phủ toàn cửa sổ và ẩn webview nội dung, đóng thì trả bố cục cũ.
  const overlay = panel != null || showNewTab;
  useEffect(() => {
    void cmd("panel_open", { on: overlay ? "1" : "0" }).catch(() => undefined);
  }, [overlay]);

  const go = () => {
    if (active == null) return;
    setEditing(false);
    // bytwina://... không có thật bị từ chối ở backend: giữ lại ô địa chỉ, không log lỗi.
    void cmd("navigate", { id: String(active.id), input }).catch(() => undefined);
  };

  const openSuggestion = (s: Suggestion) => {
    setInput(s.url);
    if (active) void cmd("navigate", { id: String(active.id), input: s.url }).catch(() => undefined);
  };

  // Khiên theo tab đang mở. Bộ đếm là TỔNG của cả phiên (backend chưa phân tách
  // theo tab) — giao diện nói đúng như vậy thay vì giả vờ là số của riêng trang.
  useEffect(() => {
    const host = hostOf(active?.url ?? "");
    if (!host) {
      setShieldOff(false);
      return;
    }
    void cmd("adblock_status")
      .then((s) => {
        const st = (s ?? {}) as { disabledSites?: string[] };
        setShieldOff((st.disabledSites ?? []).some((h) => h.toLowerCase() === host));
      })
      .catch(() => undefined);
  }, [active?.id, active?.url]);

  const toggleShield = () => {
    const host = hostOf(active?.url ?? "");
    if (!host) return;
    const next = !shieldOff;
    setShieldOff(next);
    void cmd("adblock_site", { host, on: next ? "1" : "0" }).catch(() => setShieldOff(!next));
  };

  const toggleFocusMode = () => {
    const next = !focusMode;
    setFocusMode(next);
    void cmd("focus_mode_set", { on: next ? "1" : "0" });
  };

  const toggle = (kind: PanelKind) => {
    // Mở bảng theo cách thường: không giữ trang con sâu mà phím tắt/menu đã chọn.
    setSettingsPage("");
    // Hàng thu phóng phải đúng số đang chạy: người dùng có thể đổi ở Cài đặt.
    if (kind === "menu") loadZoom();
    setPanel((cur) => (cur === kind ? null : kind));
  };

  const loadZoom = () => {
    void cmd("settings_get", { key: "zoom" })
      .then((v) => {
        const percent = Number(v);
        if (Number.isFinite(percent) && percent > 0) setZoom(percent);
      })
      .catch(() => undefined);
  };

  const newTab = () => {
    void cmd("new_tab").then(() => {
      setInput("");
      setEditing(true);
      (document.getElementById("address") as HTMLInputElement | null)?.focus();
    });
  };

  const bookmarkCurrent = () => {
    // bookmark_add là UPSERT theo URL: đã có dấu trang thì không ghi đè.
    if (!active || starred) return;
    void cmd("bookmark_add", { title: active.title || active.url, url: active.url, folder: "" })
      .then(() => setStarred(true))
      .catch(() => setStarred(false));
  };

  const applyZoom = (percent: number) => {
    setZoom(percent);
    void cmd("zoom_set", { percent: String(percent) }).catch(() => undefined);
  };

  const openSettingsPage = (page: string) => {
    setSettingsPage(page);
    setPanel("settings");
  };

  if (termsOk === null || onboarded === null) return null;
  if (termsOk === false) {
    return (
      <div className="terms-screen">
        <div className="terms-card">
          <div className="terms-head">
            <div className="terms-logo">
              <img src="/brand-mark.png" alt="" />
            </div>
            <h1>{t("terms.title")}</h1>
          </div>
          <div className="terms-scroll">
            {TERMS_SECTIONS.map((sec) => (
              <section key={sec.title}>
                <strong>{sec.title}</strong>
                <p>{sec.body}</p>
              </section>
            ))}
          </div>
          <div className="terms-actions">
            <button className="btn" onClick={() => void cmd("terms_decline")}>
              {t("terms.decline")}
            </button>
            <button
              className="btn primary"
              onClick={() =>
                void cmd("terms_accept").then(() => {
                  setTermsOk(true);
                  return cmd("state").then((s) => setState(s as BrowserStatePayload));
                })
              }
            >
              {t("terms.accept")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (onboarded === false) {
    return <Onboarding onDone={() => setOnboarded(true)} />;
  }

  return (
    <div
      className={`chrome${blurred ? " blurred" : ""}${state.vertical ? " vertical" : ""}${
        overlay ? " overlay" : ""
      }${focusMode ? " focus-mode" : ""}`}
    >
      {focusMode && (
        <div className="focus-indicator" onClick={toggleFocusMode} title="Nhấn để thoát Chế độ tập trung (Ctrl+Shift+F)">
          <div className={`focus-progress${active?.loading ? " loading" : ""}`} />
        </div>
      )}
      <header className="tabbar">
        <div className={`brand${state.private ? " private" : ""}`} title="Bytwina Browser">
          <img src="/brand-mark.png" alt="" />
          <b>Bytwina</b>
        </div>
        {state.private && (
          <span className="private-pill">
            <GlassesIcon /> {t("app.private")}
          </span>
        )}
        <div className="tabs">
          {state.tabs.map((tb) => {
            const isActive = tb.id === state.activeTab;
            return (
              <div
                key={tb.id}
                className={[
                  "tab",
                  isActive ? "active" : "",
                  tb.pinned ? "pinned" : "",
                  tb.loading ? "tab-loading" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => void cmd("activate_tab", { id: String(tb.id) })}
                onAuxClick={(e) => {
                  if (e.button === 1) void cmd("close_tab", { id: String(tb.id) });
                }}
                title={tb.url}
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void cmd("activate_tab", { id: String(tb.id) });
                  }
                }}
              >
                <span
                  className="tab-fav"
                  style={{ ["--fav" as string]: favColor(tb.url + tb.id) }}
                >
                  {tb.url && tb.url !== "about:blank" && tb.url !== "about:blank/" ? (
                    <FaviconImg host={hostOf(tb.url)} />
                  ) : null}
                  <span className="tab-fav-letter">{favLetter(tb)}</span>
                </span>
                <span className="tab-label">{tabTitle(tb)}</span>
                {tb.group ? <span className="tab-group-dot" title={tb.group} /> : null}
                <button
                  className="tab-btn pin"
                  title={tb.pinned ? t("bar.unpin") : t("bar.pin")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void cmd("pin_tab", { id: String(tb.id), on: tb.pinned ? "0" : "1" });
                  }}
                >
                  <PinIcon />
                </button>
                <button
                  className="tab-btn close"
                  title={t("panel.close")}
                  onClick={(e) => {
                    e.stopPropagation();
                    void cmd("close_tab", { id: String(tb.id) });
                  }}
                >
                  <CloseIcon />
                </button>
              </div>
            );
          })}
          <button
            className="tab-new"
            onClick={() => void cmd("new_tab")}
            title={`${t("bar.newTab")} (Ctrl+T)`}
          >
            <PlusIcon />
          </button>
        </div>
        {/* Chrome để rất ít nút trên dải tab; phần còn lại vào menu ⋮. */}
        <div className="tools">
          <button
            className={`icon-btn${panel === "tabs" ? " active" : ""}`}
            data-panel="tabs"
            title={t("bar.findTabs")}
            onClick={() => toggle("tabs")}
          >
            <GridIcon />
          </button>
          <button
            className={`icon-btn${panel === "menu" ? " active" : ""}`}
            data-panel="menu"
            title={t("bar.menu")}
            onClick={() => toggle("menu")}
          >
            <MoreIcon />
          </button>
        </div>
      </header>

      <div className="navbar">
        <div className="nav-group">
          <button
            className="icon-btn"
            disabled={!active?.canGoBack}
            onClick={() => void cmd("back")}
            title="Alt+←"
          >
            <ArrowLeftIcon />
          </button>
          <button
            className="icon-btn"
            disabled={!active?.canGoForward}
            onClick={() => void cmd("forward")}
            title="Alt+→"
          >
            <ArrowRightIcon />
          </button>
          <button
            className="icon-btn"
            onClick={() => void cmd(active?.loading ? "stop" : "reload")}
            title="Ctrl+R / Esc"
          >
            {active?.loading ? <StopIcon /> : <ReloadIcon />}
          </button>
        </div>

        <div className="omnibox">
          <span className={`omni-icon${isSecure(active?.url) ? " secure" : ""}`}>
            {isSecure(active?.url) ? <LockIcon /> : <GlobeIcon />}
          </span>
          <input
            id="address"
            value={input}
            placeholder={t("bar.address")}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setInput(e.target.value);
              setEditing(true);
            }}
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => {
              // Delay nhỏ để kịp click gợi ý
              setTimeout(() => {
                setEditing(false);
                setCalcResult(null);
                setSuggestions([]);
                setSuggestIndex(-1);
              }, 200);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && suggestions.length > 0) {
                e.preventDefault();
                setSuggestIndex((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === "ArrowUp" && suggestions.length > 0) {
                e.preventDefault();
                setSuggestIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                return;
              }
              if (e.key === "Enter") {
                const picked = suggestIndex >= 0 ? suggestions[suggestIndex] : null;
                setEditing(false);
                setCalcResult(null);
                setSuggestions([]);
                setSuggestIndex(-1);
                if (picked) openSuggestion(picked);
                else go();
              }
              if (e.key === "Escape") {
                setEditing(false);
                setCalcResult(null);
                setSuggestions([]);
                setSuggestIndex(-1);
              }
            }}
          />
          {editing && (calcResult || suggestions.length > 0) && (
            <div className="omni-dropdown">
              {calcResult && (

                <div
                  className="omni-dropdown-item calc"
                  title="Bấm để sao chép kết quả"
                  onClick={() => {
                    void navigator.clipboard?.writeText(calcResult).catch(() => undefined);
                    setInput(calcResult);
                    setCalcResult(null);
                  }}
                >
                  <span className="omni-drop-type">🧮 Kết quả:</span>
                  <b>{calcResult}</b>
                </div>
              )}
              {suggestions.map((s, idx) => (
                <div
                  key={`${s.type}-${s.url}`}
                  className={`omni-dropdown-item${idx === suggestIndex ? " active" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    openSuggestion(s);
                    setEditing(false);
                    setSuggestions([]);
                    setSuggestIndex(-1);
                  }}
                >
                  <span className="omni-drop-title">{s.title}</span>
                  <span className="omni-drop-url">{s.url}</span>
                </div>
              ))}
            </div>
          )}
          {/* Trang đã có ghi chú: chip trong omnibox, bấm để mở bảng ghi chú. */}
          {pageNote && pageNote.url === active?.url && (
            <button
              type="button"
              className="omni-chip note"
              title={`${t("note.cardTitle")}: ${pageNote.content.slice(0, 300)}`}
              onClick={() => setPanel("notes")}
            >
              <FileTextIcon />
              <span className="omni-note-label">{t("note.chip")}</span>
            </button>
          )}
          {/* Chrome đặt ngôi sao đánh dấu bên trong ô địa chỉ. */}
          <button
            type="button"
            className={`omni-chip${starred ? " on" : ""}`}
            title={t("bar.bookmark")}
            onClick={bookmarkCurrent}
          >
            <StarIcon />
          </button>
          <button
            type="button"
            className="omni-chip"
            title={t("bar.addReading")}
            onClick={() => {
              if (active) void cmd("reading_add", { title: active.title, url: active.url });
            }}
          >
            <BookmarkPlusIcon />
          </button>
          <button
            type="button"
            className={`omni-chip shield${shieldOff ? " off" : ""}`}
            title={shieldOff ? t("shield.disabledHere") : t("shield.enabledHere")}
            disabled={!hostOf(active?.url ?? "")}
            onClick={toggleShield}
          >
            <ShieldIcon />
          </button>
          {active?.loading && <span className="omni-spinner" />}
        </div>

        <label className="group-field" title={t("bar.group")}>
          <TagIcon />
          <input
            placeholder={t("bar.group")}
            aria-label={t("bar.group")}
            key={active?.id}
            defaultValue={active?.group ?? ""}
            onKeyDown={(e) => {
              if (e.key === "Enter" && active)
                void cmd("set_group", {
                  id: String(active.id),
                  group: (e.target as HTMLInputElement).value,
                });
            }}
          />
        </label>

        <div className="nav-group">
          <button
            className={`icon-btn${state.splitTab != null ? " active" : ""}`}
            title={state.splitTab != null ? t("bar.splitOff") : t("bar.split")}
            onClick={() => {
              // Chưa chia: mở danh sách tab để chọn ô phải. Đang chia: tắt.
              if (state.splitTab != null) void cmd("split_set", { id: "" });
              else toggle("tabs");
            }}
          >
            <SplitIcon />
          </button>
          <button
            className="icon-btn"
            title={t("bar.home")}
            onClick={() => {
              if (active) void cmd("navigate", { id: String(active.id), input: home });
            }}
          >
            <HomeIcon />
          </button>
          <button
            className={`icon-btn${panel === "settings" ? " active" : ""}`}
            data-panel="settings"
            title={t("bar.settings")}
            onClick={() => toggle("settings")}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>

      {showNewTab && (
        <NewTab
          privateMode={state.private}
          onNavigate={(value) => {
            // Backend tự phân biệt URL và từ khóa tìm kiếm (navigation::to_url_with).
            if (active) void cmd("navigate", { id: String(active.id), input: value });
          }}
          onOpenSettings={() => setPanel("settings")}
        />
      )}

      {panel === "settings" ? (
        <Panel
          kind="settings"
          onClose={() => setPanel(null)}
          onOpen={(kind) => {
            setSettingsPage("");
            setPanel(kind);
          }}
          onNavigate={(url) => {
            setPanel(null);
            if (active) void cmd("navigate", { id: String(active.id), input: url });
          }}
          privateMode={state.private}
          onHomeChange={setHome}
          menu={{
            url: active?.url ?? "",
            title: active?.title ?? "",
            zoom,
            vertical: state.vertical,
            settingsPage,
            onNewTab: newTab,
            onBookmark: bookmarkCurrent,
            onZoom: applyZoom,
            onVertical: (vertical) =>
              void cmd("tab_layout", { layout: vertical ? "vertical" : "horizontal" }).catch(
                () => undefined,
              ),
            onOpenSettings: openSettingsPage,
            onExit: () => void cmd("exit").catch(() => undefined),
            onCheckUpdate: async () => {
              const info = (await cmd("update_check")) as {
                version: string;
                current: string;
              } | null;
              if (!info) return t("menu.updateLatest");
              const ok = window.confirm(
                t("menu.updateFound")
                  .replace("{v}", info.version)
                  .replace("{c}", info.current),
              );
              if (ok) await cmd("update_install");
              return t("menu.updateInstalling");
            },
          }}
        />
      ) : panel ? (
        <div
          className="scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPanel(null);
          }}
        >
          <Panel
            kind={panel}
            onClose={() => setPanel(null)}
            onOpen={(kind) => {
              setSettingsPage("");
              setPanel(kind);
            }}
            onNavigate={(url) => {
              setPanel(null);
              if (active) void cmd("navigate", { id: String(active.id), input: url });
            }}
            privateMode={state.private}
            onHomeChange={setHome}
            menu={{
              url: active?.url ?? "",
              title: active?.title ?? "",
              zoom,
              vertical: state.vertical,
              settingsPage,
              onNewTab: newTab,
              onBookmark: bookmarkCurrent,
              onZoom: applyZoom,
              onVertical: (vertical) =>
                void cmd("tab_layout", { layout: vertical ? "vertical" : "horizontal" }).catch(
                  () => undefined,
                ),
              onOpenSettings: openSettingsPage,
              onExit: () => void cmd("exit").catch(() => undefined),
              onCheckUpdate: async () => {
                const info = (await cmd("update_check")) as {
                  version: string;
                  current: string;
                } | null;
                if (!info) return t("menu.updateLatest");
                const ok = window.confirm(
                  t("menu.updateFound")
                    .replace("{v}", info.version)
                    .replace("{c}", info.current),
                );
                if (ok) await cmd("update_install");
                return t("menu.updateInstalling");
              },
            }}
          />
        </div>
      ) : null}

      {prompts[0] && (
        <PermissionPrompt
          prompt={prompts[0]}
          onDone={() => setPrompts((list) => list.slice(1))}
        />
      )}
    </div>
  );
}

// Lọc mờ cho gợi ý omnibox: khớp liền thì điểm cao, khớp theo thứ tự chữ cái
// vẫn nhận nhưng trừ dần theo khoảng cách. 0 nghĩa là không khớp.
function fuzzyScore(query: string, haystack: string): number {
  const q = query.toLowerCase().trim();
  const h = haystack.toLowerCase();
  if (!q) return 0;
  const direct = h.indexOf(q);
  if (direct >= 0) return 100 - Math.min(direct, 50);
  let qi = 0;
  let gaps = 0;
  let last = -1;
  for (let i = 0; i < h.length && qi < q.length; i += 1) {
    if (h[i] !== q[qi]) continue;
    if (last >= 0) gaps += i - last - 1;
    last = i;
    qi += 1;
  }
  return qi === q.length ? Math.max(1, 40 - gaps) : 0;
}

async function cycle(state: BrowserStatePayload, dir: number) {
  if (state.tabs.length === 0 || state.activeTab == null) return;
  const idx = state.tabs.findIndex((tb) => tb.id === state.activeTab);
  const next = state.tabs[(idx + dir + state.tabs.length) % state.tabs.length];
  await cmd("activate_tab", { id: String(next.id) });
}

function isSecure(url: string | undefined): boolean {
  return typeof url === "string" && url.startsWith("https://");
}

function tabTitle(tb: TabInfo): string {
  if (tb.title && tb.title !== "about:blank" && tb.title !== "about:blank/") return tb.title;
  if (!tb.url || tb.url === "about:blank" || tb.url === "about:blank/" || tb.url === "bytwina://newtab") {
    return "Thẻ mới";
  }
  if (tb.pinned) return tb.label || "Thẻ mới";
  return hostOf(tb.url) || "Thẻ mới";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function favLetter(tb: TabInfo): string {
  const host = hostOf(tb.url);
  const letter = (host || tb.title || "?").trim().charAt(0);
  return letter || "?";
}

// Màu ổn định theo URL để mỗi trang có "favicon" riêng mà không cần tải mạng.
// Sáng 40% để chữ trắng trên đó vẫn đủ tương phản.
function favColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${hash} 62% 40%)`;
}
