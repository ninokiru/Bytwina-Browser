import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { listen } from "@tauri-apps/api/event";
import { cmd, type BrowserStatePayload, type TabInfo } from "./tabs";
import Panel, { type PanelKind } from "./Panel";

// Toolbar là webview tin cậy duy nhất được phép gọi IPC (capabilities/default.json).
export default function App() {
  const [state, setState] = useState<BrowserStatePayload>({ tabs: [], activeTab: null });
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<PanelKind | null>(null);

  const active: TabInfo | undefined = state.tabs.find((t) => t.id === state.activeTab);

  // Đồng bộ ô địa chỉ khi tab chuyển trang, trừ khi người dùng đang gõ.
  useEffect(() => {
    if (!editing && active) setInput(active.url);
  }, [active?.url, active?.id, editing]);

  useEffect(() => {
    const un = listen<BrowserStatePayload>("browser://state", (e) => setState(e.payload));
    void cmd("state").then((s) => setState(s as BrowserStatePayload));
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

  // Phím tắt toàn cục của ứng dụng. Webview nội dung không nhận mấy tổ hợp này
  // vì không có bridge Tauri ở phía trang; Ctrl+T/W/L/R phải đăng ký qua plugin
  // global-shortcut (M1 follow-up) — hiện chỉ hoạt động khi focus vào toolbar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.type !== "keydown") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        void cmd("new_tab");
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
        void cmd("stop");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [state]);

  const go = () => {
    if (active == null) return;
    setEditing(false);
    void cmd("navigate", { id: String(active.id), input });
  };

  // Trang web không có bridge Tauri nên không thể tự xin popup;
  // permission manager hoàn thiện ở M4.

  return (
    <div style={bar}>
      <div style={row}>
        <strong style={{ padding: "0 8px" }}>Nova{state.private ? " · Riêng tư" : ""}</strong>
        <div style={tabList}>
          {state.tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => void cmd("activate_tab", { id: String(t.id) })}
              style={t.id === state.activeTab ? tabActive : tab}
              title={t.url}
            >
              <span
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {t.group ? `[${t.group}] ` : ""}
                {t.title || t.url}
              </span>
              <span
                style={{ marginLeft: 6, opacity: t.pinned ? 1 : 0.4 }}
                title={t.pinned ? "Bỏ ghim" : "Ghim tab"}
                onClick={(e) => {
                  e.stopPropagation();
                  void cmd("pin_tab", { id: String(t.id), on: t.pinned ? "0" : "1" });
                }}
              >
                📌
              </span>
              <span
                style={{ marginLeft: 6, opacity: 0.6 }}
                onClick={(e) => {
                  e.stopPropagation();
                  void cmd("close_tab", { id: String(t.id) });
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button onClick={() => void cmd("new_tab")} title="Ctrl+T" style={tab}>
            ＋
          </button>
        </div>
        <button onClick={() => setPanel(panel === "bookmarks" ? null : "bookmarks")}>★</button>
        <button onClick={() => setPanel(panel === "history" ? null : "history")}>🕘</button>
        <button onClick={() => setPanel(panel === "downloads" ? null : "downloads")} title="Tải xuống">⤓</button>
        <button
          onClick={() => void cmd("private_set", { on: state.private ? "0" : "1" })}
          title="Chế độ riêng tư (không ghi lịch sử)"
          style={{ fontWeight: state.private ? 700 : 400 }}
        >
          🕶
        </button>
        <button onClick={() => setPanel(panel === "settings" ? null : "settings")}>⚙</button>
      </div>
      <div style={row}>
        <button disabled={!active?.canGoBack} onClick={() => void cmd("back")}>
          ←
        </button>
        <button disabled={!active?.canGoForward} onClick={() => void cmd("forward")}>
          →
        </button>
        <button onClick={() => void cmd(active?.loading ? "stop" : "reload")} title="Ctrl+R / Esc">
          {active?.loading ? "■" : "⟳"}
        </button>
        <input
          id="address"
          style={address}
          value={input}
          placeholder="Nhập địa chỉ hoặc tìm kiếm"
          onChange={(e) => {
            setInput(e.target.value);
            setEditing(true);
          }}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <input
          style={{ width: 110 }}
          placeholder="Nhóm tab"
          aria-label="Nhóm tab"
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
        <button
          title="Lưu trang này"
          onClick={() => {
            if (active)
              void cmd("bookmark_add", { title: active.title, url: active.url, folder: "" });
          }}
        >
          ☆
        </button>
      </div>
      {panel && (
        <Panel
          kind={panel}
          onClose={() => setPanel(null)}
          onNavigate={(url) => {
            setPanel(null);
            if (active) void cmd("navigate", { id: String(active.id), input: url });
          }}
        />
      )}
    </div>
  );
}

async function cycle(state: BrowserStatePayload, dir: number) {
  if (state.tabs.length === 0 || state.activeTab == null) return;
  const idx = state.tabs.findIndex((t) => t.id === state.activeTab);
  const next = state.tabs[(idx + dir + state.tabs.length) % state.tabs.length];
  await cmd("activate_tab", { id: String(next.id) });
}

const bar: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  boxSizing: "border-box",
  fontFamily: "system-ui",
  fontSize: 13,
  background: "#f2f2f4",
  borderBottom: "1px solid #d0d0d6",
};
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 6px",
  minHeight: 40,
  boxSizing: "border-box",
};
const tabList: CSSProperties = { display: "flex", gap: 4, overflowX: "auto", flex: 1 };
const tab: CSSProperties = {
  width: 160,
  flexShrink: 0,
  padding: "4px 8px",
  border: "1px solid #d0d0d6",
  borderRadius: 6,
  background: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 4,
};
const tabActive: CSSProperties = { ...tab, background: "#e0ecff", borderColor: "#7aa7ff" };
const address: CSSProperties = {
  flex: 1,
  padding: "6px 10px",
  border: "1px solid #d0d0d6",
  borderRadius: 6,
  fontSize: 13,
};
