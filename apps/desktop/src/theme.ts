// Chủ đề giao diện: "system" theo Windows; "light"/"dark" cố định.
// Đặt thuộc tính data-theme trên <html>; màu khai báo trong src/styles.css.
export function applyTheme(choice: string): void {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const dark = choice === "dark" || (choice !== "light" && prefersDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

// Màu nhấn: chọn một mẫu có sẵn. "default" giữ màu gốc của chủ đề.
// Các mẫu đều là tông vừa phải để chữ trên nút nhấn đọc được ở cả hai chủ đề.
export const ACCENTS: { id: string; label: string; labelEn: string; color: string }[] = [
  { id: "default", label: "Mặc định", labelEn: "Default", color: "" },
  { id: "blue", label: "Xanh dương", labelEn: "Blue", color: "#2563eb" },
  { id: "teal", label: "Xanh ngọc", labelEn: "Teal", color: "#0f766e" },
  { id: "violet", label: "Tím", labelEn: "Violet", color: "#7c3aed" },
  { id: "rose", label: "Hồng", labelEn: "Rose", color: "#e11d48" },
  { id: "amber", label: "Hổ phách", labelEn: "Amber", color: "#b45309" },
];

// Ghi biến --accent lên <html>. Id lạ hoặc "default" thì bỏ biến, quay về màu gốc.
export function applyAccent(id: string): void {
  const style = document.documentElement.style;
  const found = ACCENTS.find((a) => a.id === id);
  if (!found || !found.color) {
    style.removeProperty("--accent");
    style.removeProperty("--accent-soft");
    return;
  }
  style.setProperty("--accent", found.color);
  style.setProperty("--accent-soft", `color-mix(in srgb, ${found.color} 14%, transparent)`);
}
