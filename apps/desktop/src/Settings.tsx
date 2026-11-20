import { Fragment, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { cmd } from "./tabs";
import { getLang, setLang, t, useLang, type Key, type Lang } from "./i18n";
import { applyTheme } from "./theme";
import PasswordVault from "./PasswordVault";
import {
  AlertIcon,
  BoltIcon,
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  GridIcon,
  KeyIcon,
  LockIcon,
  PaletteIcon,
  PowerIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  TrashIcon,
  TranslateIcon,
  UserIcon,
} from "./Icons";

interface Diagnostics {
  appVersion: string;
  webviewVersion: string;
  os: string;
  dbAvailable: boolean;
}

interface AdblockStatus {
  enabled: boolean;
  ready: boolean;
  blocked: number;
  lists: string[];
  disabledSites: string[];
  dir: string;
}

interface SitePermission {
  origin: string;
  kind: string;
  allowed: boolean;
}

// Nhãn quyền theo kind; backend trả cùng bộ tên với bảng hỏi.
const PERM_KIND_KEYS: Record<string, Key> = {
  camera: "perm.kind.camera",
  microphone: "perm.kind.microphone",
  geolocation: "perm.kind.geolocation",
  notifications: "perm.kind.notifications",
  clipboard: "perm.kind.clipboard",
};

const ZOOM_OPTIONS = [50, 75, 90, 100, 110, 125, 150, 175, 200];

/// Danh sách công cụ tìm kiếm như Chrome: chọn một, lưu ngay, không còn bộ chọn
/// rời trên trang tab mới.
const ENGINES: { id: string; label: string; desc: Key }[] = [
  { id: "duckduckgo", label: "DuckDuckGo", desc: "settings.engineDuckDesc" },
  { id: "google", label: "Google", desc: "settings.engineGoogleDesc" },
  { id: "bing", label: "Bing", desc: "settings.engineBingDesc" },
  { id: "brave", label: "Brave Search", desc: "settings.engineBraveDesc" },
];

// Mỗi mục đều được backend đọc từ CSDL (settings_get/settings_set) và có tác dụng thật.
export default function Settings({
  privateMode,
  onHomeChange,
  onClose,
}: {
  privateMode: boolean;
  onHomeChange: (url: string) => void;
  onClose: () => void;
}) {
  useLang();
  const [lang, setLangState] = useState<Lang>(getLang());
  const [home, setHome] = useState("https://example.com/");
  const [engine, setEngine] = useState("duckduckgo");
  const [startup, setStartup] = useState("restore");
  const [downloadDir, setDownloadDir] = useState("");
  const [zoom, setZoom] = useState("100");
  const [theme, setTheme] = useState("system");
  const [tabLayout, setTabLayout] = useState("horizontal");
  const [workspace, setWorkspace] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [clearOnExit, setClearOnExit] = useState(false);
  const [sleep, setSleep] = useState("0");
  const [message, setMessage] = useState("");
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [ab, setAb] = useState<AdblockStatus | null>(null);
  const [perms, setPerms] = useState<SitePermission[]>([]);
  const [abBusy, setAbBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  // null: chưa kiểm tra được (plugin lỗi hoặc nền tảng không hỗ trợ).
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  const loadAdblock = () =>
    cmd("adblock_status")
      .then((s) => setAb(s as AdblockStatus))
      .catch(() => setAb(null));

  const loadPerms = () =>
    cmd("permission_list")
      .then((l) => setPerms(((l as SitePermission[]) ?? [])))
      .catch(() => setPerms([]));

  const forgetPerm = (origin: string) => {
    void cmd("permission_forget", { origin }).then(loadPerms).catch(() => undefined);
  };

  // Đọc lại toàn bộ giá trị đang lưu — dùng lúc mở trang và sau khi đặt lại.
  const loadAll = () => {
    const get = (key: string) =>
      cmd("settings_get", { key })
        .then((v) => (typeof v === "string" ? v : null))
        .catch(() => null);
    void Promise.all([
      get("homeUrl"),
      get("searchEngine"),
      get("startupMode"),
      get("downloadDir"),
      get("zoom"),
      get("theme"),
      get("clearOnExit"),
      get("sleepMinutes"),
      get("tabLayout"),
      get("workspace"),
    ]).then(([h, e, s, d, z, th, c, sl, tl, ws]) => {
      if (h) setHome(h);
      if (e) setEngine(e);
      if (s) setStartup(s);
      if (d) setDownloadDir(d);
      if (z) setZoom(z);
      if (th) setTheme(th);
      setClearOnExit(c === "1");
      if (sl) setSleep(sl);
      if (tl) setTabLayout(tl);
      if (ws) setWorkspace(ws);
    });
    void loadAdblock();
    void loadPerms();
    // Mục "Bạn và Bytwina" hiện thông tin ngay, không cần bấm nút lấy chẩn đoán.
    void loadDiagnostics();
    void cmd("autostart_get")
      .then((v) => setAutostart(v === true))
      .catch(() => setAutostart(null));
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Tô sáng mục lục theo phần đang xem (cách của chrome://settings).
  useEffect(() => {
    const seen = new Set<string>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) seen.add(e.target.id);
          else seen.delete(e.target.id);
        }
        // Cuộn nhanh có thể khiến không mục nào giao cắt vùng theo dõi: giữ nguyên mục cũ.
        const top = SECTIONS.find((s) => seen.has(s.id));
        if (top) setActiveSection(top.id);
      },
      { rootMargin: "0px 0px -55% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  const save = (key: string, value: string) => {
    void cmd("settings_set", { key, value }).catch(() => undefined);
  };

  const changeLang = (next: Lang) => {
    setLang(next);
    setLangState(next);
    save("language", next);
  };

  const saveHome = () => {
    save("homeUrl", home);
    onHomeChange(home);
  };

  const changeTheme = (next: string) => {
    setTheme(next);
    applyTheme(next);
    save("theme", next);
  };

  const changeZoom = (next: string) => {
    setZoom(next);
    void cmd("zoom_set", { percent: next }).catch(() => undefined);
  };

  const changeTabLayout = (next: string) => {
    setTabLayout(next);
    void cmd("tab_layout", { layout: next }).catch(() => undefined);
  };

  // Workspace chỉ áp dụng khi tạo webview mới, nên backend tải lại tab đang mở.
  const saveWorkspace = () => {
    const name = workspace.trim();
    if (!/^[A-Za-z0-9_-]{0,24}$/.test(name)) {
      setWorkspaceError(t("settings.workspaceInvalid"));
      return;
    }
    setWorkspaceError("");
    void cmd("workspace_set", { name })
      .then(() => setWorkspace(name))
      .catch(() => setWorkspaceError(t("settings.workspaceInvalid")));
  };

  const clearData = () => {
    void cmd("clear_data").then(() => setMessage(t("settings.cleared")));
  };

  const loadDiagnostics = () => {
    void cmd("diagnostics").then((d) => setDiag(d as Diagnostics));
  };

  const changeAdblock = (on: boolean) => {
    setAb((v) => (v ? { ...v, enabled: on } : v));
    void cmd("adblock_set", { on: on ? "1" : "0" }).catch(() => undefined);
  };

  // Tải danh sách và dựng lại engine chạy ở luồng nền nên phải khoá nút.
  const updateAdblock = () => {
    setAbBusy(true);
    void cmd("adblock_update")
      .then(loadAdblock)
      .catch(() => undefined)
      .finally(() => setAbBusy(false));
  };

  const changeAutostart = (on: boolean) => {
    setAutostart(on);
    void cmd("autostart_set", { on: on ? "1" : "0" }).catch((e) => {
      // Windows có thể từ chối ghi khoá Run: trả lại đúng trạng thái thật.
      setAutostart(!on);
      setMessage(String(e));
    });
  };

  const openDefaultApps = () => {
    void cmd("open_default_apps").catch((e) => setMessage(String(e)));
  };

  const resetSettings = () => {    setResetArmed(false);
    void cmd("settings_reset")
      .then(() => {
        applyTheme("system");
        setMessage(t("settings.resetDone"));
        loadAll();
      })
      .catch((e) => setMessage(String(e)));
  };

  // Gom theo origin vì backend xóa luật theo trang, không theo từng quyền.
  const permOrigins: [string, SitePermission[]][] = Object.entries(
    perms.reduce<Record<string, SitePermission[]>>((acc, p) => {
      const list = acc[p.origin] ?? [];
      list.push(p);
      acc[p.origin] = list;
      return acc;
    }, {}),
  );

  return (
    <div className="settings-page">
      <aside className="settings-nav">
        <div className="settings-nav-head">
          <img src="/brand-mark.png" alt="" />
          <span>{t("bar.settings")}</span>
        </div>
        {SECTIONS.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && SECTIONS[i - 1].group !== s.group && <div className="settings-nav-sep" />}
            <button
              type="button"
              className={`settings-nav-item${activeSection === s.id ? " active" : ""}`}
              onClick={() => jump(s.id)}
            >
              <s.icon />
              <span>{t(s.label)}</span>
            </button>
          </Fragment>
        ))}
        <div className="settings-nav-sep" />
        <button type="button" className="settings-nav-item" onClick={onClose}>
          <CloseIcon />
          <span>{t("panel.close")}</span>
        </button>
      </aside>
      <main className="settings-main">
        <div className="settings">
          <Section id="settings-you" title={t("settings.you")}>
            <dl className="diag">
              <dt>{t("settings.version")}</dt>
              <dd>{diag?.appVersion ?? "—"}</dd>
              <dt>{t("settings.webview")}</dt>
              <dd>{diag?.webviewVersion ?? "—"}</dd>
              <dt>{t("settings.storage")}</dt>
              <dd>
                {diag
                  ? diag.dbAvailable
                    ? t("settings.storageOk")
                    : t("settings.storageOff")
                  : "—"}
              </dd>
            </dl>
            <p className="hint">{t("settings.youHint")}</p>
            <button type="button" className="btn" onClick={loadDiagnostics}>
              {t("settings.diagnostics")}
            </button>
          </Section>

          <Section id="settings-appearance" title={t("settings.appearance")}>
            <label className="settings-row">
              {t("settings.theme")}
              <select value={theme} onChange={(e) => changeTheme(e.target.value)}>
                <option value="system">{t("settings.themeSystem")}</option>
                <option value="light">{t("settings.themeLight")}</option>
                <option value="dark">{t("settings.themeDark")}</option>
              </select>
            </label>
            <label className="settings-row">
              {t("settings.zoom")}
              <select value={zoom} onChange={(e) => changeZoom(e.target.value)}>
                {ZOOM_OPTIONS.map((z) => (
                  <option key={z} value={String(z)}>
                    {z}%
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section id="settings-layout" title={t("settings.layout")}>
            <label className="settings-row">
              {t("settings.tabLayout")}
              <select value={tabLayout} onChange={(e) => changeTabLayout(e.target.value)}>
                <option value="horizontal">{t("settings.layoutHorizontal")}</option>
                <option value="vertical">{t("settings.layoutVertical")}</option>
              </select>
            </label>
            <p className="hint">{t("settings.layoutHint")}</p>
            <label className="settings-stack">
              {t("settings.workspaceName")}
              <input
                className="field"
                value={workspace}
                placeholder={t("settings.workspacePlaceholder")}
                onChange={(e) => setWorkspace(e.target.value)}
                onBlur={saveWorkspace}
              />
            </label>
            <p className="hint">{t("settings.workspaceHint")}</p>
            {workspaceError && (
              <p className="hint">
                <AlertIcon /> {workspaceError}
              </p>
            )}
          </Section>

          <Section id="settings-search" title={t("settings.search")}>
            <p className="settings-label">{t("settings.searchEngine")}</p>
            <div className="choice-list" role="radiogroup" aria-label={t("settings.searchEngine")}>
              {ENGINES.map((en) => (
                <label key={en.id} className={`choice${engine === en.id ? " on" : ""}`}>
                  <input
                    type="radio"
                    name="searchEngine"
                    value={en.id}
                    checked={engine === en.id}
                    onChange={() => {
                      setEngine(en.id);
                      save("searchEngine", en.id);
                    }}
                  />
                  <span className="choice-text">
                    <b>{en.label}</b>
                    <small>{t(en.desc)}</small>
                  </span>
                </label>
              ))}
            </div>
            <label className="settings-stack">
              {t("settings.homepage")}
              <input
                className="field"
                value={home}
                onChange={(e) => setHome(e.target.value)}
                onBlur={saveHome}
              />
            </label>
            <p className="hint">{t("settings.homeHint")}</p>
          </Section>

          <Section id="settings-startup" title={t("settings.startup")}>
            <label className="settings-row">
              {t("settings.startup")}
              <select
                value={startup}
                onChange={(e) => {
                  setStartup(e.target.value);
                  save("startupMode", e.target.value);
                }}
              >
                <option value="restore">{t("settings.startupRestore")}</option>
                <option value="home">{t("settings.startupHome")}</option>
                <option value="blank">{t("settings.startupBlank")}</option>
              </select>
            </label>
            <p className="hint">{t("settings.startupHint")}</p>
          </Section>

          <Section id="settings-privacy" title={t("settings.privacy")}>
            <label className="settings-row">
              {t("settings.privateMode")}
              <input
                type="checkbox"
                checked={privateMode}
                onChange={(e) => void cmd("private_set", { on: e.target.checked ? "1" : "0" })}
              />
            </label>
            <p className="hint">{t("settings.privateHint")}</p>
            <label className="settings-row">
              {t("settings.clearOnExit")}
              <input
                type="checkbox"
                checked={clearOnExit}
                onChange={(e) => {
                  setClearOnExit(e.target.checked);
                  save("clearOnExit", e.target.checked ? "1" : "0");
                }}
              />
            </label>
            <p className="hint">{t("settings.clearOnExitHint")}</p>
            <p className="hint">
              {t("settings.cookies")}: {t("settings.cookiesNote")}
            </p>
            <button type="button" className="btn danger block" onClick={clearData}>
              <TrashIcon /> {t("settings.clearData")}
            </button>
            {message && (
              <p className="hint ok">
                <CheckCircleIcon /> {message}
              </p>
            )}
          </Section>

          <Section id="settings-permissions" title={t("settings.permissions")}>
            <p className="hint">{t("settings.permissionsHint")}</p>
            {permOrigins.length === 0 ? (
              <p className="hint">{t("settings.permissionsEmpty")}</p>
            ) : (
              <ul className="permission-list">
                {permOrigins.map(([origin, items]) => (
                  <li key={origin}>
                    <span className="permission-origin">{origin}</span>
                    <span className="permission-kinds">
                      {items
                        .map(
                          (p) =>
                            `${t(PERM_KIND_KEYS[p.kind] ?? "perm.title")} ${
                              p.allowed ? t("perm.allow") : t("perm.block")
                            }`,
                        )
                        .join(", ")}
                    </span>
                    <button type="button" className="btn" onClick={() => forgetPerm(origin)}>
                      {t("settings.permissionsRemove")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="settings-adblock" title={t("settings.adblock")}>
            <label className="settings-row">
              {t("settings.adblockRow")}
              <input
                type="checkbox"
                checked={ab?.enabled ?? true}
                onChange={(e) => changeAdblock(e.target.checked)}
              />
            </label>
            <p className="hint">
              {t("settings.adblockLists")}:{" "}
              {ab && ab.lists.length > 0 ? ab.lists.join(", ") : t("settings.adblockNone")}
            </p>
            <p className="hint">
              {t("settings.adblockBlocked")}: {ab?.blocked ?? 0}
            </p>
            <p className="hint">{t("settings.adblockHint")}</p>
            <button type="button" className="btn block" disabled={abBusy} onClick={updateAdblock}>
              {abBusy ? t("settings.adblockUpdating") : t("settings.adblockUpdate")}
            </button>
          </Section>

          <Section id="settings-performance" title={t("settings.performance")}>
            <label className="settings-row">
              {t("settings.sleep")}
              <select
                value={sleep}
                onChange={(e) => {
                  setSleep(e.target.value);
                  save("sleepMinutes", e.target.value);
                }}
              >
                <option value="0">{t("settings.sleepOff")}</option>
                <option value="5">5 min</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
              </select>
            </label>
            <p className="hint">{t("settings.performanceHint")}</p>
          </Section>

          <Section id="settings-downloads" title={t("settings.downloads")}>
            <input
              className="field"
              value={downloadDir}
              placeholder={t("settings.downloadDirPlaceholder")}
              onChange={(e) => setDownloadDir(e.target.value)}
              onBlur={() => save("downloadDir", downloadDir.trim())}
            />
            <p className="hint">
              <DownloadIcon /> {t("settings.downloadDirHint")}
            </p>
            <p className="hint">{t("settings.downloadsHint")}</p>
          </Section>

          <Section id="settings-languages" title={t("settings.languages")}>
            <label className="settings-row">
              {t("settings.language")}
              <select value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
                <option value="vi">{t("settings.langVi")}</option>
                <option value="en">{t("settings.langEn")}</option>
              </select>
            </label>
          </Section>

          <Section id="settings-passwords" title={t("settings.passwords")}>
            <PasswordVault />
          </Section>

          <Section id="settings-system" title={t("settings.system")}>
            <label className="settings-row">
              {t("settings.autostart")}
              <input
                type="checkbox"
                checked={autostart === true}
                disabled={autostart === null}
                onChange={(e) => changeAutostart(e.target.checked)}
              />
            </label>
            <p className="hint">
              {autostart === null ? t("settings.autostartUnknown") : t("settings.autostartHint")}
            </p>
            <button type="button" className="btn" onClick={openDefaultApps}>
              {t("settings.openDefaultApps")}
            </button>
            <p className="hint">{t("settings.defaultAppsHint")}</p>
            {resetArmed ? (
              <>
                <p className="hint">{t("settings.resetConfirm")}</p>
                <button type="button" className="btn danger" onClick={resetSettings}>
                  {t("settings.resetNow")}
                </button>
                <button type="button" className="btn" onClick={() => setResetArmed(false)}>
                  {t("settings.resetCancel")}
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setResetArmed(true)}>
                {t("settings.reset")}
              </button>
            )}
            {message && (
              <p className="hint ok">
                <CheckCircleIcon /> {message}
              </p>
            )}
          </Section>
        </div>
      </main>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="settings-section">
      <h2 className="settings-title">{title}</h2>
      {children}
    </section>
  );
}

/// Mục lục trái của trang Cài đặt: mỗi mục có icon, thuộc một nhóm phân cách,
/// và thứ tự phải khớp thứ tự các thẻ trong ô nội dung (bôi theo cuộn dùng nó).
const SECTIONS: { id: string; label: Key; icon: ComponentType; group: number }[] = [
  { id: "settings-you", label: "settings.you", icon: UserIcon, group: 0 },
  { id: "settings-appearance", label: "settings.appearance", icon: PaletteIcon, group: 0 },
  { id: "settings-layout", label: "settings.layout", icon: GridIcon, group: 0 },
  { id: "settings-search", label: "settings.search", icon: SearchIcon, group: 0 },
  { id: "settings-startup", label: "settings.startup", icon: PowerIcon, group: 0 },
  { id: "settings-privacy", label: "settings.privacy", icon: LockIcon, group: 1 },
  { id: "settings-permissions", label: "settings.permissions", icon: KeyIcon, group: 1 },
  { id: "settings-adblock", label: "settings.adblock", icon: ShieldIcon, group: 1 },
  { id: "settings-performance", label: "settings.performance", icon: BoltIcon, group: 1 },
  { id: "settings-downloads", label: "settings.downloads", icon: DownloadIcon, group: 1 },
  { id: "settings-languages", label: "settings.languages", icon: TranslateIcon, group: 1 },
  { id: "settings-passwords", label: "settings.passwords", icon: KeyIcon, group: 2 },
  { id: "settings-system", label: "settings.system", icon: SettingsIcon, group: 2 },
];

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
