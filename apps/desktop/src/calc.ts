// Máy tính nhỏ cho omnibox. Cố ý KHÔNG dùng `Function`/`eval`: chuỗi người
// dùng gõ vào ô địa chỉ không bao giờ được thực thi như mã JavaScript.
// Hỗ trợ + - * / % ^, dấu ngoặc và dấu âm/dương; trả null nếu biểu thức sai.
// MỚI: Hỗ trợ chuyển đổi đơn vị "10 usd to vnd", "100px to rem", "50kg to lb", v.v.

const ALLOWED = /^[\d\s+\-*/().%^]+$/;

// --- Chuyển đổi đơn vị ---
// Tỷ giá cache (tự cập nhật từ API miễn phí khi cần).
const EXCHANGE_CACHE: Map<string, { rate: number; ts: number }> = new Map();
const EXCHANGE_TTL = 1000 * 60 * 60 * 6; // 6 giờ

// Đơn vị dài (metric/imperial).
const LENGTH_UNITS: Record<string, number> = {
  // metric
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  // imperial
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
  mi: 1609.344,
  // css/typography
  px: 1 / 96 * 0.0254, // 1px = 1/96 inch
  pt: 1 / 72 * 0.0254,
  pc: 1 / 6 * 0.0254,
  rem: 16 * (1 / 96 * 0.0254), // 1rem = 16px mặc định
  em: 16 * (1 / 96 * 0.0254),
  "%": 1, // phần trăm không chuyển đổi trực tiếp
  vw: 1, vh: 1, vmin: 1, vmax: 1, // viewport units - không chuyển đổi
};

const MASS_UNITS: Record<string, number> = {
  mg: 0.000001,
  g: 0.001,
  kg: 1,
  t: 1000,
  oz: 0.0283495,
  lb: 0.453592,
  st: 6.35029,
};

const TEMP_UNITS: Record<string, (v: number) => number> = {
  c: (v) => v,
  f: (v) => (v - 32) * 5 / 9,
  k: (v) => v - 273.15,
};

const VOLUME_UNITS: Record<string, number> = {
  ml: 0.001,
  l: 1,
  tsp: 0.00492892,
  tbsp: 0.0147868,
  cup: 0.236588,
  pt: 0.473176,
  qt: 0.946353,
  gal: 3.78541,
  floz: 0.0295735,
};

const TIME_UNITS: Record<string, number> = {
  ms: 0.001,
  s: 1,
  min: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

const DATA_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024,
  kib: 1000,
  mib: 1000 * 1000,
  gib: 1000 * 1000 * 1000,
  tib: 1000 * 1000 * 1000 * 1000,
};

// Chỉ các đơn vị có tỷ lệ số (không phải nhiệt độ).
const UNITS_WITH_RATIO: Record<string, Record<string, number>> = {
  length: LENGTH_UNITS,
  mass: MASS_UNITS,
  volume: VOLUME_UNITS,
  time: TIME_UNITS,
  data: DATA_UNITS,
};

// Chuẩn hóa key đơn vị: bỏ dấu, lowercase.
function normUnit(u: string): string {
  return u.toLowerCase().replace(/[^a-z%]/g, "");
}

// Tìm nhóm đơn vị và giá trị cơ sở (chỉ các đơn vị có tỷ lệ số).
function findUnitGroup(unit: string): { group: string; base: number } | null {
  const n = normUnit(unit);
  for (const [group, units] of Object.entries(UNITS_WITH_RATIO)) {
    if (n in units) return { group, base: units[n] };
  }
  return null;
}

// Lấy tỷ giá từ API (exchangerate.host - miễn phí, không cần key).
async function fetchRate(from: string, to: string): Promise<number | null> {
  const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
  const cached = EXCHANGE_CACHE.get(key);
  if (cached && Date.now() - cached.ts < EXCHANGE_TTL) return cached.rate;

  try {
    const res = await fetch(`https://api.exchangerate.host/latest?base=${from.toUpperCase()}&symbols=${to.toUpperCase()}`);
    const data = await res.json();
    if (data.rates && data.rates[to.toUpperCase()]) {
      const rate = data.rates[to.toUpperCase()];
      EXCHANGE_CACHE.set(key, { rate, ts: Date.now() });
      return rate;
    }
  } catch {}
  return null;
}

// Phân tích chuỗi chuyển đổi: "10 usd to vnd", "100px to rem", "50 kg to lb"
const CONVERT_REGEX = /^([\d.,]+)\s*([a-zA-Z%]+)\s*(?:to|in|->|=)\s*([a-zA-Z%]+)$/i;

function parseConvert(input: string): { value: number; from: string; to: string } | null {
  const m = input.trim().match(CONVERT_REGEX);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return { value, from: m[2], to: m[3] };
}

// Hàm chính: thử chuyển đổi đơn vị trước, sau đó mới tính toán.
export async function evaluateWithUnits(input: string): Promise<string | null> {
  const src = input.trim();
  if (!src) return null;

  // 1) Thử parse chuyển đổi đơn vị
  const conv = parseConvert(src);
  if (conv) {
    const { value, from, to } = conv;
    const nFrom = normUnit(from);
    const nTo = normUnit(to);

    // Nhiệt độ
    if (nFrom in TEMP_UNITS && nTo in TEMP_UNITS) {
      const celsius = TEMP_UNITS[nFrom](value);
      let result: number;
      if (nTo === "c") result = celsius;
      else if (nTo === "f") result = celsius * 9 / 5 + 32;
      else if (nTo === "k") result = celsius + 273.15;
      else return null;
      return `${value} ${from.toUpperCase()} = ${Number(result.toPrecision(12))} ${to.toUpperCase()}`;
    }

    // Tiền tệ (3 chữ cái)
    if (nFrom.length === 3 && nTo.length === 3) {
      const rate = await fetchRate(nFrom, nTo);
      if (rate != null) {
        const result = value * rate;
        return `${value} ${from.toUpperCase()} = ${Number(result.toPrecision(12))} ${to.toUpperCase()}`;
      }
    }

    // Các nhóm đơn vị khác
    const gFrom = findUnitGroup(from);
    const gTo = findUnitGroup(to);
    if (gFrom && gTo && gFrom.group === gTo.group) {
      const result = (value * gFrom.base) / gTo.base;
      return `${value} ${from} = ${Number(result.toPrecision(12))} ${to}`;
    }

    return null; // không cùng nhóm
  }

  // 2) Fallback: chỉ tính toán
  return evaluateArithmetic(src);
}

// Giữ hàm cũ để tương thích.
export function evaluateArithmetic(input: string): string | null {
  const src = input.trim();
  if (!src || !ALLOWED.test(src)) return null;
  if (!/[+\-*/%^]/.test(src)) return null;

  let i = 0;
  const skip = () => { while (i < src.length && /\s/.test(src[i])) i += 1; };

  const parseExpr = (): number => {
    let value = parseTerm();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "+" && op !== "-") break;
      i += 1;
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };

  const parseTerm = (): number => {
    let value = parseUnary();
    for (;;) {
      skip();
      const op = src[i];
      if (op !== "*" && op !== "/" && op !== "%") break;
      i += 1;
      const right = parseUnary();
      if ((op === "/" || op === "%") && right === 0) throw new Error("chia cho 0");
      if (op === "*") value *= right;
      else if (op === "/") value /= right;
      else value %= right;
    }
    return value;
  };

  const parseUnary = (): number => {
    skip();
    const op = src[i];
    if (op === "+" || op === "-") {
      i += 1;
      const value = parseUnary();
      return op === "-" ? -value : value;
    }
    return parsePower();
  };

  const parsePower = (): number => {
    const base = parseAtom();
    skip();
    if (src[i] !== "^") return base;
    i += 1;
    return base ** parseUnary();
  };

  const parseAtom = (): number => {
    skip();
    if (src[i] === "(") {
      i += 1;
      const value = parseExpr();
      skip();
      if (src[i] !== ")") throw new Error("thiếu ngoặc");
      i += 1;
      return value;
    }
    const match = /^\d*\.?\d+/.exec(src.slice(i));
    if (!match) throw new Error("thiếu số");
    i += match[0].length;
    return Number(match[0]);
  };

  try {
    const value = parseExpr();
    skip();
    if (i !== src.length || !Number.isFinite(value)) return null;
    return String(Number(value.toPrecision(12)));
  } catch {
    return null;
  }
}