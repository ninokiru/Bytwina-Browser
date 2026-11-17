import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Tab = { id: number; url: string; active: boolean };

// Thanh công cụ là webview tin cậy duy nhất được phép gọi lệnh Tauri.
export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    invoke<Tab[]>("tabs").then(setTabs).catch((e) => setError(String(e)));
    listen<Tab[]>("tabs-changed", (ev) => setTabs(ev.payload)).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const active = tabs.find((t) => t.active);
    if (active) setAddress(active.url);
  }, [tabs]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => setTabs(await invoke<Tab[]>("navigate", { input: address })));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 48, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 8px" }}>
        <button onClick={() => run(() => invoke("go_back"))} aria-label="Quay lại">←</button>
        <button onClick={() => run(() => invoke("go_forward"))} aria-label="Tiến tới">→</button>
        <button onClick={() => run(() => invoke("reload"))} aria-label="Tải lại">⟳</button>
        <form onSubmit={submit} style={{ flex: 1, display: "flex" }}>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            aria-label="Địa chỉ"
            style={{ flex: 1 }}
          />
        </form>
        <button onClick={() => run(async () => setTabs(await invoke<Tab[]>("new_tab", {})))} aria-label="Tab mới">+</button>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "0 8px", overflowX: "auto" }}>
        {tabs.map((t) => (
          <span key={t.id} style={{ display: "flex", gap: 2, fontWeight: t.active ? 700 : 400 }}>
            <button onClick={() => run(async () => setTabs(await invoke<Tab[]>("activate_tab", { id: t.id })))}>
              Tab {t.id}
            </button>
            <button
              aria-label={`Đóng tab ${t.id}`}
              onClick={() => run(async () => setTabs(await invoke<Tab[]>("close_tab", { id: t.id })))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {error && <div role="alert" style={{ color: "#b00020", padding: "0 8px" }}>{error}</div>}
    </div>
  );
}
