import { Fragment, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { cmd } from "./tabs";
import { getLang, setLang, t, useLang, type Key, type Lang } from "./i18n";
import { applyTheme } from "./theme";
import {
  AlertIcon,
  BoltIcon,
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
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

const ZOOM_OPTIONS = [50, 75, 90, 100, 110, 125, 150, 175, 200];

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
  const [clearOnExit, setClearOnExit] = useState(false);
  const [sleep, setSleep] = useState("0");
  const [message, setMessage] = useState("");
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [ab, setAb] = useState<AdblockStatus | null>(null);
  const [abBusy, setAbBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  const loadAdblock = () =>
    cmd("adblock_status")
      .then((s) => setAb(s as AdblockStatus))
      .catch(() => setAb(null));

  useEffect(() => {
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
    ]).then(([h, e, s, d, z, th, c, sl]) => {
      if (h) setHome(h);
      if (e) setEngine(e);
      if (s) setStartup(s);
      if (d) setDownloadDir(d);
      if (z) setZoom(z);
      if (th) setTheme(th);
      setClearOnExit(c === "1");
      if (sl) setSleep(sl);
    });
    void loadAdblock();
    // Mục "Bạn và Bytwina" hiện thông tin ngay, không cần bấm nút lấy chẩn đoán.
    void loadDiagnostics();
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

          <Section id="settings-search" title={t("settings.search")}>
            <label className="settings-row">
              {t("settings.searchEngine")}
              <select
                value={engine}
                onChange={(e) => {
                  setEngine(e.target.value);
                  save("searchEngine", e.target.value);
                }}
              >
                <option value="duckduckgo">{t("settings.engineDuck")}</option>
                <option value="google">{t("settings.engineGoogle")}</option>
                <option value="bing">{t("settings.engineBing")}</option>
                <option value="brave">{t("settings.engineBrave")}</option>
              </select>
            </label>
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
            <p className="settings-soon">
              <AlertIcon /> {t("settings.passwordsNote")}
            </p>
          </Section>

          <Section id="settings-system" title={t("settings.system")}>
            <p className="settings-soon">
              <AlertIcon /> {t("settings.systemNote")}
            </p>
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
  { id: "settings-search", label: "settings.search", icon: SearchIcon, group: 0 },
  { id: "settings-startup", label: "settings.startup", icon: PowerIcon, group: 0 },
  { id: "settings-privacy", label: "settings.privacy", icon: LockIcon, group: 1 },
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
