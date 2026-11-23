// Quản lý tiện ích: cài từ thư mục/zip, duyệt quyền, bật/tắt, gỡ.
// Không dùng dialog plugin: thanh công cụ chỉ có quyền core:default, nên đường
// dẫn được nhập trực tiếp — ít quyền hơn và chạy được trong preview.
import { useEffect, useState } from "react";
import { cmd } from "./tabs";
import { t, type Key } from "./i18n";
import { CheckCircleIcon, PuzzleIcon, TrashIcon } from "./Icons";

interface ExtInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  active: boolean;
  installedAt: number;
  requested: string[];
  granted: string[];
  hostPermissions: string[];
  storageBytes: number;
}

interface Inspection {
  manifest: { name?: string; description?: string; author?: string };
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  requested: string[];
  defaults: string[];
  hostPermissions: string[];
  sourceKind: string;
  sourceSha256: string;
  installed: boolean;
}

interface ExtLog {
  level: string;
  message: string;
  createdAt: number;
}

const TEMPLATES = [
  {
    id: "focus-mode",
    name: "Focus mode",
    version: "1.0.0",
    match: "https://*/*",
    description: "Ẩn các phần tử gây xao nhãng trên trang.",
    js: "document.querySelectorAll('aside, .sidebar, .recommended').forEach((el) => el.style.setProperty('display', 'none', 'important'));",
    css: "video:fullscreen { outline: 2px solid #6d8cff; }",
  },
  {
    id: "reading-mode",
    name: "Reading mode",
    version: "1.0.0",
    match: "https://*/*",
    description: "Tăng khả năng đọc bằng nền và cỡ chữ dễ nhìn hơn.",
    js: "document.documentElement.dataset.bytwinaReading = '1';",
    css: "body { line-height: 1.7 !important; } article, main { max-width: 780px !important; margin-inline: auto !important; }",
  },
];

function capLabel(cap: string): string {
  const key = `cap.${cap}` as Key;
  const text = t(key);
  return text === key ? cap : text;
}

function bytesText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function message(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

export default function ExtensionsPanel() {
  const [items, setItems] = useState<ExtInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState("");
  const [inspected, setInspected] = useState<Inspection | null>(null);
  const [grants, setGrants] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftVersion, setDraftVersion] = useState("1.0.0");
  const [draftMatch, setDraftMatch] = useState("https://example.com/*");
  const [draftJs, setDraftJs] = useState("");
  const [draftCss, setDraftCss] = useState("");
  const [logs, setLogs] = useState<ExtLog[]>([]);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);

  async function reload() {
    try {
      const rows = (await cmd("ext_list")) as ExtInfo[] | null;
      setItems(Array.isArray(rows) ? rows : []);
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    void cmd("settings_get", { key: "extensionsPreview" })
      .then((value) => setPreviewEnabled(value === "1"))
      .catch(() => setPreviewEnabled(false));
  }, []);

  async function setPreview(enabled: boolean) {
    setPreviewBusy(true);
    setError("");
    try {
      await cmd("ext_preview_set", { enabled: enabled ? "1" : "0" });
      setPreviewEnabled(enabled);
      setNotice(enabled ? t("ext.previewEnabled") : t("ext.previewDisabled"));
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  useEffect(() => {
    if (!selectedId) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    void cmd("ext_logs", { id: selectedId, limit: "100" })
      .then((value) => {
        if (!cancelled) setLogs(Array.isArray(value) ? (value as ExtLog[]) : []);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function inspect() {
    const p = path.trim();
    if (!p) {
      setError(t("ext.needPath"));
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const isUrl = /^https:\/\//i.test(p);
      const info = (await cmd(isUrl ? "ext_inspect_from_url" : "ext_inspect", isUrl ? { url: p } : { path: p })) as Inspection;
      setInspected(info);
      // Mặc định chọn sẵn mọi quyền xin thêm; người dùng có thể bỏ dấu.
      setGrants([...info.requested]);
    } catch (e) {
      setInspected(null);
      setError(`${t("ext.invalid")}: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (!inspected) return;
    setBusy(true);
    setError("");
    try {
      const source = path.trim();
      const isUrl = /^https:\/\//i.test(source);
      const out = (await cmd(
        isUrl ? "ext_install_from_url" : "ext_install",
        isUrl
          ? { url: source, grants, expectedSha256: inspected.sourceSha256 }
          : { path: source, grants, expectedSha256: inspected.sourceSha256 },
      )) as {
        name?: string;
      };
      setNotice(t("ext.installed").replace("{name}", out?.name ?? inspected.name));
      setInspected(null);
      setPath("");
      setGrants([]);
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(ext: ExtInfo) {
    setBusy(true);
    setError("");
    try {
      await cmd("ext_toggle", { id: ext.id, active: ext.active ? "0" : "1" });
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function grant(ext: ExtInfo, cap: string, on: boolean) {
    setBusy(true);
    setError("");
    try {
      await cmd("ext_grant", { id: ext.id, capability: cap, granted: on ? "1" : "0" });
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(ext: ExtInfo) {
    if (!window.confirm(t("ext.removeConfirm").replace("{name}", ext.name))) return;
    setBusy(true);
    setError("");
    try {
      await cmd("ext_remove", { id: ext.id });
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearStorage(ext: ExtInfo) {
    setBusy(true);
    try {
      await cmd("ext_storage_clear", { id: ext.id });
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportExtension(ext: ExtInfo) {
    const destination = window.prompt(
      "Đường dẫn tệp xuất .bytwina-ext",
      `${ext.id}-${ext.version}.bytwina-ext`,
    );
    if (!destination?.trim()) return;
    setBusy(true);
    setError("");
    try {
      await cmd("ext_export", { id: ext.id, path: destination.trim() });
      setNotice(`Đã xuất “${ext.name}”.`);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draftName.trim() || !draftMatch.trim() || (!draftJs.trim() && !draftCss.trim())) {
      setError("Cần nhập tên, match pattern và JavaScript hoặc CSS.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await cmd("ext_add", {
        name: draftName.trim(), version: draftVersion.trim() || "1.0.0",
        match_pattern: draftMatch.trim(), js: draftJs, css: draftCss,
      });
      setNotice(`Đã lưu tiện ích “${draftName.trim()}”.`);
      setDraftName(""); setDraftJs(""); setDraftCss("");
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function testDraft() {
    setBusy(true);
    setError("");
    try {
      await cmd("ext_test", {
        name: draftName.trim() || "Draft extension",
        version: draftVersion.trim() || "1.0.0",
        match_pattern: draftMatch.trim(), js: draftJs, css: draftCss,
      });
      setNotice("Manifest và match pattern hợp lệ.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function installTemplate(template: (typeof TEMPLATES)[number]) {
    setBusy(true);
    setError("");
    try {
      await cmd("ext_add", {
        name: template.name,
        version: template.version,
        match_pattern: template.match,
        js: template.js,
        css: template.css,
      });
      setNotice(`Đã cài template “${template.name}”. Hãy bật trong danh sách.`);
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ext-panel">
      <section className="ext-editor" role="note">
        <div className="ext-list-head">
          <div>
            <h3 className="ext-heading">{t("ext.previewTitle")}</h3>
            <p className="ext-hint">{t("ext.previewDescription")}</p>
            <p className="ext-sub">{previewEnabled ? t("ext.previewEnabled") : t("ext.previewDisabled")}</p>
          </div>
          <button type="button" className={previewEnabled ? "btn" : "btn primary"} disabled={previewBusy} onClick={() => void setPreview(!previewEnabled)}>
            {previewEnabled ? t("ext.previewTurnOff") : t("ext.previewTurnOn")}
          </button>
        </div>
      </section>
      <section className="ext-install">
        <h3 className="ext-heading">{t("ext.installTitle")}</h3>
        <p className="ext-hint">{t("ext.inspectHint")}</p>
        <div className="row-inline">
          <input
            className="field"
            placeholder={t("ext.pathPlaceholder")}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void inspect();
            }}
          />
          <button type="button" className="btn" disabled={busy} onClick={() => void inspect()}>
            {t("ext.inspect")}
          </button>
        </div>
        {inspected && (
          <div className="ext-inspect">
            <div className="ext-inspect-head">
              <PuzzleIcon />
              <div>
                <strong>{inspected.name}</strong>
                <span className="ext-sub">
                  {t("ext.version")} {inspected.version}
                  {inspected.author ? ` · ${inspected.author}` : ""} ·{" "}
                  {inspected.sourceKind === "zip" ? "ZIP" : "Folder"}
                </span>
              </div>
            </div>
            {inspected.description && <p className="ext-desc">{inspected.description}</p>}
            <p className="ext-hint">
              SHA-256: <code>{inspected.sourceSha256}</code>
            </p>
            {inspected.hostPermissions.length > 0 && (
              <p className="ext-hint">
                {t("ext.hostPermissions")}: <code>{inspected.hostPermissions.join(", ")}</code>
              </p>
            )}
            <div className="ext-caps">
              {inspected.requested.length === 0 ? (
                <span className="ext-sub">{t("ext.noPermissions")}</span>
              ) : (
                inspected.requested.map((cap) => (
                  <label key={cap} className="ext-cap">
                    <input
                      type="checkbox"
                      checked={grants.includes(cap)}
                      onChange={(e) =>
                        setGrants((prev) =>
                          e.target.checked ? [...prev, cap] : prev.filter((c) => c !== cap),
                        )
                      }
                    />
                    <span>{capLabel(cap)}</span>
                    <code>{cap}</code>
                  </label>
                ))
              )}
            </div>
            <p className="ext-warn">{t("ext.untrusted")}</p>
            <div className="row-inline">
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void install()}
              >
                {busy ? t("ext.installing") : t("ext.install")}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setInspected(null)}>
                {t("panel.close")}
              </button>
            </div>
          </div>
        )}
        {error && <p className="ext-error">{error}</p>}
        {notice && (
          <p className="ext-ok">
            <CheckCircleIcon /> {notice}
          </p>
        )}
      </section>

      <section className="ext-editor">
        <div className="ext-list-head">
          <div>
            <h3 className="ext-heading">Tạo tiện ích</h3>
            <p className="ext-hint">Paste mã JS/CSS và pattern URL để cài nhanh.</p>
          </div>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void saveDraft()}>
            Lưu
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void testDraft()}>
            Test
          </button>
        </div>
        <div className="row-inline">
          <input className="field" placeholder="Tên tiện ích" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
          <input className="field" placeholder="Version" value={draftVersion} onChange={(e) => setDraftVersion(e.target.value)} />
          <input className="field" placeholder="https://example.com/*" value={draftMatch} onChange={(e) => setDraftMatch(e.target.value)} />
        </div>
        <div className="row-inline ext-editor-grid">
          <textarea className="field ext-code" aria-label="JavaScript" placeholder="JavaScript" value={draftJs} onChange={(e) => setDraftJs(e.target.value)} />
          <textarea className="field ext-code" aria-label="CSS" placeholder="CSS" value={draftCss} onChange={(e) => setDraftCss(e.target.value)} />
        </div>
      </section>

      <section className="ext-editor ext-templates">
        <div className="ext-list-head">
          <div>
            <h3 className="ext-heading">Kho template nhanh</h3>
            <p className="ext-hint">Cài một lần, không cần copy-paste code. Template được cài tắt để bạn kiểm tra trước.</p>
          </div>
        </div>
        <div className="ext-template-grid">
          {TEMPLATES.map((template) => (
            <article className="ext-template" key={template.id}>
              <strong>{template.name}</strong>
              <p className="ext-sub">{template.description}</p>
              <button type="button" className="btn" disabled={busy} onClick={() => void installTemplate(template)}>
                Cài template
              </button>
            </article>
          ))}
        </div>
      </section>

      {selectedId && (() => {
        const selected = items.find((item) => item.id === selectedId);
        if (!selected) return null;
        return (
          <section className="ext-editor">
            <div className="ext-log-viewer">
              <div className="ext-list-head">
                <strong>Log runtime</strong>
                <button type="button" className="btn" onClick={() => setSelectedId(selected.id)}>
                  Tải lại
                </button>
              </div>
              {logs.length === 0 ? (
                <p className="ext-sub">Chưa có lỗi runtime.</p>
              ) : (
                <div className="ext-log-list">
                  {logs.map((log, index) => (
                    <div className="ext-log-entry" key={`${log.createdAt}-${index}`}>
                      <code>{new Date(log.createdAt * 1000).toLocaleString()}</code>
                      <span className="ext-log-level">{log.level}</span>
                      <pre>{log.message}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="ext-list-head">
              <div>
                <h3 className="ext-heading">{selected.name}</h3>
                <p className="ext-hint">v{selected.version}{selected.author ? ` · ${selected.author}` : ""}</p>
              </div>
              <button type="button" className="btn" onClick={() => setSelectedId(null)}>Đóng</button>
            </div>
            <p className="ext-desc">{selected.description || "Không có mô tả."}</p>
            <p className="ext-hint">Matches: {selected.hostPermissions.length ? selected.hostPermissions.join(", ") : "Không khai báo"}</p>
            <p className="ext-hint">Storage: {bytesText(selected.storageBytes)} · Trạng thái: {selected.active ? "Bật" : "Tắt"}</p>
            <p className="ext-sub">Log & thống kê: số lần chạy và lỗi sẽ được bổ sung khi có telemetry riêng cho extension.</p>
          </section>
        );
      })()}

      <div className="ext-list-head">
        <h3 className="ext-heading">{t("title.extensions")}</h3>
        <button type="button" className="btn" onClick={() => void reload()} disabled={busy}>
          {t("ext.refresh")}
        </button>
      </div>
      <p className="ext-hint">{t("ext.reloadHint")}</p>

      {loading ? (
        <p className="ext-sub">{t("ext.loading")}</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <PuzzleIcon />
          <span>{t("ext.empty")}</span>
        </div>
      ) : (
        <ul className="list">
          {items.map((ext) => (
            <li key={ext.id} className={`ext-item${selectedId === ext.id ? " selected" : ""}`} onClick={() => setSelectedId(ext.id)}>
              <div className="ext-item-main">
                <span className="row-icon">
                  <PuzzleIcon />
                </span>
                <div className="list-main">
                  <span className="list-title">
                    {ext.name}{" "}
                    <small className="ext-version">
                      {ext.version}
                      {ext.author ? ` · ${ext.author}` : ""}
                    </small>
                  </span>
                  <span className="list-sub">
                    {ext.active ? t("ext.enabled") : t("ext.disabled")} · {ext.id}
                  </span>
                  {ext.description && <span className="ext-desc">{ext.description}</span>}
                </div>
                <button
                  type="button"
                  className={`btn ${ext.active ? "" : "primary"}`}
                  disabled={busy}
                  onClick={() => void toggle(ext)}
                  style={{ height: 28, padding: "0 10px", fontSize: 12 }}
                >
                  {ext.active ? t("ext.disable") : t("ext.enable")}
                </button>
                <button
                  type="button"
                  className="row-remove"
                  title={t("ext.remove")}
                  disabled={busy}
                  onClick={() => void remove(ext)}
                >
                  <TrashIcon />
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void exportExtension(ext)}
                  style={{ height: 28, padding: "0 10px", fontSize: 12 }}
                >
                  Xuất
                </button>
              </div>
              <div className="ext-meta">
                <span>
                  {t("ext.permissions")}:
                </span>
                <div className="ext-caps">
                  {ext.requested.length === 0 ? (
                    <span className="ext-sub">{t("ext.noPermissions")}</span>
                  ) : (
                    ext.requested.map((cap) => (
                      <label key={cap} className="ext-cap compact">
                        <input
                          type="checkbox"
                          checked={ext.granted.includes(cap)}
                          disabled={busy}
                          onChange={(e) => void grant(ext, cap, e.target.checked)}
                        />
                        <span>{capLabel(cap)}</span>
                        <code>{cap}</code>
                      </label>
                    ))
                  )}
                </div>
                {ext.hostPermissions.length > 0 && (
                  <span className="ext-sub">
                    {t("ext.hostPermissions")}: <code>{ext.hostPermissions.join(", ")}</code>
                  </span>
                )}
                <span className="ext-sub">
                  {t("ext.storage")}: {bytesText(ext.storageBytes)}
                  {ext.storageBytes > 0 && (
                    <button
                      type="button"
                      className="linklike"
                      disabled={busy}
                      onClick={() => void clearStorage(ext)}
                    >
                      {t("ext.clearStorage")}
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
