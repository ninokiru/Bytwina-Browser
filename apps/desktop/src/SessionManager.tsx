import { useEffect, useState } from "react";
import { cmd } from "./tabs";
import { t, useLang } from "./i18n";
import { LayersIcon, TrashIcon } from "./Icons";

interface SavedSession {
  name: string;
  tabCount: number;
  createdAt: number;
}

// Quản lý phiên lưu trong Cài đặt: cùng IPC với bảng "Phiên đã lưu" ở menu,
// nhưng đặt cạnh các cài đặt khởi động để người dùng tìm thấy tự nhiên hơn.
export default function SessionManager() {
  useLang();
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const list = (await cmd("session_list_named").catch(() => [])) as SavedSession[];
    setSessions(list ?? []);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await cmd("session_save_named", { name: n });
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="session-manager">
      <div className="row-inline">
        <input
          className="field"
          value={name}
          placeholder={t("sessions.placeholder")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <button type="button" className="btn primary" disabled={!name.trim() || busy} onClick={() => void save()}>
          {t("sessions.save")}
        </button>
      </div>
      <p className="settings-soon">{t("sessions.hint")}</p>
      {sessions.length === 0 ? (
        <p className="settings-soon">{t("sessions.empty")}</p>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.name} className="session-row">
              <span className="session-icon">
                <LayersIcon />
              </span>
              <div className="session-main">
                <b>{s.name}</b>
                <small>
                  {t("sessions.tabCount").replace("{n}", String(s.tabCount))} ·{" "}
                  {new Date(s.createdAt * 1000).toLocaleDateString()}
                </small>
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void cmd("session_restore_named", { name: s.name });
                }}
              >
                {t("sessions.restore")}
              </button>
              <button
                type="button"
                className="icon-btn danger"
                title={t("sessions.delete")}
                onClick={() => {
                  void cmd("session_delete_named", { name: s.name }).then(load);
                }}
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
