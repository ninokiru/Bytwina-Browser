import { invoke } from "@tauri-apps/api/core";

export interface TabInfo {
  id: number;
  label: string;
  url: string;
  title: string;
  loading: boolean;
  created: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserStatePayload {
  tabs: TabInfo[];
  activeTab: number | null;
}

// Toàn bộ IPC của trình duyệt đi qua một lệnh duy nhất, có kiểm soát (ADR-002).
export function cmd(action: string, args?: Record<string, string>): Promise<unknown> {
  return invoke("browser_command", { action, args });
}
