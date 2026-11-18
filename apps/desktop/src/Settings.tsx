import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cmd } from "./tabs";
import { getLang, setLang, t, useLang, type Key, type Lang } from "./i18n";

interface Diagnostics {
  appVersion: string;
  webviewVersion: string;
  os: string;
  dbAvailable: boolean;
}

// Trang Cài đặt: các mục đều có tác dụng thật. Chủ đề, công cụ tìm kiếm, khởi động
// và thư mục tải xuống tùy chọn cần hỗ trợ ở backend nên chưa đưa vào.
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
  const [message, setMessage] = useState("");
  const [diag, setDiag] = useState<Diagnostics | null>(null);

  useEffect(() => {
    void cmd("settings_get", { key: "homeUrl" })
      .then((v) => {
        if (typeof v === "string" && v) setHome(v);
      })
      .catch(() => undefined);
  }, []);

  const changeLang = (next: Lang) => {
    setLang(next);
    setLangState(next);
    void cmd("settings_set", { key: "language", value: next }).catch(() => undefined);
  };

  const saveHome = () => {
    void cmd("settings_set", { key: "homeUrl", value: home }).catch(() => undefined);
    onHomeChange(home);
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
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {t("settings.homepage")}
          <input
            value={home}
            onChange={(e) => setHome(e.target.value)}
            onBlur={saveHome}
          />
        </label>
        <small style={hint}>{t("settings.homeHint")}</small>
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
        <button onClick={clearData}>{t("settings.clearData")}</button>
        {message && <small style={hint}>{message}</small>}
      </Section>

      <Section title={t("settings.downloads")}>
        <small style={hint}>{t("settings.downloadsHint")}</small>
      </Section>

      <Section title={t("settings.about")}>
        <button onClick={loadDiagnostics}>{t("settings.diagnostics")}</button>
        {diag && (
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", fontSize: 12 }}>
            <dt>{t("settings.version")}</dt>
            <dd style={{ margin: 0 }}>{diag.appVersion}</dd>
            <dt>{t("settings.webview")}</dt>
            <dd style={{ margin: 0, wordBreak: "break-all" }}>{diag.webviewVersion}</dd>
            <dt>{t("settings.storage" as Key)}</dt>
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
      <strong style={{ fontSize: 12, color: "#555" }}>{title}</strong>
      {children}
    </section>
  );
}

const row: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
const hint: CSSProperties = { color: "#666", lineHeight: 1.4 };
