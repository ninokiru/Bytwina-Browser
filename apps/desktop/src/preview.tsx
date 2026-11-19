// Khung xem trước giao diện chạy trong trình duyệt thường (không cần Rust).
// Chỉ dùng khi phát triển: `npm run dev` rồi mở /preview.html.
// Giả lập IPC của Tauri để App hoạt động như trong ứng dụng thật.
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const theme = new URLSearchParams(location.search).get("theme") ?? "light";
const panel = new URLSearchParams(location.search).get("panel");

const tabs = [
  {
    id: 1,
    label: "tab-1",
    url: "https://bytwina.dev/",
    title: "Bytwina — Trình duyệt tối giản, riêng tư",
    loading: false,
    created: true,
    canGoBack: false,
    canGoForward: false,
    pinned: false,
    group: null,
  },
  {
    id: 2,
    label: "tab-2",
    url: "https://github.com/ninokiru/Bytwina-Browser",
    title: "ninokiru/Bytwina-Browser",
    loading: false,
    created: true,
    canGoBack: true,
    canGoForward: false,
    pinned: true,
    group: "Dự án",
  },
  {
    id: 3,
    label: "tab-3",
    url: "https://tauri.app/start/",
    title: "Bắt đầu với Tauri 2",
    loading: true,
    created: true,
    canGoBack: true,
    canGoForward: true,
    pinned: false,
    group: null,
  },
  {
    id: 4,
    label: "tab-4",
    url: "https://v2.tauri.app/reference/config/",
    title: "Cấu hình ứng dụng",
    loading: false,
    created: true,
    canGoBack: false,
    canGoForward: false,
    pinned: false,
    group: null,
  },
];

const state = { tabs, activeTab: 1, private: false };

const bookmarks = [
  { id: 1, title: "Tauri 2 — Tài liệu chính thức", url: "https://tauri.app/", folder: "Tài liệu" },
  { id: 2, title: "Rust Standard Library", url: "https://doc.rust-lang.org/std/", folder: "" },
  { id: 3, title: "MDN Web Docs", url: "https://developer.mozilla.org/", folder: "Tham khảo" },
];

const history = [
  { id: 1, title: "Bytwina — Trình duyệt tối giản", url: "https://bytwina.dev/", visitedAt: 1 },
  { id: 2, title: "WebView2 — Microsoft Edge", url: "https://learn.microsoft.com/webview2", visitedAt: 2 },
  { id: 3, title: "SQLite Documentation", url: "https://sqlite.org/docs.html", visitedAt: 3 },
];

const reading = [
  { id: 1, title: "Thiết kế giao diện trình duyệt", url: "https://example.com/design", addedAt: 1 },
];

const downloads = [
  { id: 1, url: "https://example.com/setup.exe", path: "C:\\Users\\duong\\Downloads\\bytwina-setup.exe", success: true, finishedAt: 1 },
  { id: 2, url: "https://example.com/archive.zip", path: "C:\\Users\\duong\\Downloads\\archive.zip", success: false, finishedAt: 2 },
];

const replies: Record<string, (args: Record<string, unknown>) => unknown> = {
  terms_status: () => ({ accepted: true, version: 1 }),
  settings_get: (args) => {
    if (args.key === "language") return "vi";
    if (args.key === "theme") return theme;
    if (args.key === "homeUrl") return "https://bytwina.dev/";
    return null;
  },
  state: () => state,
  popup_drain: () => ({ urls: [] }),
  bookmark_list: () => bookmarks,
  history_search: () => history,
  reading_list: () => reading,
  downloads_list: () => downloads,
  diagnostics: () => ({
    appVersion: "0.0.2",
    webviewVersion: "126.0.2592.87",
    os: "Windows 11 (26100)",
    dbAvailable: true,
  }),
};

(globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  transformCallback: (cb: (payload: unknown) => void, once?: boolean) => {
    const id = Math.floor(Math.random() * 1_000_000);
    (window as unknown as Record<string, unknown>)[`_${id}`] = (payload: unknown) => {
      cb(payload);
      if (once) delete (window as unknown as Record<string, unknown>)[`_${id}`];
    };
    return id;
  },
  invoke: async (command: string, payload?: Record<string, unknown>) => {
    if (command === "browser_command") {
      const action = String(payload?.action ?? "");
      const args = (payload?.args ?? {}) as Record<string, unknown>;
      return replies[action]?.(args) ?? null;
    }
    return null;
  },
};

const { default: App } = await import("./App");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (panel) {
  // Nút mở bảng mang data-panel; bảng nằm sau menu ⋮ thì mở menu trước.
  let tries = 0;
  let menuOpened = false;
  const timer = setInterval(() => {
    const target = document.querySelector<HTMLElement>(`[data-panel="${panel}"]`);
    if (target) {
      target.click();
      clearInterval(timer);
      return;
    }
    if (++tries > 60) {
      clearInterval(timer);
      return;
    }
    if (!menuOpened && tries > 5) {
      const menu = document.querySelector<HTMLElement>('[data-panel="menu"]');
      if (menu) {
        menu.click();
        menuOpened = true;
      }
    }
  }, 100);
}
