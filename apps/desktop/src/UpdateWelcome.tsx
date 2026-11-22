import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cmd } from "./tabs";
import { getLang } from "./i18n";
import "./UpdateWelcome.css";

type CheckResult = {
  status: "available" | "latest" | "unavailable" | "failed";
  info?: { version: string; current: string; notes?: string | null } | null;
};

export default function UpdateWelcome() {
  const en = getLang() === "en";
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [closed, setClosed] = useState(false);
  const started = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      setResult((await cmd("update_check_startup")) as CheckResult);
    } catch {
      setResult({ status: "failed" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
    closeRef.current?.focus();
  }, [check]);

  useEffect(() => {
    if (installing) dialogRef.current?.focus();
  }, [installing]);

  if (closed) return null;

  const install = async () => {
    setInstalling(true);
    try {
      await cmd("update_install");
    } catch {
      setInstalling(false);
      setResult({ status: "failed" });
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !installing) {
      setClosed(true);
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

  const updateInfo = result?.status === "available" ? result.info : null;
  const available = Boolean(updateInfo);
  const heading = busy
    ? (en ? "Checking for updates" : "Đang kiểm tra cập nhật")
    : available
      ? (en ? "A new Bytwina is ready" : "Bytwina có bản cập nhật mới")
      : result?.status === "latest"
        ? (en ? "You’re up to date" : "Bạn đang dùng bản mới nhất")
        : (en ? "Update check unavailable" : "Chưa kiểm tra được cập nhật");
  const message = busy
    ? (en ? "This usually takes a few seconds." : "Thường chỉ mất vài giây.")
    : available
      ? (en ? `Version ${updateInfo?.version} is ready to install.` : `Đã có phiên bản ${updateInfo?.version}.`)
      : result?.status === "latest"
        ? (en ? "You have the latest version installed." : "Bytwina đã được cập nhật đầy đủ.")
        : result?.status === "unavailable"
          ? (en ? "Automatic updates are not configured for this build." : "Bản cài này chưa bật cập nhật tự động.")
          : (en ? "Check your connection and try again." : "Kiểm tra kết nối mạng hoặc thử lại sau.");

  return (
    <div className="update-welcome-backdrop" role="presentation">
      <section ref={dialogRef} className="update-welcome" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="update-welcome-title" onKeyDown={handleDialogKeyDown}>
        <button ref={closeRef} className="update-welcome-close" type="button" disabled={installing} onClick={() => setClosed(true)} aria-label={en ? "Close" : "Đóng"}>×</button>
        <div className={`update-welcome-mark${available ? " is-ready" : ""}`} aria-hidden="true">
          {busy ? <span className="update-spinner" /> : available ? "↑" : "✦"}
        </div>
        <p className="update-welcome-eyebrow">BYTWINA • {en ? "STARTUP" : "KHỞI ĐỘNG"}</p>
        <h2 id="update-welcome-title" aria-live="polite">{heading}</h2>
        <p className="update-welcome-message">{message}</p>
        {available && updateInfo && (
          <div className="update-welcome-version-card">
            <div><span>{en ? "Installed" : "Đang dùng"}</span><b>{updateInfo.current}</b></div>
            <span className="update-welcome-version-arrow" aria-hidden="true">→</span>
            <div className="update-welcome-version-new"><span>{en ? "Available" : "Bản mới"}</span><b>{updateInfo.version}</b></div>
          </div>
        )}
        {available && updateInfo?.notes && <div className="update-welcome-notes">{updateInfo.notes}</div>}
        {installing && <div className="update-install-progress" role="status"><span />{en ? "Preparing the installer…" : "Đang chuẩn bị trình cài đặt…"}</div>}
        <div className="update-welcome-actions">
          {available ? (
            <button className="btn primary" type="button" disabled={installing} onClick={() => void install()}>
              {installing ? (en ? "Downloading and installing…" : "Đang tải và cài đặt…") : (en ? "Update and install" : "Cập nhật và cài đặt")}
            </button>
          ) : result?.status === "failed" || result?.status === "unavailable" ? (
            <button className="btn primary" type="button" disabled={busy} onClick={() => void check()}>
              {en ? "Check again" : "Kiểm tra lại"}
            </button>
          ) : null}
          <button className="btn" type="button" disabled={busy || installing} onClick={() => setClosed(true)}>
            {available ? (en ? "Later" : "Để sau") : (en ? "Continue" : "Tiếp tục")}
          </button>
        </div>
      </section>
    </div>
  );
}
