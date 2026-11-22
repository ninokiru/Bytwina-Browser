import { useEffect, useState } from "react";
import { cmd } from "./tabs";

// Favicon đi qua cache SQLite ở backend (favicon_get / favicon_fetch), không gọi
// Google trực tiếp từ giao diện. Mỗi domain chỉ hỏi backend một lần trong phiên.
const memo = new Map<string, Promise<string | null>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function loadFavicon(domain: string): Promise<string | null> {
  if (!domain) return Promise.resolve(null);
  let p = memo.get(domain);
  if (!p) {
    p = (async () => {
      const cached = await cmd("favicon_get", { domain }).catch(() => null);
      if (typeof cached === "string" && cached) return cached;
      // favicon_fetch trả về ngay và tải ở luồng nền, nên cần hỏi lại cache sau đó.
      await cmd("favicon_fetch", { domain }).catch(() => undefined);
      for (let i = 0; i < 4; i += 1) {
        await sleep(1000);
        const got = await cmd("favicon_get", { domain }).catch(() => null);
        if (typeof got === "string" && got) return got;
      }
      return null;
    })();
    memo.set(domain, p);
  }
  return p;
}

export function FaviconImg({ host, className }: { host: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void loadFavicon(host).then((s) => {
      if (alive) setSrc(s);
    });
    return () => {
      alive = false;
    };
  }, [host]);
  return src ? <img src={src} alt="" className={className} /> : null;
}
