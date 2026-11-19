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
  pinned: boolean;
  group: string | null;
}

export interface BrowserStatePayload {
  tabs: TabInfo[];
  activeTab: number | null;
  private: boolean;
  /** Thanh công cụ đang là cột trái thay vì dải ngang. */
  vertical: boolean;
  /** Tab đang hiển thị ở ô phải khi chia màn hình. */
  splitTab: number | null;
}

// Toàn bộ IPC của trình duyệt đi qua một lệnh duy nhất, có kiểm soát (ADR-002).
export function cmd(action: string, args?: Record<string, string>): Promise<unknown> {
  return invoke("browser_command", { action, args });
}
