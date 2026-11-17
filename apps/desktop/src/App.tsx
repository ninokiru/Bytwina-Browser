import { invoke } from "@tauri-apps/api/core";

// Thanh công cụ là webview tin cậy duy nhất được phép gọi lệnh Tauri.
export default function App() {
  return (
    <div style={{ display: "flex", gap: 8, padding: 8, fontFamily: "system-ui" }}>
      <strong>Nova</strong>
      <button onClick={() => invoke("switch_tab", { id: 1 })}>Tab 1</button>
      <button onClick={() => invoke("switch_tab", { id: 2 })}>Tab 2</button>
    </div>
  );
}
