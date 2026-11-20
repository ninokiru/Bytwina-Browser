// Chụp ảnh giao diện từ preview.html. Chạy từ thư mục `scripts` (nơi có
// node_modules riêng của công cụ chụp) và đứng ở gốc repo:
//   mkdir scripts && cd scripts && npm i -D puppeteer-core vite && cd ..
//   node scripts/capture-screens.mjs
// CI làm đúng các bước đó, dùng Edge có sẵn trên runner Windows.
//
// Ảnh là giao diện THẬT của ứng dụng, dựng bằng đúng React/CSS trong src/ với
// dữ liệu mẫu của src/preview.tsx — không phải mockup vẽ tay.
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { build, preview } from "vite";

const root = path.resolve("apps/desktop");
const outDir = path.resolve("docs/screenshots");
const WIDTH = 1280;
const HEIGHT = 800;

const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

// panel=... tự mở bảng nhờ đoạn hook cuối preview.tsx (bấm nút mang data-panel).
const shots = [
  { name: "new-tab", query: "newtab=1&theme=light" },
  { name: "browsing", query: "theme=light" },
  { name: "dark-mode", query: "theme=dark" },
  { name: "vertical-tabs", query: "vertical=1&theme=light" },
  { name: "menu", query: "panel=menu&theme=light" },
  { name: "settings", query: "panel=settings&theme=light" },
  { name: "passwords", query: "vault=1&panel=passwords&theme=light" },
];

async function findBrowser() {
  for (const p of BROWSERS) {
    try {
      await access(p);
      return p;
    } catch {
      // thử đường dẫn tiếp theo
    }
  }
  throw new Error("Không thấy Edge/Chrome; đặt BROWSER_PATH.");
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await build({ root, logLevel: "warn" });
const server = await preview({ root, preview: { port: 4173, strictPort: true }, logLevel: "warn" });
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER_PATH ?? (await findBrowser()),
  headless: true,
  // Ảnh 2x để GitHub hiển thị nét trên màn hình HiDPI.
  args: ["--hide-scrollbars", "--force-device-scale-factor=2"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  for (const shot of shots) {
    await page.goto(`${base}/preview.html?${shot.query}`, { waitUntil: "networkidle0" });
    // Hook mở bảng chạy theo nhịp 100ms, tối đa ~6 giây.
    await wait(shot.query.includes("panel=") ? 2500 : 600);
    await page.screenshot({ path: path.join(outDir, `${shot.name}.png`) });
    console.log(`docs/screenshots/${shot.name}.png`);
  }
} finally {
  await browser.close();
  await server.close();
  await rm(path.join(root, "dist"), { recursive: true, force: true });
}
