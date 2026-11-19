import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { cmd } from "./tabs";
import { getLang, setLang, t, useLang, type Key, type Lang } from "./i18n";
import { applyTheme } from "./theme";
import { CheckCircleIcon, DownloadIcon, SettingsIcon, TrashIcon } from "./Icons";

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
          <SettingsIcon /> {t("bar.settings")}
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="settings-nav-item"
            onClick={() => jump(s.id)}
          >
            {t(s.label)}
          </button>
        ))}
        <div className="menu-sep" />
        <button type="button" className="settings-nav-item" onClick={onClose}>
          {t("panel.close")}
        </button>
      </aside>
      <main className="settings-main">
        <div className="settings">
      <Section id="settings-general" title={t("settings.general")}>
        <label className="settings-row">
          {t("settings.language")}
          <select value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
            <option value="vi">{t("settings.langVi")}</option>
            <option value="en">{t("settings.langEn")}</option>
          </select>
        </label>
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

      <Section id="settings-about" title={t("settings.about")}>
        <button type="button" className="btn" onClick={loadDiagnostics}>
          {t("settings.diagnostics")}
        </button>
        {diag && (
          <dl className="diag">
            <dt>{t("settings.version")}</dt>
            <dd>{diag.appVersion}</dd>
            <dt>{t("settings.webview")}</dt>
            <dd>{diag.webviewVersion}</dd>
            <dt>{t("settings.storage")}</dt>
            <dd>{diag.dbAvailable ? t("settings.storageOk") : t("settings.storageOff")}</dd>
          </dl>
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

/// Mục lục trái của trang Cài đặt, theo bố cục chrome://settings.
const SECTIONS: { id: string; label: Key }[] = [
  { id: "settings-general", label: "settings.general" },
  { id: "settings-appearance", label: "settings.appearance" },
  { id: "settings-adblock", label: "settings.adblock" },
  { id: "settings-privacy", label: "settings.privacy" },
  { id: "settings-downloads", label: "settings.downloads" },
  { id: "settings-about", label: "settings.about" },
];

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
