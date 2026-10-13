/* ==========================================================================
   Mühür — convert/zip.js
   OOXML files (docx, xlsx, pptx) are zip archives of XML parts. These are
   the only helpers the readers and writers need: zip/unzip through
   fflate, text <-> bytes, XML parsing with the platform DOMParser and a
   few namespace-tolerant DOM lookups.
   ========================================================================== */

import { fflate } from "../libs.js";

const te = new TextEncoder();
const td = new TextDecoder();

export const utf8 = (s) => te.encode(s);
export const fromUtf8 = (b) => td.decode(b);

// files: { "word/document.xml": string | Uint8Array }
export async function zip(files, { level = 6 } = {}) {
  const f = await fflate();
  const input = {};
  for (const [path, data] of Object.entries(files)) {
    if (data == null) continue;
    const bytes = typeof data === "string" ? utf8(data) : data;
    // already-compressed media gains nothing from deflate
    const stored = /\.(png|jpe?g|gif|webp|gz)$/i.test(path);
    input[path] = [bytes, { level: stored ? 0 : level }];
  }
  return f.zipSync(input);
}

// -> { path: Uint8Array }
export async function unzip(bytes) {
  const f = await fflate();
  try {
    return f.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch (err) {
    throw new Error("Dosya açılamadı: geçerli bir Office (zip) dosyası değil.");
  }
}

export function partText(files, path) {
  const b = files[path] || files[path.replace(/^\//, "")];
  return b ? fromUtf8(b) : null;
}

/* --------------------------------- XML ----------------------------------- */
export function parseXml(text) {
  const doc = new globalThis.DOMParser().parseFromString(text, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error("XML okunamadı: " + (err.textContent || "").slice(0, 120));
  return doc;
}

export function xmlPart(files, path) {
  const t = partText(files, path);
  return t == null ? null : parseXml(t);
}

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // characters XML 1.0 forbids
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Namespace-agnostic lookups by local name ("w:p" -> "p"). DOMParser in the
// browser and xmldom in tests both keep localName.
export function children(el, local) {
  const out = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (local == null || n.localName === local)) out.push(n);
  }
  return out;
}

export function child(el, local) {
  if (!el) return null;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && n.localName === local) return n;
  return null;
}

export function descendants(el, local) {
  const out = [];
  if (!el) return out;
  const all = el.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) if (all[i].localName === local) out.push(all[i]);
  return out;
}

// Attribute by local name, whatever its prefix ("w:val" -> "val").
export function attr(el, local) {
  if (!el || !el.attributes) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.localName === local || a.name === local) return a.value;
  }
  return null;
}

// Relationships part -> Map(id -> { target, type, external })
export function readRels(files, relsPath) {
  const map = new Map();
  const doc = xmlPart(files, relsPath);
  if (!doc) return map;
  for (const r of descendants(doc.documentElement, "Relationship")) {
    map.set(attr(r, "Id"), { target: attr(r, "Target"), type: attr(r, "Type") || "", external: attr(r, "TargetMode") === "External" });
  }
  return map;
}

// Resolve a relationship target against the part that owns it.
export function resolvePath(fromPart, target) {
  if (target.startsWith("/")) return target.slice(1);
  const base = fromPart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") base.pop();
    else if (seg !== ".") base.push(seg);
  }
  return base.join("/");
}
