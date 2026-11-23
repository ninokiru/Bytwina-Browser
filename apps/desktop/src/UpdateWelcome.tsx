import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { cmd } from "./tabs";
import { getLang } from "./i18n";
import "./UpdateWelcome.css";

type UpdateInfo = { version: string; current: string; notes?: string | null };
type CheckResult = {
  status: "available" | "latest" | "unavailable" | "failed" | "skipped";
  info?: UpdateInfo | null;
};
type DownloadProgress = { downloaded: number; total: number | null };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Hộp thoại cập nhật khi mở app. Chỉ hiện khi có bản mới; còn lại (đã mới nhất,
 * đang trong khoảng chờ 1–3 giờ, lỗi mạng, chưa cấu hình) thì im lặng.
 */
export default function UpdateWelcome({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const en = getLang() === "en";
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: null });
  const started = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const installRef = useRef<HTMLButtonElement>(null);

  // Kiểm tra một lần mỗi lần mở app (main process đã áp khoảng chờ 1–3 giờ).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const result = (await cmd("update_check_startup")) as CheckResult;
        if (result.status !== "available" || !result.info) return;
        setInfo(result.info);
        setVisible(true);
        onOpenChange(true);
        void cmd("panel_open", { on: "1" }).catch(() => undefined);
      } catch {
        // Không kiểm tra được thì bỏ qua, không làm phiền người dùng.
      }
    })();
  }, [onOpenChange]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<DownloadProgress>("update://progress", (event) => setProgress(event.payload)).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (visible) installRef.current?.focus();
  }, [visible]);

  const skip = () => {
    if (installing) return;
    setVisible(false);
    onOpenChange(false);
    void cmd("panel_open", { on: "0" }).catch(() => undefined);
  };

  const install = async () => {
    setInstalling(true);
    setError("");
    setProgress({ downloaded: 0, total: null });
    try {
      await cmd("update_install");
    } catch (err) {
      setInstalling(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      skip();
      return;
    }
    if (event.key !== "Tab") return;
    const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    if (!buttons.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!visible || !info) return null;

  const percent = progress.total && progress.total > 0
    ? Math.min(100, Math.floor((progress.downloaded / progress.total) * 100))
    : null;

  return (
    <div className="update-welcome-backdrop" role="presentation">
      <section ref={dialogRef} className="update-welcome" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="update-welcome-title" onKeyDown={handleKeyDown}>
        <aside className="update-welcome-aside">
          <div className="update-welcome-brand"><img src="/brand-mark.png" alt="" /><b>Bytwina</b></div>
          <div className="update-welcome-orbit" aria-hidden="true"><span /><i /></div>
          <p className="update-welcome-aside-label">{en ? "BROWSER UPDATE" : "CẬP NHẬT TRÌNH DUYỆT"}</p>
          <h2>{en ? "A better browser is ready." : "Đã có bản Bytwina mới."}</h2>
          <p>{en ? "Your tabs and saved data stay on this device." : "Các tab và dữ liệu đã lưu vẫn ở trên thiết bị của bạn."}</p>
        </aside>
        <div className="update-welcome-main">
          <p className="update-welcome-eyebrow">{en ? "UPDATE AVAILABLE" : "CÓ BẢN MỚI"}</p>
          <h1 id="update-welcome-title" aria-live="polite">
            {en ? "A new version of Bytwina is available" : "Bytwina có phiên bản mới"}
          </h1>
          <p className="update-welcome-message">
            {en
              ? "Download and install now, or skip. We will ask again in 1 to 3 hours."
              : "Tải xuống và cài đặt ngay, hoặc bỏ qua. Bytwina sẽ hỏi lại sau 1 đến 3 giờ."}
          </p>
          <div className="update-welcome-version-card">
            <div><span>{en ? "CURRENT VERSION" : "PHIÊN BẢN HIỆN TẠI"}</span><b>{info.current}</b></div>
            <span className="update-welcome-version-arrow" aria-hidden="true">→</span>
            <div className="update-welcome-version-new"><span>{en ? "NEW VERSION" : "PHIÊN BẢN MỚI"}</span><b>{info.version}</b></div>
          </div>
          {info.notes && (
            <div className="update-welcome-notes"><strong>{en ? "What’s new" : "Có gì mới"}</strong><div>{info.notes}</div></div>
          )}
          {installing && (
            <div className="update-install-progress" role="status">
              <span className={`update-progress-track${percent == null ? " is-indeterminate" : ""}`}>
                <i style={{ width: percent == null ? "35%" : `${percent}%` }} />
              </span>
              <span>
                {percent == null
                  ? progress.downloaded > 0
                    ? `${formatBytes(progress.downloaded)} ${en ? "downloaded" : "đã tải"}`
                    : (en ? "Preparing download…" : "Đang chuẩn bị tải…")
                  : `${percent}% · ${formatBytes(progress.downloaded)} / ${formatBytes(progress.total ?? 0)}`}
              </span>
              <small>{en ? "Keep Bytwina open until the installer finishes." : "Hãy giữ Bytwina mở cho đến khi cài xong."}</small>
            </div>
          )}
          {error && <p className="update-welcome-message" role="alert">{error}</p>}
          <div className="update-welcome-actions">
            <button ref={installRef} className="btn primary" type="button" disabled={installing} onClick={() => void install()}>
              {installing
                ? (en ? "Installing…" : "Đang cài đặt…")
                : (en ? "Download and install" : "Tải xuống và cài đặt")}
            </button>
            <button className="btn" type="button" disabled={installing} onClick={skip}>
              {en ? "Skip" : "Bỏ qua"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
