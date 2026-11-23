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
    style.removeProperty("--accent-text");
    return;
  }
  style.setProperty("--accent", found.color);
  style.setProperty("--accent-soft", `color-mix(in srgb, ${found.color} 14%, transparent)`);
  // Chữ trên nút nhấn luôn trắng: chế độ tối của styles.css dùng chữ gần đen,
  // đặt lên các màu mẫu ở đây sẽ thiếu tương phản.
  style.setProperty("--accent-text", "#ffffff");
}

// Độ bo góc: nhân ba biến --radius-sm/md/lg của styles.css. "default" trả về giá trị gốc.
export const RADIUS_SCALES: Record<string, number> = { sharp: 0.35, default: 1, round: 1.5 };

export function applyRadius(id: string): void {
  const style = document.documentElement.style;
  const scale = RADIUS_SCALES[id] ?? 1;
  if (scale === 1) {
    style.removeProperty("--radius-sm");
    style.removeProperty("--radius-md");
    style.removeProperty("--radius-lg");
    return;
  }
  style.setProperty("--radius-sm", `${Math.round(8 * scale)}px`);
  style.setProperty("--radius-md", `${Math.round(12 * scale)}px`);
  style.setProperty("--radius-lg", `${Math.round(16 * scale)}px`);
}

// Giảm chuyển động: gắn data-motion="reduced" để Appearance.css tắt animation và transition.
export function applyMotion(reduced: boolean): void {
  const root = document.documentElement;
  if (reduced) root.dataset.motion = "reduced";
  else delete root.dataset.motion;
}
