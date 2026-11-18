// Chủ đề giao diện: "system" theo Windows; "light"/"dark" cố định.
// Đặt thuộc tính data-theme trên <html>; màu được khai báo bằng biến CSS trong index.html.
export function applyTheme(choice: string): void {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const dark = choice === "dark" || (choice !== "light" && prefersDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
