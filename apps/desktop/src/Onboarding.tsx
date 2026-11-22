import { useEffect, useState } from "react";
import { cmd } from "./tabs";
import { getLang } from "./i18n";
import { applyTheme } from "./theme";
import "./Onboarding.css";

// Luồng chào mừng lần đầu (5 bước). Chỉ lưu những thiết lập đã có backend:
// persona, adblock, clearOnExit. Nhập dữ liệu từ trình duyệt khác chưa có nên
// bước đó chỉ thông báo, không giả vờ hoạt động.

type Persona = "work" | "fun" | "study" | "custom";
type Lang = "vi" | "en";

const STEPS = 5;

const TEXT: Record<Lang, {
  skip: string;
  next: string;
  start: string;
  finish: string;
  back: string;
  stepOf: (n: number, total: number) => string;
  welcomeTitle: string;
  welcomeBody: string;
  personaTitle: string;
  personaBody: string;
  personas: Record<Persona, [string, string]>;
  importTitle: string;
  importBody: string;
  importButton: string;
  importDone: (n: number) => string;
  importFail: string;
  privacyTitle: string;
  privacyBody: string;
  adblock: [string, string];
  clearOnExit: [string, string];
  doneTitle: string;
  doneBody: string;
}> = {
  vi: {
    skip: "Bỏ qua",
    next: "Tiếp tục",
    start: "Bắt đầu",
    finish: "Khám phá Bytwina",
    back: "Quay lại",
    stepOf: (n, total) => `Bước ${n} / ${total}`,
    welcomeTitle: "Chào mừng đến với Bytwina",
    welcomeBody: "Duyệt web nhanh hơn, riêng tư hơn. Chỉ mất vài bước để thiết lập.",
    personaTitle: "Bạn dùng trình duyệt cho việc gì?",
    personaBody: "Lựa chọn này chỉ là điểm bắt đầu. Bạn có thể đổi trong Cài đặt bất cứ lúc nào.",
    personas: {
      work: ["Làm việc", "Bật tab dọc."],
      fun: ["Giải trí", "Bật giao diện tối."],
      study: ["Học tập", "Giữ cài đặt mặc định."],
      custom: ["Tùy chỉnh", "Bắt đầu với cài đặt mặc định."],
    },
    importTitle: "Nhập dữ liệu từ trình duyệt khác",
    importBody:
      "Bạn có thể nhập dấu trang từ Chrome ngay bây giờ. Lịch sử và mật khẩu chưa được hỗ trợ trong bản này.",
    importButton: "Nhập dấu trang từ Chrome",
    importDone: (n) => `Đã nhập ${n} dấu trang.`,
    importFail: "Không nhập được dấu trang.",
    privacyTitle: "Quyền riêng tư",
    privacyBody: "Hai thiết lập này có thể đổi sau trong Cài đặt.",
    adblock: ["Chặn quảng cáo", "Giúp trang tải nhanh hơn và bảo vệ dữ liệu của bạn."],
    clearOnExit: ["Xóa dữ liệu khi thoát", "Xóa lịch sử và dữ liệu duyệt web khi đóng Bytwina."],
    doneTitle: "Sẵn sàng!",
    doneBody: "Bytwina đã được thiết lập. Chúc bạn duyệt web vui vẻ.",
  },
  en: {
    skip: "Skip",
    next: "Continue",
    start: "Get started",
    finish: "Explore Bytwina",
    back: "Back",
    stepOf: (n, total) => `Step ${n} of ${total}`,
    welcomeTitle: "Welcome to Bytwina",
    welcomeBody: "Browse faster and more privately. Setup takes a few steps.",
    personaTitle: "What do you mainly browse for?",
    personaBody: "This is only a starting point. You can change it any time in Settings.",
    personas: {
      work: ["Work", "Turn on vertical tabs."],
      fun: ["Entertainment", "Turn on dark mode."],
      study: ["Study", "Keep the default settings."],
      custom: ["Custom", "Start with the default settings."],
    },
    importTitle: "Import data from another browser",
    importBody:
      "You can import bookmarks from Chrome now. History and passwords are not supported in this version.",
    importButton: "Import bookmarks from Chrome",
    importDone: (n) => `Imported ${n} bookmarks.`,
    importFail: "Could not import bookmarks.",
    privacyTitle: "Privacy",
    privacyBody: "You can change these two settings later in Settings.",
    adblock: ["Block ads", "Pages load faster and your data is better protected."],
    clearOnExit: ["Clear data on exit", "Clear history and browsing data when Bytwina closes."],
    doneTitle: "You're all set!",
    doneBody: "Bytwina is ready. Enjoy browsing.",
  },
};

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const lang: Lang = getLang() === "en" ? "en" : "vi";
  const T = TEXT[lang];
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState<Persona>("custom");
  const [adblock, setAdblock] = useState(true);
  const [clearOnExit, setClearOnExit] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const last = step === STEPS - 1;

  // Toolbar phải phủ cả cửa sổ trong lúc onboarding, vì webview nội dung đang bị ẩn.
  useEffect(() => {
    void cmd("panel_open", { on: "1" }).catch(() => undefined);
    return () => {
      void cmd("panel_open", { on: "0" }).catch(() => undefined);
    };
  }, []);

  const finish = () => {
    if (busy) return;
    setBusy(true);
    // Persona "Giải trí" bật giao diện tối ngay, không chờ khởi động lại.
    if (persona === "fun") applyTheme("dark");
    // onboardingDone ghi sau cùng: nếu lưu lỗi giữa chừng, lần mở sau sẽ hỏi lại.
    void Promise.allSettled([
      cmd("settings_set", { key: "persona", value: persona }),
      cmd("adblock_set", { on: adblock ? "1" : "0" }),
      cmd("settings_set", { key: "clearOnExit", value: clearOnExit ? "1" : "0" }),
      // Persona "Làm việc" bật tab dọc ngay; các persona khác giữ bố cục hiện tại.
      persona === "work" ? cmd("tab_layout", { layout: "vertical" }) : Promise.resolve(null),
      persona === "fun" ? cmd("settings_set", { key: "theme", value: "dark" }) : Promise.resolve(null),
    ])
      .then(() => cmd("settings_set", { key: "onboardingDone", value: "1" }))
      .catch(() => undefined)
      .finally(onDone);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      // Enter trên nút/ô nhập đã có hành vi riêng; chỉ xử lý khi focus ở nơi khác.
      else if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !(["INPUT", "BUTTON"].includes((e.target as HTMLElement).tagName))
      ) {
        if (last) finish();
        else setStep((s) => Math.min(s + 1, STEPS - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="ob-screen" role="dialog" aria-modal="true" aria-label="Bytwina">
      <div className="ob-card">
        <div className="ob-progress" aria-hidden="true">
          <span style={{ width: `${((step + 1) / STEPS) * 100}%` }} />
        </div>

        <div className="ob-body" key={step}>
          {step === 0 && (
            <>
              <img className="ob-logo" src="/brand-mark.png" alt="" />
              <h1>{T.welcomeTitle}</h1>
              <p>{T.welcomeBody}</p>
            </>
          )}

          {step === 1 && (
            <>
              <h1>{T.personaTitle}</h1>
              <p>{T.personaBody}</p>
              <div className="ob-options">
                {(Object.keys(T.personas) as Persona[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="ob-option"
                    aria-pressed={persona === p}
                    onClick={() => setPersona(p)}
                  >
                    <b>{T.personas[p][0]}</b>
                    <small>{T.personas[p][1]}</small>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1>{T.importTitle}</h1>
              <p>{T.importBody}</p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void cmd("bookmark_import_chrome")
                    .then((res) => {
                      const n = (res as { imported?: number } | null)?.imported ?? 0;
                      setImportMsg(T.importDone(n));
                    })
                    .catch(() => setImportMsg(T.importFail));
                }}
              >
                {T.importButton}
              </button>
              {importMsg && <p className="ob-note">{importMsg}</p>}
            </>
          )}

          {step === 3 && (
            <>
              <h1>{T.privacyTitle}</h1>
              <p>{T.privacyBody}</p>
              <label className="ob-toggle-row">
                <span>
                  {T.adblock[0]}
                  <small>{T.adblock[1]}</small>
                </span>
                <input type="checkbox" checked={adblock} onChange={(e) => setAdblock(e.target.checked)} />
              </label>
              <label className="ob-toggle-row">
                <span>
                  {T.clearOnExit[0]}
                  <small>{T.clearOnExit[1]}</small>
                </span>
                <input
                  type="checkbox"
                  checked={clearOnExit}
                  onChange={(e) => setClearOnExit(e.target.checked)}
                />
              </label>
            </>
          )}

          {step === 4 && (
            <>
              <h1>{T.doneTitle}</h1>
              <p>{T.doneBody}</p>
            </>
          )}
        </div>

        <div className="ob-actions">
          <span className="ob-count">{T.stepOf(step + 1, STEPS)}</span>
          <div>
            {step > 0 && !last && (
              <button type="button" className="btn" onClick={() => setStep(step - 1)}>
                {T.back}
              </button>
            )}
            {!last && (
              <button type="button" className="btn" disabled={busy} onClick={finish}>
                {T.skip}
              </button>
            )}
            {last ? (
              <button type="button" className="btn primary" disabled={busy} onClick={finish}>
                {T.finish}
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => setStep(step + 1)}
              >
                {step === 0 ? T.start : T.next}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
