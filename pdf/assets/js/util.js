/* ==========================================================================
   Mühür — util.js
   Small, dependency-free helpers shared by every module: bytes, hashing,
   ids, dates and formatting. Nothing here touches the DOM except
   downloadBytes(), which is only called from the browser.
   ========================================================================== */

export const enc = new TextEncoder();
export const dec = new TextDecoder();

/* --------------------------------- Bytes -------------------------------- */
export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError("Beklenmeyen veri türü");
}

export function concatBytes(parts) {
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// Binary string (one char per byte) <-> bytes. forge works on these.
export function bytesToBinary(bytes) {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return out;
}

export function binaryToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

export function bytesToHex(bytes, sep) {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase());
  return hex.join(sep || "");
}

export function bytesToBase64(bytes) {
  return btoa(bytesToBinary(bytes));
}

export function base64ToBytes(b64) {
  return binaryToBytes(atob(b64));
}

// Find an ASCII needle in bytes, searching forward from `from`.
export function indexOfAscii(bytes, needle, from) {
  const n = enc.encode(needle);
  outer: for (let i = from || 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

export function lastIndexOfAscii(bytes, needle, from) {
  const n = enc.encode(needle);
  const start = Math.min(from == null ? bytes.length - n.length : from, bytes.length - n.length);
  outer: for (let i = start; i >= 0; i--) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

/* -------------------------------- Hashing ------------------------------- */
export async function digest(algorithm, bytes) {
  return new Uint8Array(await crypto.subtle.digest(algorithm, bytes));
}

export async function sha256Hex(bytes, sep) {
  return bytesToHex(await digest("SHA-256", bytes), sep);
}

/* ---------------------------------- Ids --------------------------------- */
export function uid(prefix) {
  const r = crypto.getRandomValues(new Uint8Array(9));
  return (prefix ? prefix + "_" : "") + bytesToBase64(r).replace(/[+/=]/g, (c) => ({ "+": "a", "/": "b", "=": "" }[c]));
}

/* --------------------------------- Dates -------------------------------- */
function pad(n, w) { return String(n).padStart(w || 2, "0"); }

// D:YYYYMMDDHHmmSS+hh'mm' in local time, as PDF dates are written.
export function pdfDate(date) {
  const d = date || new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return "D:" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) +
    sign + pad(Math.floor(abs / 60)) + "'" + pad(abs % 60) + "'";
}

export function parsePdfDate(str) {
  if (!str) return null;
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(str);
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", tz, th = "00", tm = "00"] = m;
  let iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (tz === "Z" || tz === "z") iso += "Z";
  else if (tz === "+" || tz === "-") iso += `${tz}${th}:${tm}`;
  const date = new Date(iso);
  return isNaN(date) ? null : date;
}

const TR = "tr-TR";
export function formatDate(date) {
  return new Date(date).toLocaleDateString(TR, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(date) {
  return new Date(date).toLocaleString(TR, {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatRelative(date) {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return "az önce";
  if (diff < 3600) return Math.floor(diff / 60) + " dk önce";
  if (diff < 86400) return Math.floor(diff / 3600) + " sa önce";
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + " gün önce";
  return formatDate(date);
}

export function tzLabel(date) {
  const off = -(date || new Date()).getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return "UTC" + sign + pad(Math.floor(abs / 60)) + ":" + pad(abs % 60);
}

/* ------------------------------- Formatting ----------------------------- */
export function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toLocaleString(TR, { maximumFractionDigits: 0 }) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toLocaleString(TR, { maximumFractionDigits: 1 }) + " MB";
  return (n / 1024 / 1024 / 1024).toLocaleString(TR, { maximumFractionDigits: 2 }) + " GB";
}

export function baseName(name) {
  return String(name || "belge").replace(/\.[^.]+$/, "");
}

export function safeFileName(name, ext) {
  const clean = String(name || "belge").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim() || "belge";
  return ext && !clean.toLowerCase().endsWith("." + ext) ? clean + "." + ext : clean;
}

/* ------------------------------- Colors --------------------------------- */
export function hexToRgb(hex) {
  const h = String(hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  return [0, 2, 4].map((i) => parseInt(full.substr(i, 2), 16) / 255);
}

export function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/* ------------------------------ Download -------------------------------- */
export function downloadBytes(bytes, fileName, mime) {
  const blob = new Blob([bytes], { type: mime || "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function debounce(fn, ms) {
  let t = 0;
  const run = function () {
    const args = arguments;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
  run.flush = () => { clearTimeout(t); fn(); };
  run.cancel = () => clearTimeout(t);
  return run;
}
