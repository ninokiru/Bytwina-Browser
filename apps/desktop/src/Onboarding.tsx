import { useEffect, useState, type ReactNode } from "react";
import { cmd } from "./tabs";
import { getLang, setLang, useLang } from "./i18n";
import { ACCENTS, applyAccent, applyTheme } from "./theme";
import { TERMS_SECTIONS } from "./terms";
import "./Onboarding.css";
import "./Appearance.css";

// Thiết lập lần đầu. Chỉ ghi những thiết lập đã có backend: persona, theme,
// adblock, clearOnExit, tab layout, và đồng ý điều khoản (bước cuối).
// Nhập dấu trang dùng bookmark_import_chrome. Lịch sử và mật khẩu chưa có backend.

type Persona = "work" | "fun" | "study" | "custom";
type ThemeChoice = "light" | "dark" | "system";
type Lang = "vi" | "en";
type LegalDoc = "terms" | "privacy";

const LAST = 5;
const STEPS = LAST + 1;
// Chỉ số mục trong TERMS_SECTIONS hiển thị theo từng tài liệu.
const LEGAL_SECTIONS: Record<LegalDoc, number[]> = { terms: [0, 3], privacy: [1, 2] };

// Icon nét mảnh, dùng chung cho các thẻ lựa chọn.
function Icon({ name }: { name: "briefcase" | "play" | "book" | "sliders" | "sun" | "moon" | "auto" | "shield" | "spark" | "layers" | "check" | "arrowRight" }) {
  const paths: Record<typeof name, ReactNode> = {
    briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></>,
    play: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l5.5-3.5z" /></>,
    book: <><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></>,
    sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M21 13.2A8.5 8.5 0 1 1 10.8 3a6.5 6.5 0 0 0 10.2 10.2z" />,
    auto: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />,
    layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
    check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  };
  return (
    <svg className="ob-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const STEP_LABELS: Record<Lang, string[]> = {
  vi: ["Chào mừng", "Cách dùng", "Giao diện", "Dấu trang", "Riêng tư", "Hoàn tất"],
  en: ["Welcome", "Your browser", "Appearance", "Bookmarks", "Privacy", "Finish"],
};

const TEXT: Record<Lang, {
  skip: string;
  next: string;
  start: string;
  finish: string;
  back: string;
  stepOf: (n: number, total: number) => string;
  sidebarKicker: string;
  sidebarTitle: string;
  sidebarBody: string;
  sidebarFoot: string;
  welcomeTitle: string;
  welcomeBody: string;
  welcomeFeatures: { icon: "shield" | "layers" | "spark"; title: string; body: string }[];
  personaTitle: string;
  personaBody: string;
  personas: Record<Persona, { icon: "briefcase" | "play" | "book" | "sliders"; label: string; hint: string }>;
  themeTitle: string;
  themeBody: string;
  themes: Record<ThemeChoice, { icon: "sun" | "moon" | "auto"; label: string; hint: string }>;
  previewLabel: string;
  importTitle: string;
  importBody: string;
  importButton: string;
  importDone: (n: number) => string;
  importFail: string;
  importNote: string;
  privacyTitle: string;
  privacyBody: string;
  adblock: [string, string];
  clearOnExit: [string, string];
  doneTitle: string;
  doneBody: string;
  doneKicker: string;
  doneThemeChip: Record<ThemeChoice, string>;
  doneTabsChip: { on: string; off: string };
  doneAdsChip: { on: string; off: string };
  doneShortcuts: string;
  doneSearch: string;
  doneTab: string;
  consentPrefix: string;
  consentAnd: string;
  consentTerms: string;
  consentPrivacy: string;
  consentHint: string;
  modalClose: string;
  on: string;
  off: string;
}> = {
  vi: {
    skip: "Bỏ qua",
    next: "Tiếp tục",
    start: "Bắt đầu",
    finish: "Khám phá Bytwina",
    back: "Quay lại",
    stepOf: (n, total) => `Bước ${n} / ${total}`,
    sidebarKicker: "THIẾT LẬP NHANH",
    sidebarTitle: "Tùy chỉnh theo bạn.",
    sidebarBody: "Vài lựa chọn ban đầu. Bạn có thể đổi lại bất cứ lúc nào trong Cài đặt.",
    sidebarFoot: "Riêng tư theo lựa chọn của bạn.",
    welcomeTitle: "Chào mừng đến với Bytwina",
    welcomeBody: "Trình duyệt nhẹ, không cần tài khoản, dữ liệu lưu trên máy bạn. Mọi mục đều có mặc định sẵn; bạn có thể bỏ qua bất cứ lúc nào.",
    welcomeFeatures: [
      { icon: "shield", title: "Riêng tư", body: "Lịch sử và mật khẩu lưu trên máy bạn." },
      { icon: "layers", title: "Gọn gàng", body: "Tab dọc, chia màn hình, chế độ tập trung." },
      { icon: "spark", title: "Theo ý bạn", body: "Giao diện và cách hiển thị đều chỉnh được." },
    ],
    personaTitle: "Bạn dùng trình duyệt cho việc gì?",
    personaBody: "Lựa chọn này chỉ là điểm bắt đầu.",
    personas: {
      work: { icon: "briefcase", label: "Làm việc", hint: "Bật tab dọc để quản lý nhiều tab." },
      fun: { icon: "play", label: "Giải trí", hint: "Chọn sẵn giao diện tối." },
      study: { icon: "book", label: "Học tập", hint: "Giữ cài đặt mặc định, gọn và dễ đọc." },
      custom: { icon: "sliders", label: "Tùy chỉnh", hint: "Bắt đầu với cài đặt mặc định." },
    },
    themeTitle: "Chọn giao diện",
    themeBody: "Bạn có thể đổi bất cứ lúc nào trong Cài đặt.",
    themes: {
      light: { icon: "sun", label: "Sáng", hint: "Nền trắng, chữ tối." },
      dark: { icon: "moon", label: "Tối", hint: "Nền tối, dễ nhìn ban đêm." },
      system: { icon: "auto", label: "Theo hệ thống", hint: "Theo cài đặt Windows." },
    },
    previewLabel: "Xem trước",
    importTitle: "Nhập dấu trang từ Chrome",
    importBody: "Nhập dấu trang và giữ nguyên thư mục. Lịch sử và mật khẩu chưa được hỗ trợ trong bản này.",
    importButton: "Nhập dấu trang",
    importDone: (n) => `Đã nhập ${n} dấu trang.`,
    importFail: "Không nhập được dấu trang.",
    importNote: "Không bắt buộc. Bạn có thể bỏ qua bước này.",
    privacyTitle: "Quyền riêng tư",
    privacyBody: "Hai thiết lập này có thể đổi sau trong Cài đặt.",
    adblock: ["Chặn quảng cáo", "Trang tải nhanh hơn và dữ liệu được bảo vệ tốt hơn."],
    clearOnExit: ["Xóa dữ liệu khi thoát", "Xóa lịch sử và dữ liệu duyệt web khi đóng Bytwina."],
    doneTitle: "Bytwina đã sẵn sàng!",
    doneBody: "Trình duyệt của bạn đã được cấu hình xong. Bạn có thể thay đổi mọi thứ trong Cài đặt bất cứ lúc nào.",
    doneKicker: "THIẾT LẬP HOÀN TẤT",
    doneThemeChip: { dark: "Giao diện tối", light: "Giao diện sáng", system: "Theo hệ thống" },
    doneTabsChip: { on: "Tab dọc", off: "Tab ngang" },
    doneAdsChip: { on: "Chặn quảng cáo", off: "Quảng cáo: cho phép" },
    doneShortcuts: "Bắt đầu nhanh",
    doneSearch: "Tìm kiếm hoặc nhập địa chỉ",
    doneTab: "Mở một tab mới",
    consentPrefix: "Tôi đã đọc và đồng ý với",
    consentAnd: "và",
    consentTerms: "Điều khoản sử dụng",
    consentPrivacy: "Chính sách quyền riêng tư",
    consentHint: "Tick ô trên để bật nút Khám phá Bytwina.",
    modalClose: "Đóng",
    on: "Bật",
    off: "Tắt",
  },
  en: {
    skip: "Skip",
    next: "Continue",
    start: "Get started",
    finish: "Explore Bytwina",
    back: "Back",
    stepOf: (n, total) => `Step ${n} of ${total}`,
    sidebarKicker: "QUICK SETUP",
    sidebarTitle: "Make it yours.",
    sidebarBody: "A few starting choices. You can change them any time in Settings.",
    sidebarFoot: "Private by choice.",
    welcomeTitle: "Welcome to Bytwina",
    welcomeBody: "A lightweight browser with no account required, and your data stays on your device. Every choice has a sensible default, and you can skip at any time.",
    welcomeFeatures: [
      { icon: "shield", title: "Private", body: "History and passwords stay on your device." },
      { icon: "layers", title: "Organized", body: "Vertical tabs, split view, focus mode." },
      { icon: "spark", title: "Your way", body: "Appearance and layout are adjustable." },
    ],
    personaTitle: "What do you mainly browse for?",
    personaBody: "This is only a starting point.",
    personas: {
      work: { icon: "briefcase", label: "Work", hint: "Turn on vertical tabs for many tabs." },
      fun: { icon: "play", label: "Entertainment", hint: "Preselect dark mode." },
      study: { icon: "book", label: "Study", hint: "Keep the default settings, calm and readable." },
      custom: { icon: "sliders", label: "Custom", hint: "Start with the default settings." },
    },
    themeTitle: "Choose a look",
    themeBody: "You can change it any time in Settings.",
    themes: {
      light: { icon: "sun", label: "Light", hint: "Light background, dark text." },
      dark: { icon: "moon", label: "Dark", hint: "Dark background, easier at night." },
      system: { icon: "auto", label: "System", hint: "Follow Windows settings." },
    },
    previewLabel: "Preview",
    importTitle: "Import bookmarks from Chrome",
    importBody: "Imports bookmarks and keeps their folders. History and passwords are not supported in this version.",
    importButton: "Import bookmarks",
    importDone: (n) => `Imported ${n} bookmarks.`,
    importFail: "Could not import bookmarks.",
    importNote: "Optional. You can skip this step.",
    privacyTitle: "Privacy",
    privacyBody: "You can change these two settings later in Settings.",
    adblock: ["Block ads", "Pages load faster and your data is better protected."],
    clearOnExit: ["Clear data on exit", "Clear history and browsing data when Bytwina closes."],
    doneTitle: "Bytwina is ready!",
    doneBody: "Your browser is set up. You can change anything in Settings at any time.",
    doneKicker: "SETUP COMPLETE",
    doneThemeChip: { dark: "Dark theme", light: "Light theme", system: "Follow system" },
    doneTabsChip: { on: "Vertical tabs", off: "Horizontal tabs" },
    doneAdsChip: { on: "Ad blocking", off: "Ads allowed" },
    doneShortcuts: "A quick start",
    doneSearch: "Search or enter an address",
    doneTab: "Open a new tab",
    consentPrefix: "I have read and agree to the",
    consentAnd: "and",
    consentTerms: "Terms of Use",
    consentPrivacy: "Privacy Policy",
    consentHint: "Tick the box above to enable Explore Bytwina.",
    modalClose: "Close",
    on: "On",
    off: "Off",
  },
};

// Thẻ xem trước giao diện: một cửa sổ thu nhỏ vẽ bằng CSS.
function ThemePreview({ variant, label }: { variant: ThemeChoice; label: string }) {
  return (
    <div className={`ob-preview ob-preview-${variant}`} aria-hidden="true" title={label}>
      <div className="ob-preview-bar"><i /><i /><i /></div>
      <div className="ob-preview-body">
        <div className="ob-preview-side"><span /><span /><span /></div>
        <div className="ob-preview-main"><b /><em /><em /></div>
      </div>
    </div>
  );
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  // useLang: đổi ngôn ngữ ngay tại màn chào mừng thì toàn bộ onboarding vẽ lại.
  useLang();
  const lang: Lang = getLang() === "en" ? "en" : "vi";
  const T = TEXT[lang];
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState<Persona>("custom");
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [accent, setAccent] = useState("default");
  const [adblock, setAdblock] = useState(true);
  const [clearOnExit, setClearOnExit] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const last = step === LAST;

  // Toolbar phải phủ cả cửa sổ trong lúc onboarding, vì webview nội dung đang bị ẩn.
  useEffect(() => {
    void cmd("panel_open", { on: "1" }).catch(() => undefined);
    return () => {
      void cmd("panel_open", { on: "0" }).catch(() => undefined);
    };
  }, []);

  const pickTheme = (next: ThemeChoice) => {
    setTheme(next);
    // Xem trước ngay; giá trị được lưu khi hoàn tất.
    applyTheme(next);
  };

  const changeLanguage = (code: Lang) => {
    setLang(code);
    // Lưu ngay để app mở đúng ngôn ngữ kể cả khi người dùng thoát giữa chừng.
    void cmd("settings_set", { key: "language", value: code }).catch(() => undefined);
  };

  const pickAccent = (id: string) => {
    setAccent(id);
    // Xem trước ngay trên màn hình onboarding; lưu khi hoàn tất.
    applyAccent(id);
  };

  const finish = () => {
    // Không hoàn tất khi chưa đồng ý điều khoản.
    if (busy || !agreed) return;
    setBusy(true);
    // onboardingDone ghi sau cùng: nếu lưu lỗi giữa chừng, lần mở sau sẽ hỏi lại.
    void Promise.allSettled([
      cmd("settings_set", { key: "persona", value: persona }),
      cmd("adblock_set", { on: adblock ? "1" : "0" }),
      cmd("settings_set", { key: "clearOnExit", value: clearOnExit ? "1" : "0" }),
      // Persona "Làm việc" bật tab dọc ngay; các persona khác giữ bố cục hiện tại.
      persona === "work" ? cmd("tab_layout", { layout: "vertical" }) : Promise.resolve(null),
      cmd("settings_set", { key: "theme", value: theme }),
      cmd("settings_set", { key: "accent", value: accent }),
    ])
      .then(() => cmd("settings_set", { key: "onboardingDone", value: "1" }))
      .catch(() => undefined)
      .finally(onDone);
  };

  // Bỏ qua và Escape đưa người dùng tới bước cuối, nơi có thẻ đồng ý; không thoát thẳng.
  const jumpToEnd = () => setStep(LAST);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Khi cửa sổ điều khoản mở, chỉ Escape có tác dụng: đóng cửa sổ.
      if (legal) {
        if (e.key === "Escape") setLegal(null);
        return;
      }
      if (e.key === "Escape") {
        if (last) finish();
        else jumpToEnd();
      } else if (
        e.key === "Enter" &&
        !e.shiftKey &&
        !(["INPUT", "BUTTON"].includes((e.target as HTMLElement).tagName))
      ) {
        // Enter trên nút/ô nhập đã có hành vi riêng; chỉ xử lý khi focus ở nơi khác.
        if (last) finish();
        else setStep((s) => Math.min(s + 1, LAST));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const legalTitle = legal === "privacy" ? T.consentPrivacy : T.consentTerms;
  const personaKeys = Object.keys(T.personas) as Persona[];
  const themeKeys = Object.keys(T.themes) as ThemeChoice[];

  return (
    <div className="ob-screen" role="dialog" aria-modal="true" aria-label="Bytwina">
      <div className="ob-card">
        <aside className="ob-sidebar">
          <div className="ob-brand"><img src="/brand-mark.png" alt="" /><b>Bytwina</b></div>
          <div className="ob-sidebar-copy">
            <span className="ob-kicker">{T.sidebarKicker}</span>
            <h2>{T.sidebarTitle}</h2>
            <p>{T.sidebarBody}</p>
          </div>
          <ol className="ob-step-list" aria-label={lang === "en" ? "Setup progress" : "Tiến trình thiết lập"}>
            {STEP_LABELS[lang].map((label, index) => (
              <li
                key={label}
                className={index === step ? "active" : index < step ? "complete" : ""}
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? <Icon name="check" /> : index + 1}</span>{label}
              </li>
            ))}
          </ol>
          <div className="ob-sidebar-foot">{T.sidebarFoot}</div>
        </aside>

        <div className="ob-main">
          <div className="ob-progress" aria-hidden="true">
            <span style={{ width: `${((step + 1) / STEPS) * 100}%` }} />
          </div>

          <div className="ob-body" key={step}>
            {step === 0 && (
              <>
                <div className="ob-lang" role="radiogroup" aria-label={lang === "en" ? "Language" : "Ngôn ngữ"}>
                  {(["vi", "en"] as const).map((code) => (
                    <button
                      key={code}
                      type="button"
                      role="radio"
                      aria-checked={lang === code}
                      className={`ob-lang-option${lang === code ? " on" : ""}`}
                      onClick={() => changeLanguage(code)}
                    >
                      {code === "vi" ? "Tiếng Việt" : "English"}
                    </button>
                  ))}
                </div>
                <img className="ob-logo" src="/brand-mark.png" alt="" />
                <h1>{T.welcomeTitle}</h1>
                <p>{T.welcomeBody}</p>
                <div className="ob-features">
                  {T.welcomeFeatures.map((f) => (
                    <div key={f.title} className="ob-feature">
                      <span className="ob-feature-icon"><Icon name={f.icon} /></span>
                      <b>{f.title}</b>
                      <small>{f.body}</small>
                    </div>
                  ))}
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h1>{T.personaTitle}</h1>
                <p>{T.personaBody}</p>
                <div className="ob-cards" role="radiogroup" aria-label={T.personaTitle}>
                  {personaKeys.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={persona === p}
                      className="ob-card-option"
                      onClick={() => {
                        setPersona(p);
                        setTheme(p === "fun" ? "dark" : "system");
                      }}
                    >
                      <span className="ob-feature-icon"><Icon name={T.personas[p].icon} /></span>
                      <b>{T.personas[p].label}</b>
                      <small>{T.personas[p].hint}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h1>{T.themeTitle}</h1>
                <p>{T.themeBody}</p>
                <div className="ob-cards ob-cards-theme" role="radiogroup" aria-label={T.themeTitle}>
                  {themeKeys.map((th) => (
                    <button
                      key={th}
                      type="button"
                      role="radio"
                      aria-checked={theme === th}
                      className="ob-card-option ob-theme-option"
                      onClick={() => pickTheme(th)}
                    >
                      <ThemePreview variant={th} label={T.themes[th].label} />
                      <span className="ob-theme-label">
                        <b>{T.themes[th].label}</b>
                        <small>{T.themes[th].hint}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="ob-muted-line">{T.previewLabel}: {T.themes[theme].label}</p>
                <p className="ob-accent-title">{lang === "en" ? "Accent color" : "Màu nhấn"}</p>
                <div className="accent-row" role="radiogroup" aria-label={lang === "en" ? "Accent color" : "Màu nhấn"}>
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={accent === a.id}
                      aria-label={lang === "en" ? a.labelEn : a.label}
                      title={lang === "en" ? a.labelEn : a.label}
                      className={`accent-swatch${accent === a.id ? " on" : ""}`}
                      style={{ background: a.color || "var(--text)" }}
                      onClick={() => pickAccent(a.id)}
                    />
                  ))}
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1>{T.importTitle}</h1>
                <p>{T.importBody}</p>
                <div className="ob-import">
                  <span className="ob-feature-icon"><Icon name="book" /></span>
                  <div>
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
                    <small>{importMsg || T.importNote}</small>
                  </div>
                </div>
              </>
            )}

            {step === 4 && (
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

            {step === LAST && (
              <div className="ob-done">
                <div className="ob-done-hero">
                  <span className="ob-done-check" aria-hidden="true"><Icon name="check" /></span>
                  <span className="ob-kicker">{T.doneKicker}</span>
                  <h1>{T.doneTitle}</h1>
                  <p>{T.doneBody}</p>
                </div>
                <div className="ob-chips" aria-label={lang === "en" ? "Your choices" : "Lựa chọn của bạn"}>
                  <span className="ob-chip on">{T.doneThemeChip[theme]}</span>
                  <span className={`ob-chip${persona === "work" ? " on" : ""}`}>
                    {persona === "work" ? T.doneTabsChip.on : T.doneTabsChip.off}
                  </span>
                  <span className={`ob-chip${adblock ? " on" : ""}`}>
                    {adblock ? T.doneAdsChip.on : T.doneAdsChip.off}
                  </span>
                </div>
                <div className="ob-done-shortcuts">
                  <h2>{T.doneShortcuts}</h2>
                  <div><kbd>Ctrl</kbd><kbd>L</kbd><span>{T.doneSearch}</span></div>
                  <div><kbd>Ctrl</kbd><kbd>T</kbd><span>{T.doneTab}</span></div>
                </div>
                <div className="ob-consent">
                  <input
                    id="ob-agree"
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />
                  <label htmlFor="ob-agree">
                    {T.consentPrefix}{" "}
                    <button type="button" className="ob-link" onClick={() => setLegal("terms")}>
                      {T.consentTerms}
                    </button>{" "}
                    {T.consentAnd}{" "}
                    <button type="button" className="ob-link" onClick={() => setLegal("privacy")}>
                      {T.consentPrivacy}
                    </button>
                  </label>
                </div>
                {!agreed && <p className="ob-consent-hint">{T.consentHint}</p>}
              </div>
            )}
          </div>

          <div className="ob-actions">
            <div className="ob-dots" aria-hidden="true">
              {Array.from({ length: STEPS }, (_, i) => (
                <span key={i} className={i === step ? "on" : i < step ? "done" : ""} />
              ))}
            </div>
            <div className="ob-action-buttons">
              {step > 0 && !last && (
                <button type="button" className="btn" onClick={() => setStep(step - 1)}>
                  {T.back}
                </button>
              )}
              {!last && (
                <button type="button" className="btn" disabled={busy} onClick={jumpToEnd}>
                  {T.skip}
                </button>
              )}
              {last ? (
                <button type="button" className="btn primary" disabled={busy || !agreed} onClick={finish}>
                  {T.finish}
                </button>
              ) : (
                <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>
                  {step === 0 ? T.start : T.next}
                  <Icon name="arrowRight" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {legal && (
        <div className="ob-modal-scrim" onClick={() => setLegal(null)}>
          <div
            className="ob-modal"
            role="dialog"
            aria-modal="true"
            aria-label={legalTitle}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2>{legalTitle}</h2>
              <button type="button" className="btn" onClick={() => setLegal(null)} autoFocus>
                {T.modalClose}
              </button>
            </header>
            <div className="ob-modal-body">
              {TERMS_SECTIONS.filter((_, i) => LEGAL_SECTIONS[legal].includes(i)).map((s) => (
                <section key={s.title}>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
