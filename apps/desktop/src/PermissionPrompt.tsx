import { useState } from "react";
import type { CSSProperties } from "react";
import { cmd } from "./tabs";
import { t, type Key } from "./i18n";

export type PermissionKind = "camera" | "microphone" | "geolocation" | "notifications" | "clipboard";

export interface PermissionPrompt {
  id: number;
  origin: string;
  kind: PermissionKind;
}

// Tra tường minh thay vì nội suy chuỗi: `t` nhận đúng khóa đã khai báo.
const KIND_KEYS: Record<PermissionKind, Key> = {
  camera: "perm.kind.camera",
  microphone: "perm.kind.microphone",
  geolocation: "perm.kind.geolocation",
  notifications: "perm.kind.notifications",
  clipboard: "perm.kind.clipboard",
};

/// Bảng hỏi quyền kiểu Chrome/Cốc Cốc: một thẻ nhỏ gọn trong vùng thanh công cụ.
///
/// Cố ý KHÔNG mở bảng nổi toàn cửa sổ (`panel_open`): cách đó ẩn webview nội dung,
/// nghĩa là trang vừa xin quyền sẽ biến mất khỏi màn hình đúng lúc người dùng cần
/// thấy nó. Style đặt nội tuyến vì `styles.css` đang có thay đổi dở của phần khác.
export default function PermissionPrompt({
  prompt,
  onDone,
}: {
  prompt: PermissionPrompt;
  onDone: () => void;
}) {
  const [remember, setRemember] = useState(true);

  const answer = (allow: boolean) => {
    void cmd("permission_respond", {
      id: String(prompt.id),
      allow: allow ? "1" : "0",
      remember: remember ? "1" : "0",
      origin: prompt.origin,
      kind: prompt.kind,
    }).catch(() => undefined);
    onDone();
  };

  const card: CSSProperties = {
    position: "fixed",
    top: 44,
    right: 8,
    maxWidth: "calc(100% - 16px)",
    zIndex: 60,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    boxShadow: "var(--shadow-lg)",
    fontSize: 12.5,
  };

  return (
    <div style={card} role="dialog" aria-label={t("perm.title")}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ overflowWrap: "anywhere" }}>{prompt.origin}</strong>
        <span>{t("perm.wants")}</span>
        <strong>{t(KIND_KEYS[prompt.kind])}</strong>
      </div>
      <label style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--muted)" }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {t("perm.remember")}
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={() => answer(false)}>
          {t("perm.block")}
        </button>
        <button type="button" className="btn primary" onClick={() => answer(true)}>
          {t("perm.allow")}
        </button>
      </div>
    </div>
  );
}
