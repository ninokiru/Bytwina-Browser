import { useEffect, useState } from "react";

// Ngôn ngữ giao diện. Mặc định tiếng Việt; lựa chọn được lưu trong CSDL (settings.language).
export type Lang = "vi" | "en";

const vi = {
  "app.private": "Riêng tư",
  "bar.newTab": "Mở tab mới",
  "bar.home": "Trang chủ",
  "bar.address": "Nhập địa chỉ hoặc tìm kiếm",
  "bar.group": "Nhóm tab",
  "bar.pin": "Ghim tab",
  "bar.unpin": "Bỏ ghim",
  "bar.findTabs": "Tìm tab",
  "bar.reading": "Danh sách đọc",
  "bar.downloads": "Tải xuống",
  "bar.privateToggle": "Chế độ riêng tư (không ghi lịch sử)",
  "bar.settings": "Cài đặt",
  "bar.addReading": "Thêm vào danh sách đọc",
  "bar.bookmark": "Lưu trang này",
  "panel.close": "Đóng",
  "panel.remove": "xóa",
  "panel.searchHistory": "Tìm trong lịch sử",
  "panel.siteHost": "Tên miền, ví dụ example.com",
  "panel.clearSite": "Xóa theo trang",
  "panel.clearHistory": "Xóa toàn bộ lịch sử",
  "panel.searchTabs": "Tìm tab theo tên hoặc địa chỉ",
  "panel.clearList": "Xóa danh sách",
  "title.bookmarks": "Đã lưu",
  "title.history": "Lịch sử",
  "title.downloads": "Tải xuống",
  "title.tabs": "Tìm tab",
  "title.reading": "Danh sách đọc",
  "title.settings": "Cài đặt",
  "settings.general": "Chung",
  "settings.language": "Ngôn ngữ",
  "settings.langVi": "Tiếng Việt",
  "settings.langEn": "English",
  "settings.homepage": "Trang chủ",
  "settings.homeHint": "Dùng cho nút 🏠 trên thanh công cụ. Lưu khi rời ô nhập.",
  "settings.privacy": "Quyền riêng tư",
  "settings.privateMode": "Chế độ riêng tư (không ghi lịch sử)",
  "settings.clearData": "Xóa dữ liệu duyệt web (lịch sử, tải xuống, phiên)",
  "settings.cleared": "Đã xóa dữ liệu.",
  "settings.downloads": "Tải xuống",
  "settings.downloadsHint":
    "File lưu vào thư mục Downloads của Windows. File thực thi (.exe, .bat, .ps1…) được đổi tên thành .download.",
  "settings.about": "Giới thiệu",
  "settings.version": "Phiên bản",
  "settings.webview": "WebView2",
  "settings.storage": "Lưu trữ",
  "settings.storageOk": "Sẵn sàng",
  "settings.storageOff": "Không khả dụng",
  "settings.diagnostics": "Chẩn đoán",
  "settings.searchEngine": "Công cụ tìm kiếm",
  "settings.engineDuck": "DuckDuckGo",
  "settings.engineGoogle": "Google",
  "settings.engineBing": "Bing",
  "settings.engineBrave": "Brave Search",
  "settings.startup": "Khi khởi động",
  "settings.startupRestore": "Mở lại các tab trước đó",
  "settings.startupHome": "Mở trang chủ",
  "settings.startupBlank": "Mở trang trống",
  "settings.appearance": "Giao diện",
  "settings.theme": "Chủ đề",
  "settings.themeSystem": "Theo hệ thống",
  "settings.themeLight": "Sáng",
  "settings.themeDark": "Tối",
  "settings.zoom": "Phóng to trang",
  "settings.privateHint": "Áp dụng cho tab mở sau khi bật.",
  "settings.clearOnExit": "Xóa cookie và dữ liệu duyệt web khi thoát",
  "settings.clearOnExitHint": "Có thể làm mất đăng nhập. Chưa kiểm chứng trên Windows.",
  "settings.cookies": "Cookie",
  "settings.cookiesNote": "Chưa hỗ trợ chặn cookie bên thứ ba: API hiện tại không cho phép.",
  "settings.downloadDirHint": "Để trống để dùng thư mục Downloads mặc định. Thư mục phải có sẵn.",
  "settings.downloadDirPlaceholder": "Ví dụ: D:\\Tải về",
  "bar.dictionary": "Từ điển",
  "title.dictionary": "Tra từ điển",
  "dict.placeholder": "Nhập từ cần tra",
  "dict.en": "Từ tiếng Anh (Wiktionary EN)",
  "dict.vi": "Từ tiếng Việt (Wiktionary VI)",
  "dict.lookup": "Tra",
  "settings.sleep": "Tab ngủ sau khi rảnh",
  "settings.sleepOff": "Tắt",
  "terms.title": "Điều khoản sử dụng và chính sách quyền riêng tư",
  "terms.accept": "Tôi đồng ý",
  "terms.decline": "Từ chối và thoát",
};

export type Key = keyof typeof vi;

const en: Record<Key, string> = {
  "app.private": "Private",
  "bar.newTab": "New tab",
  "bar.home": "Home",
  "bar.address": "Enter an address or search",
  "bar.group": "Tab group",
  "bar.pin": "Pin tab",
  "bar.unpin": "Unpin",
  "bar.findTabs": "Find tabs",
  "bar.reading": "Reading list",
  "bar.downloads": "Downloads",
  "bar.privateToggle": "Private mode (no history)",
  "bar.settings": "Settings",
  "bar.addReading": "Add to reading list",
  "bar.bookmark": "Bookmark this page",
  "panel.close": "Close",
  "panel.remove": "remove",
  "panel.searchHistory": "Search history",
  "panel.siteHost": "Domain, e.g. example.com",
  "panel.clearSite": "Clear for site",
  "panel.clearHistory": "Clear all history",
  "panel.searchTabs": "Search tabs by title or address",
  "panel.clearList": "Clear list",
  "title.bookmarks": "Bookmarks",
  "title.history": "History",
  "title.downloads": "Downloads",
  "title.tabs": "Find tabs",
  "title.reading": "Reading list",
  "title.settings": "Settings",
  "settings.general": "General",
  "settings.language": "Language",
  "settings.langVi": "Tiếng Việt",
  "settings.langEn": "English",
  "settings.homepage": "Home page",
  "settings.homeHint": "Used by the 🏠 button on the toolbar. Saved when you leave the field.",
  "settings.privacy": "Privacy",
  "settings.privateMode": "Private mode (no history)",
  "settings.clearData": "Clear browsing data (history, downloads, session)",
  "settings.cleared": "Browsing data cleared.",
  "settings.downloads": "Downloads",
  "settings.downloadsHint":
    "Files are saved to the Windows Downloads folder. Executable files (.exe, .bat, .ps1…) are renamed with a .download suffix.",
  "settings.about": "About",
  "settings.version": "Version",
  "settings.webview": "WebView2",
  "settings.storage": "Storage",
  "settings.storageOk": "Ready",
  "settings.storageOff": "Unavailable",
  "settings.diagnostics": "Diagnostics",
  "settings.searchEngine": "Search engine",
  "settings.engineDuck": "DuckDuckGo",
  "settings.engineGoogle": "Google",
  "settings.engineBing": "Bing",
  "settings.engineBrave": "Brave Search",
  "settings.startup": "On startup",
  "settings.startupRestore": "Continue where you left off",
  "settings.startupHome": "Open the home page",
  "settings.startupBlank": "Open a blank page",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.themeSystem": "Follow system",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.zoom": "Page zoom",
  "settings.privateHint": "Applies to tabs opened after turning it on.",
  "settings.clearOnExit": "Clear cookies and browsing data on exit",
  "settings.clearOnExitHint": "This may also sign you out. Not yet verified on Windows.",
  "settings.cookies": "Cookies",
  "settings.cookiesNote": "Blocking third-party cookies is not supported: the current API does not allow it.",
  "settings.downloadDirHint": "Leave empty for the default Downloads folder. The folder must exist.",
  "settings.downloadDirPlaceholder": "e.g. D:\\Downloads",
  "bar.dictionary": "Dictionary",
  "title.dictionary": "Dictionary lookup",
  "dict.placeholder": "Enter a word to look up",
  "dict.en": "English words (Wiktionary EN)",
  "dict.vi": "Vietnamese words (Wiktionary VI)",
  "dict.lookup": "Look up",
  "settings.sleep": "Sleep tabs after being idle",
  "settings.sleepOff": "Off",
  "terms.title": "Terms of use and privacy policy",
  "terms.accept": "I agree",
  "terms.decline": "Decline and exit",
};

const dict: Record<Lang, Record<Key, string>> = { vi, en };

let current: Lang = "vi";
const subscribers = new Set<() => void>();

export function setLang(lang: Lang): void {
  current = lang;
  subscribers.forEach((f) => f());
}

export function getLang(): Lang {
  return current;
}

export function t(key: Key): string {
  return dict[current][key];
}

/// Hook để component render lại khi đổi ngôn ngữ; trả về ngôn ngữ hiện hành.
export function useLang(): Lang {
  const [lang, setL] = useState<Lang>(current);
  useEffect(() => {
    const f = () => setL(current);
    subscribers.add(f);
    return () => {
      subscribers.delete(f);
    };
  }, []);
  return lang;
}
