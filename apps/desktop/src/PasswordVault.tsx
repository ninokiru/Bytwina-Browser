import { useEffect, useState } from "react";
import { cmd } from "./tabs";
import { t, useLang } from "./i18n";
import {
  CheckCircleIcon,
  CopyIcon,
  EyeIcon,
  KeyIcon,
  LockIcon,
  PlusIcon,
  TrashIcon,
} from "./Icons";

interface VaultStatus {
  configured: boolean;
  unlocked: boolean;
  count: number;
  autoLock: number;
}

interface Entry {
  id: number;
  title: string;
  url: string;
  username: string;
  updatedAt: number;
}

interface Secret {
  password: string;
  note: string;
}

interface FormState {
  id: number | null;
  title: string;
  url: string;
  username: string;
  password: string;
  note: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  title: "",
  url: "",
  username: "",
  password: "",
  note: "",
};

const AUTO_LOCK_OPTIONS = [0, 1, 5, 15, 30, 60];

/// Kho mật khẩu cục bộ: mật khẩu chủ chỉ dùng để suy khóa Argon2id ở backend,
/// không được lưu. Giao diện này không tự điền vào trang web; người dùng bấm
/// sao chép hoặc hiện mật khẩu.
export default function PasswordVault() {
  useLang();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [master, setMaster] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [wipeArmed, setWipeArmed] = useState(false);

  const refresh = async () => {
    const s = (await cmd("password_status")) as VaultStatus;
    setStatus(s);
    if (s.unlocked) {
      const list = (await cmd("password_list")) as Entry[];
      setEntries(Array.isArray(list) ? list : []);
    } else {
      setEntries([]);
      setForm(null);
    }
  };

  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, []);

  // Mọi thao tác đều khóa nút trong lúc chờ: Argon2id cố ý chậm để chống dò.
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    void fn()
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const setup = () =>
    run(async () => {
      if (master.length < 8) throw new Error(t("pw.minChars"));
      if (master !== confirm) throw new Error(t("pw.mismatch"));
      await cmd("password_setup", { master });
      setMaster("");
      setConfirm("");
      await refresh();
      setNotice(t("pw.created"));
    });

  const unlock = () =>
    run(async () => {
      await cmd("password_unlock", { master });
      setMaster("");
      await refresh();
      setNotice(t("pw.unlockedNow"));
    });

  const lock = () =>
    run(async () => {
      await cmd("password_lock");
      setRevealed({});
      setForm(null);
      await refresh();
    });

  const openAdd = () => {
    setForm({ ...EMPTY_FORM });
    setNotice("");
    setError("");
  };

  const openEdit = (entry: Entry) =>
    run(async () => {
      const secret = (await cmd("password_reveal", { id: String(entry.id) })) as Secret;
      setForm({
        id: entry.id,
        title: entry.title,
        url: entry.url,
        username: entry.username,
        password: secret.password,
        note: secret.note,
      });
    });

  const saveForm = () =>
    run(async () => {
      if (!form) return;
      if (!form.password) throw new Error(t("pw.passwordRequired"));
      const args = {
        id: String(form.id ?? 0),
        title: form.title.trim() || hostOf(form.url),
        url: form.url.trim(),
        username: form.username.trim(),
        password: form.password,
        note: form.note,
      };
      if (form.id == null) await cmd("password_add", args);
      else await cmd("password_update", args);
      setForm(null);
      await refresh();
      setNotice(t("pw.saved"));
    });

  const remove = (entry: Entry) => {
    if (!window.confirm(t("pw.deleteConfirm"))) return;
    run(async () => {
      await cmd("password_remove", { id: String(entry.id) });
      await refresh();
      setNotice(t("pw.deleted"));
    });
  };

  const reveal = (id: number) => {
    if (revealed[id] != null) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    run(async () => {
      const secret = (await cmd("password_reveal", { id: String(id) })) as Secret;
      setRevealed((prev) => ({ ...prev, [id]: secret.password }));
    });
  };

  const copy = (id: number) =>
    run(async () => {
      const secret = (await cmd("password_reveal", { id: String(id) })) as Secret;
      await writeClipboard(secret.password);
      setNotice(t("pw.copied"));
    });

  const changeAutoLock = (minutes: string) =>
    run(async () => {
      await cmd("password_autolock", { minutes });
      setStatus((s) => (s ? { ...s, autoLock: Number(minutes) } : s));
    });

  const wipe = () =>
    run(async () => {
      await cmd("password_wipe");
      setWipeArmed(false);
      setMaster("");
      setRevealed({});
      await refresh();
      setNotice(t("pw.wiped"));
    });

  if (!status) {
    return <p className="hint">{t("pw.loading")}</p>;
  }

  // Chưa thiết lập: tạo mật khẩu chủ. Chỉ lưu salt + bản kiểm tra, không lưu mật khẩu.
  if (!status.configured) {
    return (
      <div className="vault">
        <p className="hint">{t("pw.intro")}</p>
        <label className="settings-stack">
          {t("pw.master")}
          <input
            className="field"
            type="password"
            value={master}
            autoComplete="new-password"
            onChange={(e) => setMaster(e.target.value)}
          />
        </label>
        <label className="settings-stack">
          {t("pw.masterConfirm")}
          <input
            className="field"
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <p className="hint">{t("pw.masterHint")}</p>
        <button type="button" className="btn primary" disabled={busy} onClick={setup}>
          <LockIcon /> {t("pw.create")}
        </button>
        <Messages error={error} notice={notice} />
      </div>
    );
  }

  // Đã thiết lập nhưng khóa: chỉ mở bằng mật khẩu chủ.
  if (!status.unlocked) {
    return (
      <div className="vault">
        <p className="vault-state">
          <LockIcon />
          <span>
            <b>{t("pw.lockedTitle")}</b>
            <small>{t("pw.lockedHint")}</small>
          </span>
        </p>
        <label className="settings-stack">
          {t("pw.master")}
          <input
            className="field"
            type="password"
            value={master}
            autoComplete="current-password"
            onChange={(e) => setMaster(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") unlock();
            }}
          />
        </label>
        <button type="button" className="btn primary" disabled={busy} onClick={unlock}>
          <KeyIcon /> {t("pw.unlock")}
        </button>
        {wipeArmed ? (
          <div className="vault-wipe">
            <p className="hint">
              <strong>{t("pw.wipeConfirm")}</strong>
            </p>
            <div className="btn-row">
              <button type="button" className="btn danger" disabled={busy} onClick={wipe}>
                {t("pw.wipeNow")}
              </button>
              <button type="button" className="btn" onClick={() => setWipeArmed(false)}>
                {t("pw.wipeCancel")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="vault-link" onClick={() => setWipeArmed(true)}>
            {t("pw.forgot")}
          </button>
        )}
        <Messages error={error} notice={notice} />
      </div>
    );
  }

  const keyword = query.trim().toLowerCase();
  const shown = entries.filter((e) =>
    keyword === ""
      ? true
      : `${e.title} ${e.url} ${e.username}`.toLowerCase().includes(keyword),
  );

  return (
    <div className="vault">
      <div className="vault-bar">
        <p className="vault-state open">
          <KeyIcon />
          <span>
            <b>{t("pw.title")}</b>
            <small>
              {status.count} {t("pw.items")} · {t("pw.unlocked")}
            </small>
          </span>
        </p>
        <div className="vault-actions">
          <button type="button" className="btn" onClick={openAdd} disabled={busy}>
            <PlusIcon /> {t("pw.add")}
          </button>
          <button type="button" className="btn" onClick={lock} disabled={busy}>
            <LockIcon /> {t("pw.lock")}
          </button>
        </div>
      </div>

      <label className="settings-row">
        {t("pw.autoLock")}
        <select
          value={String(status.autoLock)}
          onChange={(e) => changeAutoLock(e.target.value)}
          disabled={busy}
        >
          {AUTO_LOCK_OPTIONS.map((m) => (
            <option key={m} value={String(m)}>
              {m === 0 ? t("pw.autoLockOff") : `${m} ${t("pw.minutes")}`}
            </option>
          ))}
        </select>
      </label>

      <input
        className="field"
        value={query}
        placeholder={t("pw.search")}
        onChange={(e) => setQuery(e.target.value)}
      />

      {form && (
        <div className="vault-form">
          <p className="vault-form-title">
            {form.id == null ? t("pw.formAdd") : t("pw.formEdit")}
          </p>
          <div className="vault-grid">
            <label className="settings-stack">
              {t("pw.fieldTitle")}
              <input
                className="field"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="settings-stack">
              {t("pw.fieldUrl")}
              <input
                className="field"
                value={form.url}
                placeholder="https://"
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </label>
            <label className="settings-stack">
              {t("pw.fieldUsername")}
              <input
                className="field"
                value={form.username}
                autoComplete="off"
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
            <label className="settings-stack">
              {t("pw.fieldPassword")}
              <input
                className="field"
                type="text"
                value={form.password}
                autoComplete="new-password"
                spellCheck={false}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
          </div>
          <label className="settings-stack">
            {t("pw.fieldNote")}
            <input
              className="field"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <div className="btn-row">
            <button type="button" className="btn primary" disabled={busy} onClick={saveForm}>
              {t("pw.save")}
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              {t("pw.cancel")}
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="hint">{entries.length === 0 ? t("pw.empty") : t("pw.noMatch")}</p>
      ) : (
        <ul className="vault-list">
          {shown.map((entry) => (
            <li key={entry.id}>
              <div className="vault-item-head">
                <b>{entry.title || hostOf(entry.url) || t("pw.untitled")}</b>
                <small>{entry.username || t("pw.noUsername")}</small>
              </div>
              <div className="vault-item-body">
                <span className="vault-secret">
                  {revealed[entry.id] ?? "••••••••••••"}
                </span>
                <span className="vault-item-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title={revealed[entry.id] ? t("pw.hide") : t("pw.show")}
                    onClick={() => reveal(entry.id)}
                  >
                    <EyeIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t("pw.copy")}
                    onClick={() => copy(entry.id)}
                  >
                    <CopyIcon />
                  </button>
                  <button type="button" className="btn" onClick={() => openEdit(entry)}>
                    {t("pw.edit")}
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title={t("pw.delete")}
                    onClick={() => remove(entry)}
                  >
                    <TrashIcon />
                  </button>
                </span>
              </div>
              {entry.url && <small className="vault-url">{entry.url}</small>}
            </li>
          ))}
        </ul>
      )}

      <Messages error={error} notice={notice} />

      {wipeArmed ? (
        <div className="vault-wipe">
          <p className="hint">
            <strong>{t("pw.wipeConfirm")}</strong>
          </p>
          <div className="btn-row">
            <button type="button" className="btn danger" disabled={busy} onClick={wipe}>
              {t("pw.wipeNow")}
            </button>
            <button type="button" className="btn" onClick={() => setWipeArmed(false)}>
              {t("pw.wipeCancel")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="vault-link" onClick={() => setWipeArmed(true)}>
          {t("pw.wipe")}
        </button>
      )}
    </div>
  );
}

function Messages({ error, notice }: { error: string; notice: string }) {
  if (error) {
    return (
      <p className="hint vault-error">
        <KeyIcon /> {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="hint ok">
        <CheckCircleIcon /> {notice}
      </p>
    );
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/// WebView2 có thể chặn Clipboard API khi không có thao tác trực tiếp; thử
/// navigator.clipboard trước rồi lùi về textarea + execCommand.
async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
