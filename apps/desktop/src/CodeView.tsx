import { useEffect, useMemo, useRef, useState } from "react";
import { getLang } from "./i18n";

// Khung xem code/văn bản: tô màu cú pháp bằng Shiki (đã có trong dependencies),
// số dòng, ngắt dòng, định dạng JSON/XML và sao chép. Toàn bộ xử lý cục bộ,
// không gửi nội dung tệp ra mạng.
// Shiki được lazy-load chỉ khi mở file code đầu tiên để giảm kích thước bundle.

const LANG_BY_EXT: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  vue: "vue",
  svelte: "svelte",
  json: "json",
  jsonc: "jsonc",
  jsonl: "jsonl",
  md: "markdown",
  markdown: "markdown",
  rst: "markdown",
  html: "html",
  htm: "html",
  xhtml: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  groovy: "groovy",
  gradle: "groovy",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  fs: "fsharp",
  fsx: "fsharp",
  vb: "vb",
  php: "php",
  rb: "ruby",
  pl: "perl",
  pm: "perl",
  lua: "lua",
  r: "r",
  jl: "julia",
  dart: "dart",
  swift: "swift",
  ksh: "shellscript",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",
  ps1: "powershell",
  psm1: "powershell",
  bat: "bat",
  cmd: "bat",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  proto: "proto",
  sol: "solidity",
  asm: "asm",
  s: "asm",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  hs: "haskell",
  lhs: "haskell",
  clj: "clojure",
  cljs: "clojure",
  elm: "elm",
  nim: "nim",
  zig: "zig",
  v: "v",
  tf: "terraform",
  hcl: "hcl",
  toml: "toml",
  ini: "ini",
  yml: "yaml",
  yaml: "yaml",
  diff: "diff",
  patch: "diff",
  tex: "latex",
  csv: "csv",
  tsv: "tsv",
  log: "log",
  conf: "ini",
  cfg: "ini",
  env: "dotenv",
  properties: "properties",
  nginx: "nginx",
};

const JSON_EXT = new Set(["json", "jsonc", "jsonl", "geojson", "webmanifest"]);
const XML_EXT = new Set(["xml", "xhtml", "svg", "rss", "atom", "plist", "csproj", "xaml"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function langOf(name: string): string {
  return LANG_BY_EXT[extOf(name)] ?? "text";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function formatJson(src: string, ext: string): { text?: string; error?: string } {
  if (ext === "jsonl") {
    const lines = src.split(/\r?\n/).filter((line) => line.trim());
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        out.push(JSON.stringify(JSON.parse(lines[i])));
      } catch {
        return { error: `Dòng ${i + 1}: JSON không hợp lệ.` };
      }
    }
    return { text: out.join("\n") };
  }
  try {
    return { text: JSON.stringify(JSON.parse(src), null, 2) };
  } catch (e) {
    return {
      error:
        e instanceof Error ? `JSON không hợp lệ: ${e.message}` : "JSON không hợp lệ.",
    };
  }
}

// Pretty-print XML/HTML bằng cách tách thẻ và thụt lề theo độ sâu. Không phải
// parser đầy đủ: giữ nguyên nội dung, chỉ thêm xuống dòng và khoảng trắng.
function formatXml(src: string): string {
  const compact = src.replace(/>\s+</g, "><").trim();
  const lines = compact.replace(/(>)(<)(\/*)/g, "$1\n$2$3").split("\n");
  let depth = 0;
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
    out.push("  ".repeat(depth) + line);
    const opens =
      /^<[^!?/][^>]*[^/]>$/.test(line) &&
      !/<\/[^>]+>$/.test(line) &&
      !/^<[^>]+\/>$/.test(line);
    if (opens) depth += 1;
  }
  return out.join("\n");
}

export default function CodeView({
  name,
  text,
  truncated,
}: {
  name: string;
  text: string;
  truncated: boolean;
}) {
  const en = getLang() === "en";
  const ext = extOf(name);
  const isJson = JSON_EXT.has(ext);
  const isXml = XML_EXT.has(ext);
  const isJsonl = ext === "jsonl";

  const [mode, setMode] = useState<"raw" | "pretty">("raw");
  const [pretty, setPretty] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [wrap, setWrap] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [shikiModule, setShikiModule] = useState<any>(null);
  const timer = useRef<number | null>(null);

  // Lazy-load shiki chỉ khi component mount (giảm bundle size ban đầu).
  useEffect(() => {
    let alive = true;
    void import("shiki").then((mod) => {
      if (alive) setShikiModule(mod);
    });
    return () => {
      alive = false;
    };
  }, []);

  const shown = mode === "pretty" && pretty != null ? pretty : text;
  const lang = useMemo(() => langOf(name), [name]);

  // JSON hợp lệ được định dạng sẵn; XML để người dùng bấm "Định dạng" vì có thể
  // đổi khoảng trắng đáng kể. Tệp lớn bỏ qua để không treo UI.
  useEffect(() => {
    setPretty(null);
    setMode("raw");
    setNotice("");
    if (isJson && !isJsonl && text.length < 500_000) {
      const result = formatJson(text, ext);
      if (result.text) {
        setPretty(result.text);
        setMode("pretty");
      }
    }
  }, [text, isJson, isJsonl, ext]);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    if (!shikiModule) return;
    if (shown.length > 400_000) return;
    void shikiModule.codeToHtml(shown, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    })
      .then((value: string) => {
        if (alive) setHtml(value);
      })
      .catch((e: unknown) => {
        console.warn("shiki", e);
        if (alive) setHtml(null);
      });
    return () => {
      alive = false;
    };
  }, [shown, lang, shikiModule]);

  useEffect(() => {
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, []);

  const flash = (message: string) => {
    setNotice(message);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(""), 2200);
  };

  const doCopy = async (value: string, label: string) => {
    const ok = await copyText(value);
    flash(
      ok
        ? en
          ? `${label} copied.`
          : `Đã chép ${label.toLowerCase()}.`
        : en
          ? "Could not copy."
          : "Không chép được.",
    );
  };

  const toggleFormat = () => {
    if (mode === "pretty") {
      setMode("raw");
      setNotice("");
      return;
    }
    if (isJson) {
      const result = formatJson(text, ext);
      if (result.text == null) {
        flash(result.error ?? (en ? "Invalid JSON." : "JSON không hợp lệ."));
        return;
      }
      setPretty(result.text);
      setMode("pretty");
      setNotice("");
      return;
    }
    setPretty(formatXml(text));
    setMode("pretty");
    setNotice("");
  };

  const minified = () => {
    if (isJson) {
      const result = formatJson(text, ext);
      if (result.text == null) return result.error ?? null;
      if (isJsonl) return result.text;
      try {
        return JSON.stringify(JSON.parse(result.text));
      } catch {
        return null;
      }
    }
    if (isXml) return text.replace(/>\s+</g, "><").trim();
    return null;
  };

  const lineCount = useMemo(() => shown.split("\n").length, [shown]);

  return (
    <div className="fv-codebox">
      <div className="fv-code-tools">
        {(isJson || isXml) && (
          <button type="button" className="btn" onClick={toggleFormat}>
            {mode === "pretty" ? (en ? "Source" : "Nguồn") : en ? "Format" : "Định dạng"}
          </button>
        )}
        {(isJson || isXml) && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              const value = minified();
              if (value == null) {
                flash(en ? "Invalid content." : "Nội dung không hợp lệ.");
                return;
              }
              void doCopy(value, en ? "Minified" : "Bản thu gọn");
            }}
          >
            {en ? "Copy minified" : "Chép thu gọn"}
          </button>
        )}
        <button type="button" className="btn" onClick={() => setWrap((v) => !v)}>
          {wrap ? (en ? "No wrap" : "Không ngắt dòng") : en ? "Wrap lines" : "Ngắt dòng"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void doCopy(shown, en ? "Content" : "Nội dung")}
        >
          {en ? "Copy" : "Sao chép"}
        </button>
        <span className="fv-code-meta">
          {lineCount} {en ? "lines" : "dòng"}
          {notice ? ` · ${notice}` : ""}
        </span>
      </div>

      {truncated && (
        <p className="fv-note">
          {en ? "Only the first 2 MB is shown." : "Chỉ hiển thị 2 MB đầu tiên."}
        </p>
      )}

      {html ? (
        <div
          className={`fv-shiki${wrap ? " fv-wrap" : ""}`}
          // Shiki tạo HTML từ chính nội dung tệp và tự escape ký tự đặc biệt.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={`fv-code${wrap ? " fv-wrap" : ""}`}>{shown}</pre>
      )}
    </div>
  );
}
