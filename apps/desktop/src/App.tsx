import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { cmd, type BrowserStatePayload, type TabInfo } from "./tabs";
import Panel, { type PanelKind } from "./Panel";
import PermissionPrompt, { type PermissionPrompt as SitePrompt } from "./PermissionPrompt";
import NewTab from "./NewTab";
import { TERMS_SECTIONS } from "./terms";
import { setLang, t, useLang, type Lang } from "./i18n";
import { applyTheme } from "./theme";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  BookmarkPlusIcon,
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
  SplitIcon,
  StarIcon,
  StopIcon,
  TagIcon,
} from "./Icons";

const DEFAULT_HOME = "https://example.com/";

// Chỉ cần đúng phần App dùng để tô ngôi sao.
interface Bookmark {
  url: string;
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
  // null: đang kiểm tra; false: phải chấp nhận điều khoản trước.
  const [termsOk, setTermsOk] = useState<boolean | null>(null);
  const [home, setHome] = useState(DEFAULT_HOME);
  const [starred, setStarred] = useState(false);
  // Chrome làm nhạt dải tab khi cửa sổ mất tiêu điểm.
  const [blurred, setBlurred] = useState(false);

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

  // Phím tắt của ứng dụng. Webview nội dung không nhận mấy tổ hợp này
  // vì không có bridge Tauri ở phía trang; Ctrl+T/W/L/R phải đăng ký qua plugin
  // global-shortcut (M1 follow-up) — hiện chỉ hoạt động khi focus vào toolbar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.type !== "keydown") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        void cmd("new_tab").then(() => {
          setInput("");
          setEditing(true);
          (document.getElementById("address") as HTMLInputElement | null)?.focus();
        });
      } else if (mod && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setEditing(true);
        (document.getElementById("address") as HTMLInputElement | null)?.focus();
      } else if (mod && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void cmd("reload");
      } else if (e.altKey && e.key === "ArrowLeft") {
        void cmd("back");
      } else if (e.altKey && e.key === "ArrowRight") {
        void cmd("forward");
      } else if (mod && e.key === "Tab") {
        e.preventDefault();
        void cycle(state, e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        if (panel) setPanel(null);
        else void cmd("stop");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [state, panel]);

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

  const toggle = (kind: PanelKind) => setPanel((cur) => (cur === kind ? null : kind));

  if (termsOk === null) return null;
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

  return (
    <div
      className={`chrome${blurred ? " blurred" : ""}${state.vertical ? " vertical" : ""}${
        overlay ? " overlay" : ""
      }`}
    >
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
                  {favLetter(tb)}
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
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          {/* Chrome đặt ngôi sao đánh dấu bên trong ô địa chỉ. */}
          <button
            type="button"
            className={`omni-chip${starred ? " on" : ""}`}
            title={t("bar.bookmark")}
            onClick={() => {
              // bookmark_add là UPSERT theo URL: bấm lại sẽ ghi đè tiêu đề/folder cũ.
              if (!active || starred) return;
              void cmd("bookmark_add", {
                title: active.title || active.url,
                url: active.url,
                folder: "",
              })
                .then(() => setStarred(true))
                .catch(() => setStarred(false));
            }}
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

      {panel && (
        <div
          className="scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPanel(null);
          }}
        >
          <Panel
            kind={panel}
            onClose={() => setPanel(null)}
            onOpen={(kind) => setPanel(kind)}
            onNavigate={(url) => {
              setPanel(null);
              if (active) void cmd("navigate", { id: String(active.id), input: url });
            }}
            privateMode={state.private}
            onHomeChange={setHome}
          />
        </div>
      )}

      {prompts[0] && (
        <PermissionPrompt
          prompt={prompts[0]}
          onDone={() => setPrompts((list) => list.slice(1))}
        />
      )}
    </div>
  );
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
  if (tb.title) return tb.title;
  if (tb.pinned) return tb.label || "Tab";
  return hostOf(tb.url) || tb.url;
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
