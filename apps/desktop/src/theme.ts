// Chủ đề giao diện: "system" theo Windows; "light"/"dark" cố định.
// Đặt thuộc tính data-theme trên <html>; màu khai báo trong src/styles.css.
export function applyTheme(choice: string): void {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const dark = choice === "dark" || (choice !== "light" && prefersDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
