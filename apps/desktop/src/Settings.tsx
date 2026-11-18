import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cmd } from "./tabs";
import { getLang, setLang, t, useLang, type Lang } from "./i18n";
import { applyTheme } from "./theme";

interface Diagnostics {
  appVersion: string;
  webviewVersion: string;
  os: string;
  dbAvailable: boolean;
}

const ZOOM_OPTIONS = [50, 75, 90, 100, 110, 125, 150, 175, 200];

// Mỗi mục đều được backend đọc từ CSDL (settings_get/settings_set) và có tác dụng thật.
export default function Settings({
  privateMode,
  onHomeChange,
}: {
  privateMode: boolean;
  onHomeChange: (url: string) => void;
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
  const [message, setMessage] = useState("");
  const [diag, setDiag] = useState<Diagnostics | null>(null);

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
    ]).then(([h, e, s, d, z, th, c]) => {
      if (h) setHome(h);
      if (e) setEngine(e);
      if (s) setStartup(s);
      if (d) setDownloadDir(d);
      if (z) setZoom(z);
      if (th) setTheme(th);
      setClearOnExit(c === "1");
    });
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Section title={t("settings.general")}>
        <label style={row}>
          {t("settings.language")}
          <select value={lang} onChange={(e) => changeLang(e.target.value as Lang)}>
            <option value="vi">{t("settings.langVi")}</option>
            <option value="en">{t("settings.langEn")}</option>
          </select>
        </label>
        <label style={row}>
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
        <label style={row}>
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
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {t("settings.homepage")}
          <input value={home} onChange={(e) => setHome(e.target.value)} onBlur={saveHome} />
        </label>
        <small style={hint}>{t("settings.homeHint")}</small>
      </Section>

      <Section title={t("settings.appearance")}>
        <label style={row}>
          {t("settings.theme")}
          <select value={theme} onChange={(e) => changeTheme(e.target.value)}>
            <option value="system">{t("settings.themeSystem")}</option>
            <option value="light">{t("settings.themeLight")}</option>
            <option value="dark">{t("settings.themeDark")}</option>
          </select>
        </label>
        <label style={row}>
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

      <Section title={t("settings.privacy")}>
        <label style={row}>
          {t("settings.privateMode")}
          <input
            type="checkbox"
            checked={privateMode}
            onChange={(e) => void cmd("private_set", { on: e.target.checked ? "1" : "0" })}
          />
        </label>
        <small style={hint}>{t("settings.privateHint")}</small>
        <label style={row}>
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
        <small style={hint}>{t("settings.clearOnExitHint")}</small>
        <small style={hint}>
          {t("settings.cookies")}: {t("settings.cookiesNote")}
        </small>
        <button onClick={clearData}>{t("settings.clearData")}</button>
        {message && <small style={hint}>{message}</small>}
      </Section>

      <Section title={t("settings.downloads")}>
        <input
          value={downloadDir}
          placeholder={t("settings.downloadDirPlaceholder")}
          onChange={(e) => setDownloadDir(e.target.value)}
          onBlur={() => save("downloadDir", downloadDir.trim())}
        />
        <small style={hint}>{t("settings.downloadDirHint")}</small>
        <small style={hint}>{t("settings.downloadsHint")}</small>
      </Section>

      <Section title={t("settings.about")}>
        <button onClick={loadDiagnostics}>{t("settings.diagnostics")}</button>
        {diag && (
          <dl
            style={{
              margin: 0,
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "4px 10px",
              fontSize: 12,
            }}
          >
            <dt>{t("settings.version")}</dt>
            <dd style={{ margin: 0 }}>{diag.appVersion}</dd>
            <dt>{t("settings.webview")}</dt>
            <dd style={{ margin: 0, wordBreak: "break-all" }}>{diag.webviewVersion}</dd>
            <dt>{t("settings.storage")}</dt>
            <dd style={{ margin: 0 }}>
              {diag.dbAvailable ? t("settings.storageOk") : t("settings.storageOff")}
            </dd>
          </dl>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong style={{ fontSize: 12, color: "var(--muted)" }}>{title}</strong>
      {children}
    </section>
  );
}

const row: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};
const hint: CSSProperties = { color: "var(--muted)", lineHeight: 1.4 };
