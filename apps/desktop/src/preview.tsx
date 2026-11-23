// Khung xem trước giao diện chạy trong trình duyệt thường (không cần Rust).
// Chỉ dùng khi phát triển: `npm run dev` rồi mở /preview.html.
// Giả lập IPC của Tauri để App hoạt động như trong ứng dụng thật.
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

// Mock @tauri-apps/api/event cho preview (trình duyệt thường).
const eventListeners: Map<string, Set<(payload: unknown) => void>> = new Map();
const mockListen = async <T,>(event: string, handler: (e: { payload: T }) => void) => {
  if (!eventListeners.has(event)) eventListeners.set(event, new Set());
  eventListeners.get(event)!.add(handler as (payload: unknown) => void);
  return () => {
    eventListeners.get(event)?.delete(handler as (payload: unknown) => void);
  };
};
const mockEmit = (event: string, data: unknown) => {
  eventListeners.get(event)?.forEach((h) => h(data));
};

// Gán mock vào global để App.tsx dùng được.
(window as any).__TAURI_EVENT_MOCK__ = { listen: mockListen, emit: mockEmit };

const theme = new URLSearchParams(location.search).get("theme") ?? "light";
const params = new URLSearchParams(location.search);
const panel = params.get("panel");
const vertical = params.get("vertical") === "1";
const split = params.get("split") === "1";
const newtab = params.get("newtab") === "1";
const onboarded = params.get("onboarded") === "1";

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
    if (args.key === "onboardingDone") return onboarded ? "1" : "0";
    return null;
  },
  // bytwina://... navigation: emit browser://page event for internal pages.
  navigate: (args) => {
    const input = String(args.input ?? "");
    if (input.startsWith("bytwina://")) {
      const page = input.split("://")[1].split(/[\/?#]/)[0].toLowerCase();
      // Emit event to toolbar (simulated by setting panel state)
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        (window as any).__TAURI_INTERNALS__.emit?.("browser://page", page);
      }
      return { internal: page };
    }
    return { url: input }; // real navigation would happen in Rust
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
  // Hệ tiện ích: dữ liệu mẫu để xem giao diện, không chạy script thật.
  ext_list: () =>
    params.get("empty") === "1"
      ? []
      : [
          {
            id: "ext.demo-darkmode",
            name: "Chế độ tối cho trang",
            version: "1.2.0",
            description: "Đổi màu nền các trang sáng sang tông tối dễ chịu.",
            author: "Bytwina",
            active: true,
            installedAt: Math.floor(Date.now() / 1000) - 7200,
            requested: ["dom:write", "ui:inject", "network:restricted"],
            granted: ["dom:read", "storage:own", "notifications", "dom:write", "ui:inject"],
            hostPermissions: ["https://*.example.com/*"],
            storageBytes: 4096,
          },
          {
            id: "ext.demo-notes",
            name: "Ghi chú nhanh",
            version: "0.9.1",
            description: "Ghi chú cạnh trang đang mở.",
            author: "",
            active: false,
            installedAt: Math.floor(Date.now() / 1000) - 86400,
            requested: ["tabs:read"],
            granted: ["dom:read", "storage:own", "notifications"],
            hostPermissions: [],
            storageBytes: 0,
          },
        ],
  ext_inspect: (args) => ({
    manifest: { name: "Tiện ích mẫu" },
    id: "ext.demo-sample",
    name: "Tiện ích mẫu",
    version: "1.0.0",
    author: "Bytwina",
    description: "Tiện ích mẫu dùng để xem trước hộp duyệt quyền.",
    requested: ["dom:write", "network:restricted"],
    defaults: ["dom:read", "storage:own", "notifications"],
    hostPermissions: ["https://*.example.com/*"],
    sourceKind: String(args.path ?? "").toLowerCase().endsWith(".zip") ? "zip" : "folder",
    installed: false,
  }),
  ext_install: () => ({ id: "ext.demo-sample", name: "Tiện ích mẫu", version: "1.0.0", active: true }),
  ext_add: () => ({ id: "ext.editor-sample", name: "Tiện ích mới", version: "1.0.0", active: false }),
  ext_test: () => ({ valid: true }),
  ext_logs: () => [],
  ext_inspect_from_url: () => ({
    manifest: { name: "Tiện ích mẫu" },
    id: "ext.demo-sample",
    name: "Tiện ích mẫu",
    version: "1.0.0",
    author: "Bytwina",
    description: "Tiện ích mẫu dùng để xem trước hộp duyệt quyền.",
    requested: ["dom:write", "network:restricted"],
    defaults: ["dom:read", "storage:own", "notifications"],
    hostPermissions: ["https://*.example.com/*"],
    sourceKind: "zip",
    installed: false,
  }),
  ext_install_from_url: () => ({ id: "ext.demo-sample", name: "Tiện ích mẫu", version: "1.0.0", active: true }),
  ext_export: () => null,
  ext_toggle: () => true,
  ext_grant: () => null,
  ext_remove: () => null,
  ext_storage_clear: () => null,
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
  // Xem tệp: trả mẫu theo tham số ?file=type để test các loại tệp.
  file_pick: () => {
    const type = params.get("file") ?? "code";
    switch (type) {
      case "json":
        return {
          kind: "text",
          path: "C:/demo/data.json",
          name: "data.json",
          size: 212,
          text: '{\n  "name": "Bytwina",\n  "version": "0.0.5",\n  "features": ["pdf", "code", "markdown", "image"],\n  "config": { "theme": "dark", "lang": "vi" }\n}',
          truncated: false,
          markdown: false,
        };
      case "markdown":
        return {
          kind: "text",
          path: "C:/demo/readme.md",
          name: "readme.md",
          size: 345,
          text: "# Bytwina Browser\n\n**Trình duyệt tối giản, riêng tư** cho người dùng Việt Nam.\n\n## Tính năng\n- Xem PDF (pdf.js)\n- Highlight code (Shiki)\n- Markdown reader\n- Image viewer\n\n> \"Đơn giản nhưng mạnh mẽ\"\n\n```ts\nconsole.log('Hello Bytwina');\n```",
          truncated: false,
          markdown: true,
        };
      case "pdf":
        return {
          kind: "pdf",
          path: "C:/demo/sample.pdf",
          name: "sample.pdf",
          size: 102400,
          mime: "application/pdf",
          base64: "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSPj4Kc3RyZWFtCkJUCi9GMSAxMiBUZgo1MCA3MDAgVGQKKFN0aWxsIGV4YW1wbGUpIFRqCkVUCmVuZHN0cmVhbQplbmRvYmoKMyAwIG9iago8PC9MZW5ndGggNDQ+PgpzdHJlYW0KZW5kc3RyZWFtCmVuZG9iago0IDAgb2JqCjw8L1R5cGUgL1BhZ2UvUGFyZW50IDUgMCBSL1Jlc291cmNlcyA2IDAgUi9NZWRpYUJveCBbMCAwIDYxMiA3OTJdPj4KZW5kb2JqCjUgMCBvYmoKPDwvVHlwZSAvUGFnZXMvS2lkcyBbNCAwIFJdL0NvdW50IDE+PgplbmRvYmoKNiAwIG9iago8PC9Gb250IDw8L0YxIDIgMCBSPj4+PgplbmRvYmoKeHJlZgowIDcKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNzkgMDAwMDAgbiAKMDAwMDAwMDE3MyAwMDAwMCBuIAowMDAwMDAwMzAxIDAwMDAwIG4gCjAwMDAwMDAzODAgMDAwMDAgbiAKMDAwMDAwMDQ2MCAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNy9Sb290IDEgMCBSPj4Kc3RhcnR4cmVmCjU1MgolJUVPRgo=",
        };
      case "image":
        return {
          kind: "image",
          path: "C:/demo/photo.jpg",
          name: "photo.jpg",
          size: 512000,
          mime: "image/jpeg",
          dataUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiM5OTkiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiPlRlc3QgSW1hZ2U8L3RleHQ+PC9zdmc+",
        };
      case "code":
      default:
        return {
          kind: "text",
          path: "C:/demo/hello.ts",
          name: "hello.ts",
          size: 84,
          text: "export function hello(name: string) {\n  return `Xin chào, ${name}!`;\n}\n",
          truncated: false,
          markdown: false,
        };
    }
  },
  file_read: () => null,
  file_open_external: () => null,
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
  // Giả lập event emit (browser://page, browser://permission, v.v.)
  emit: (event: string, data: unknown) => {
    const mock = (window as any).__TAURI_EVENT_MOCK__;
    if (mock?.emit) mock.emit(event, data);
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
