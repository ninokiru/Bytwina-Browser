// Khung xem trước giao diện chạy trong trình duyệt thường (không cần Rust).
// Chỉ dùng khi phát triển: `npm run dev` rồi mở /preview.html.
// Giả lập IPC của Tauri để App hoạt động như trong ứng dụng thật.
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

const theme = new URLSearchParams(location.search).get("theme") ?? "light";
const params = new URLSearchParams(location.search);
const panel = params.get("panel");
const vertical = params.get("vertical") === "1";
const split = params.get("split") === "1";
const newtab = params.get("newtab") === "1";

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

const state = {
  tabs: newtab
    ? [
        { ...tabs[0], url: "about:blank", title: "", loading: false, canGoBack: false },
        ...tabs.slice(1),
      ]
    : tabs,
  activeTab: 1,
  private: false,
  vertical,
  splitTab: split ? 2 : null,
};

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

// `?vault=1` mở sẵn kho mật khẩu mẫu để xem giao diện khi phát triển.
const vaultDemo = params.get("vault") === "1";
const vaultEntries = [
  { id: 1, title: "Gmail", url: "https://mail.google.com", username: "duong@example.com", updatedAt: 1 },
  { id: 2, title: "GitHub", url: "https://github.com", username: "ninokiru", updatedAt: 2 },
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
    if (args.key === "tabLayout") return vertical ? "vertical" : "horizontal";
    return null;
  },
  state: () => state,
  popup_drain: () => ({ urls: [] }),
  settings_set: () => null,
  bookmark_list: () => (params.get("empty") === "1" ? [] : bookmarks),
  history_search: () => (params.get("empty") === "1" ? [] : history),
  reading_list: () => reading,
  downloads_list: () => downloads,
  diagnostics: () => ({
    appVersion: "0.0.3",
    webviewVersion: "126.0.2592.87",
    os: "Windows 11 (26100)",
    dbAvailable: true,
  }),
  adblock_status: () => ({
    enabled: true,
    ready: true,
    blocked: 128,
    lists: ["easylist", "easyprivacy", "ublock-filters", "abpvn"],
    disabledSites: ["shop.example.vn"],
    dir: "C:\\Users\\duong\\AppData\\Roaming\\dev.bytwina.browser\\filters",
  }),
  adblock_update: () => ({ downloaded: 5 }),
  // Quyền trang web + hệ thống: đủ hình dạng dữ liệu để xem trước trang Cài đặt.
  permission_list: () => [
    { origin: "https://news.example.vn", kind: "notifications", allowed: false },
    { origin: "https://meet.example.com", kind: "camera", allowed: true },
    { origin: "https://meet.example.com", kind: "microphone", allowed: true },
  ],
  permission_forget: () => null,
  autostart_get: () => false,
  settings_reset: () => null,
  clear_data: (args) =>
    args.range && args.range !== "all" ? { range: args.range, history: 12, downloads: 0 } : null,
  backup_list: () => [
    { name: "bytwina-1763500000.db", bytes: 248_320, modifiedAt: Math.floor(Date.now() / 1000) - 3600 },
    { name: "bytwina-1763400000.db", bytes: 244_224, modifiedAt: Math.floor(Date.now() / 1000) - 100_000 },
  ],
  backup_create: () => ({ name: "bytwina-now.db", bytes: 250_000, modifiedAt: Math.floor(Date.now() / 1000) }),
  backup_restore: () => null,
  backup_delete: () => null,
  password_status: () =>
    vaultDemo
      ? { configured: true, unlocked: true, count: vaultEntries.length, autoLock: 0 }
      : { configured: false, unlocked: false, count: 0, autoLock: 0 },
  password_list: () => (vaultDemo ? vaultEntries : []),
  password_reveal: () => ({ password: "mat-khau-mau-123", note: "" }),
  password_setup: () => ({ ok: true }),
  password_unlock: () => ({ ok: true }),
  password_lock: () => null,
  password_autolock: () => null,
  password_add: () => ({ id: 3 }),
  password_update: () => null,
  password_remove: () => null,
  password_wipe: () => null,
  // Ghi chú + phiên lưu: ?note=1 bật ghi chú mẫu cho URL đang mở.
  note_get: (args) =>
    params.get("note") === "1" && args.url
      ? "# Ghi chú mẫu\n\nĐây là **ghi chú** gắn với trang này.\n\n- Mở lại trang sẽ thấy chip Ghi chú\n- Bấm để sửa nội dung"
      : null,
  note_set: () => null,
  note_delete: () => null,
  note_render: (args) => {
    const text = String(args.content ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<p>${text.replace(/\n/g, "<br>")}</p>`;
  },
  note_export_markdown: () => "# Ghi chú Bytwina\n\n## https://example.com/\n\nghi chú mẫu\n",
  bookmark_export_html: () => "<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p></DL><p>",
  bookmark_import_chrome: () => ({ imported: 3 }),
  session_list_named: () => [
    { name: "Công việc", tabCount: 5, createdAt: Math.floor(Date.now() / 1000) - 3600 },
    { name: "Nghiên cứu", tabCount: 3, createdAt: Math.floor(Date.now() / 1000) - 86_400 },
  ],
  session_save_named: () => null,
  session_restore_named: () => null,
  session_delete_named: () => null,
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
