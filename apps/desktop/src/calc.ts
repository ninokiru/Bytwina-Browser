// Máy tính nhỏ cho omnibox. Cố ý KHÔNG dùng `Function`/`eval`: chuỗi người
// dùng gõ vào ô địa chỉ không bao giờ được thực thi như mã JavaScript.
// Hỗ trợ + - * / % ^, dấu ngoặc và dấu âm/dương; trả null nếu biểu thức sai.

const ALLOWED = /^[\d\s+\-*/().%^]+$/;

export function evaluateArithmetic(input: string): string | null {
  const src = input.trim();
  if (!src || !ALLOWED.test(src)) return null;
  // Chỉ coi là phép tính khi có ít nhất một toán tử; "2026" là để tìm kiếm.
  if (!/[+\-*/%^]/.test(src)) return null;

  let i = 0;
  const skip = () => {
    while (i < src.length && /\s/.test(src[i])) i += 1;
  };

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
    // Luỹ thừa kết hợp phải: 2^3^2 = 2^(3^2).
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
    // 12 chữ số có nghĩa đủ cho tiền tệ/khoa học nhẹ, tránh 0.30000000000000004.
    return String(Number(value.toPrecision(12)));
  } catch {
    return null;
  }
}
