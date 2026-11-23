import { useEffect, useState } from "react";
import { cmd } from "./tabs";
import { t, useLang } from "./i18n";
import { LayersIcon, TrashIcon, PlusIcon, FileTextIcon, MoreIcon } from "./Icons";

interface SavedSession {
  name: string;
  tabCount: number;
  createdAt: number;
  // Danh sách tab IDs (tùy chọn, để hiển thị preview)
  tabIds?: number[];
}

// Quản lý phiên lưu trong Cài đặt: cùng IPC với bảng "Phiên đã lưu" ở menu,
// nhưng đặt cạnh các cài đặt khởi động để người dùng tìm thấy tự nhiên hơn.
export default function SessionManager() {
  useLang();
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

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

  const deleteSession = async (name: string) => {
    if (!name.trim()) return;
    await cmd("session_delete_named", { name });
    await load();
  };

  // Filter sessions by query
  const filteredSessions = sessions.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q) ||
      s.tabCount.toString().includes(q) ||
      new Date(s.createdAt * 1000).toLocaleDateString().toLowerCase().includes(q);
  });

  // Hiển thị preview nhỏ cho từng tab trong session
  const tabPreviewDots = (tabIds?: number | number[]) => {
    if (!tabIds) return null;
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    return (
      <div className="session-preview">
        {ids.slice(0, 3).map((tid) => (
          <span key={tid} className="tab-preview-dot" title={`Tab ${tid}`} />
        ))}
      </div>
    );
  };

  return (
    <div className="session-manager">
      <div className="row-inline">
        <input
          className="field"
          placeholder={t("sessions.placeholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <button type="button" className="btn primary" disabled={!name.trim() || busy} onClick={() => void save()}>
          {t("sessions.save")}
        </button>
        {/* Nút tạo phiên nhanh với tên mặc định */}
        <button
          type="button"
          className="btn"
          onClick={() => {
            const defaultName = `Phiên ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
            // Mở prompt cho user nhập tên
            const input = window.prompt("Nhập tên phiên:", defaultName);
            if (input && input.trim()) {
              setName(input.trim());
            }
          }}
        >
          {t("bar.newTab")}
        </button>
      </div>
      <p className="settings-soon">{t("sessions.hint")}</p>

      {/* Phần tìm kiếm/filter */}
      <div className="session-filter">
        <input
          className="field"
          placeholder={t("panel.searchTabs")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
      </div>

      {/* Danh sách phiên đã lưu - hiển thị với preview tab và actions */}
      {filteredSessions.length === 0 ? (
        <p className="settings-soon">{t("sessions.noTabs")}</p>
      ) : (
        <ul className="session-list">
          {filteredSessions.map((s) => (
            <li key={s.name} className="session-row">
              <span className="session-icon">
                <LayersIcon />
              </span>
              <div className="session-main">
                <b>{s.name}</b>
                <small>
                  {t("sessions.tabCount").replace("{n}", String(s.tabCount))} ·{" "}
                  {t("sessions.created").replace("{d}", new Date(s.createdAt * 1000).toLocaleDateString())}
                </small>
                {/* Hien thi preview tab nho ben duoi ten phien */}
                {tabPreviewDots(s.tabIds)}
              </div>
              <div className="session-actions">
                <button
                  type="button"
                  className="btn"
                  title={t("sessions.restore")}
                  onClick={() => {
                    void cmd("session_restore_named", { name: s.name }).then(() => {
                      // Đóng panel sau khi khôi phục
                      window.dispatchEvent(new Event("panel-close"));
                    });
                  }}
                >
                  {t("sessions.restore")}
                </button>
                <button
                  type="button"
                  className="btn"
                  title={t("sessions.duplicate")}
                  onClick={() => {
                    // Duplicate: lưu phiên hiện tại với tên mới (gọi save_named)
                    const dupName = `${s.name} (copy)`;
                    void cmd("session_save_named", { name: dupName }).then(load);
                  }}
                >
                  {t("sessions.duplicate")}
                </button>
                <button
                  type="button"
                  className="btn"
                  title={t("sessions.export")}
                  onClick={() => {
                    // Export: xuất JSON phiên ra
                    const data = JSON.stringify({
                      name: s.name,
                      tabCount: s.tabCount,
                      createdAt: s.createdAt,
                    });
                    // Tạo download link tạm
                    const blob = new Blob([data], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${s.name.replace(/\s+/g, "_")}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  {t("sessions.export")}
                </button>
                <button
                  type="button"
                  className="btn"
                  title={t("sessions.import")}
                  onClick={() => {
                    // Import: cho phép user nhập JSON (dùng prompt đơn giản)
                    const input = window.prompt(t("sessions.importPrompt") || "Nhập JSON phiên:");
                    if (input) {
                      try {
                        const parsed = JSON.parse(input);
                        // Gọi save_named với tên từ JSON nhập vào
                        const importName = parsed.name || "Imported Session";
                        void cmd("session_save_named", { name: importName }).then(load);
                      } catch {
                        alert("JSON không hợp lệ");
                      }
                    }
                  }}
                >
                  {t("sessions.import")}
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  title={t("sessions.delete")}
                  onClick={() => deleteSession(s.name)}
                >
                  <TrashIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}