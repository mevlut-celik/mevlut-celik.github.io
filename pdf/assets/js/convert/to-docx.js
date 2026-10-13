/* ==========================================================================
   Mühür — convert/to-docx.js
   FlowDocument -> Word (.docx).

   A .docx is a zip of WordprocessingML parts. Everything is written as
   strings — no XML DOM — because the writer controls every element and
   Word is strict about one thing above all: child ORDER. ECMA-376 /
   ISO 29500 fixes the sequence inside pPr, rPr, tblPr, tcPr, sectPr,
   lvl, style and settings; a property out of place is what makes Word
   report "unreadable content" and offer a repair. Every builder below
   emits its children in schema order.

   Mapping:
     paragraph -> w:p: pStyle HeadingN / ListParagraph, keepNext,
                  pageBreakBefore, numPr, pBdr bottom, shd, spacing
                  (twips; line in 240ths), ind, jc
     run       -> w:r: rFonts, b, i, strike, color, sz (half-points), u,
                  highlight as w:shd fill (any colour, not just Word's 16
                  highlighter pens), vertAlign. Neighbouring runs that
                  share a link become one w:hyperlink (external rel).
     image     -> inline wp:drawing, bytes in word/media, size in EMU,
                  scaled down to the frame it sits in
     table     -> w:tbl: tblGrid in twips, gridSpan for colspan, vMerge
                  restart/continue for rowspan, shading, borders, header
                  rows repeated (tblHeader)
     pagebreak -> a paragraph holding w:br type="page" (Word's own form)
     section   -> the closing section's sectPr goes into the pPr of its
                  last paragraph (as Word stores it); the final sectPr is
                  the last child of w:body
   Lists: each list instance — a run of consecutive list paragraphs —
   gets its own abstractNum + num, so numbering restarts where the
   source's did (Word keeps counting across nums that share an
   abstractNum). Level formats come from the source markers ("a)",
   "iv.", "1.2.", "–") and a jump in the source's numbers starts a new
   instance with the right start value.
   Header / footer: one default part each, referenced from every section;
   "{n}" / "{t}" become PAGE / NUMPAGES fields.

   opts: { onProgress?(done,total,label), title?, author?, lang? ("tr-TR"),
           date? (Date for docProps), strict? (rethrow block errors; tests) }
   ========================================================================== */

import { zip, esc, XML_HEAD } from "./zip.js";
import { officeName } from "./fonts.js";
import { pageSetup, sniffImageMime } from "./model.js";

/* ------------------------------ Namespaces ------------------------------- */
const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const ROOT_NS = `xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}"`;

const WML = "application/vnd.openxmlformats-officedocument.wordprocessingml.";
const CT = {
  main: WML + "document.main+xml",
  styles: WML + "styles+xml",
  numbering: WML + "numbering+xml",
  settings: WML + "settings+xml",
  fontTable: WML + "fontTable+xml",
  header: WML + "header+xml",
  footer: WML + "footer+xml",
  core: "application/vnd.openxmlformats-package.core-properties+xml",
  app: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
};

// Picture formats every Word since 2007 reads. The model promises PNG /
// JPEG; GIF and BMP are accepted when a reader lets one through.
const IMAGE_EXT = { "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/bmp": "bmp" };

const DEFAULT_FONT = "Calibri";
const PROGRESS_LABEL = "Word belgesi oluşturuluyor";

/* --------------------------------- Units --------------------------------- */
// points -> twentieths of a point (twips), EMU (1 pt = 12700 EMU)
const twips = (pt) => Math.round(pt * 20);
const emu = (pt) => Math.max(1, Math.round(pt * 12700));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sum = (a) => a.reduce((s, v) => s + v, 0);

// A finite number or null — `Number(null)` is 0 and must not count.
function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(+v)) return +v;
  return null;
}

function int(v, lo, hi, fallback) {
  const n = num(v);
  return n == null ? fallback : clamp(Math.round(n), lo, hi);
}

/* -------------------------------- Colours -------------------------------- */
// "#rrggbb" (or #rgb / rgb()) -> "RRGGBB"; anything else -> null.
function hex(c) {
  if (c == null || c === "") return null;
  const s = String(c).trim();
  let m = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    if (m[4] != null && parseFloat(m[4]) === 0) return null;   // fully transparent
    return [m[1], m[2], m[3]].map((v) => clamp(Math.round(+v), 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return null;
}

/* --------------------------------- Fonts --------------------------------- */
// Families Word users have. A source that names one keeps it; anything
// else (PDF subset names, CMR10, Liberation…) goes through officeName().
const OFFICE_FONTS = [
  "Arial", "Arial Black", "Arial Narrow", "Aptos", "Aptos Display", "Bahnschrift", "Book Antiqua",
  "Bookman Old Style", "Calibri", "Calibri Light", "Cambria", "Cambria Math", "Candara", "Century Gothic",
  "Comic Sans MS", "Consolas", "Constantia", "Corbel", "Courier New", "Franklin Gothic Medium", "Garamond",
  "Georgia", "Gill Sans MT", "Impact", "Lucida Console", "Lucida Sans Unicode", "Palatino Linotype",
  "Segoe UI", "Symbol", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana", "Wingdings",
];
const FONT_INDEX = new Map(OFFICE_FONTS.map((n) => [n.replace(/\s+/g, "").toLowerCase(), n]));
const fontCache = new Map();

function fontName(name) {
  if (name == null || name === "") return null;
  const raw = String(name);
  if (fontCache.has(raw)) return fontCache.get(raw);
  // "ABCDEF+Arial-BoldMT", "Georgia, serif", "Calibri,Bold", "Arial Bold"
  let n = raw.replace(/^[A-Z]{6}\+/, "").replace(/["']/g, "").split(",")[0].trim();
  n = n.replace(/-.*$/, "").replace(/(PSMT|PS|MT)$/, "");
  n = n.replace(/\s+(bold|italic|oblique|regular|roman|book)(\s+(bold|italic|oblique))?$/i, "").trim();
  const known = FONT_INDEX.get(n.replace(/\s+/g, "").toLowerCase());
  const out = known || (n ? officeName(n) : null);
  fontCache.set(raw, out);
  return out;
}

function fontClass(name) {
  if (/courier|consolas|lucida console|mono/i.test(name)) return { family: "modern", pitch: "fixed" };
  if (/symbol|wingdings/i.test(name)) return { family: "auto", pitch: "variable", charset: "02" };
  if (/times|georgia|cambria|garamond|book|palatino|constantia/i.test(name)) return { family: "roman", pitch: "variable" };
  return { family: "swiss", pitch: "variable" };
}

/* --------------------------------- Links --------------------------------- */
const URI_SAFE = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]/;

// Word refuses a package whose hyperlink target is not a valid URI
// ("unreadable content"), so spaces and non-ASCII are percent-encoded and
// only harmless schemes survive.
function safeLink(link) {
  let s = String(link == null ? "" : link).trim();
  if (!s) return null;
  if (s[0] === "#") {
    const anchor = s.slice(1).replace(/[^\p{L}\p{N}_]/gu, "_").slice(0, 40);
    return anchor ? { anchor } : null;
  }
  if (/^www\./i.test(s)) s = "http://" + s;
  else if (/^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/.test(s)) s = "mailto:" + s;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!scheme || !/^(https?|mailto|ftp|tel|news)$/i.test(scheme[1])) return null;
  let out = "";
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "%") out += /^[0-9a-f]{2}$/i.test(chars.slice(i + 1, i + 3).join("")) ? "%" : "%25";
    else if (URI_SAFE.test(ch)) out += ch;
    else {
      try { out += encodeURIComponent(ch); } catch (e) { /* lone surrogate: drop */ }
    }
  }
  return out.length > 2000 ? null : { url: out };
}

/* ------------------------------ Relationships ---------------------------- */
// One per part that owns relationships (document, header, footer).
class Part {
  constructor() {
    this.rels = [];
    this.byKey = new Map();
  }

  rel(type, target, external) {
    const key = type + "|" + target;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const id = "rId" + (this.rels.length + 1);
    this.rels.push({ id, type, target, external: !!external });
    this.byKey.set(key, id);
    return id;
  }

  xml() {
    return XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">` +
      this.rels.map((r) => `<Relationship Id="${r.id}" Type="${REL}${r.type}" Target="${esc(r.target)}"` +
        (r.external ? ' TargetMode="External"' : "") + "/>").join("") +
      "</Relationships>";
  }
}

/* --------------------------------- Pages --------------------------------- */
// Word pages run from 1 to 22 inches; the frame keeps at least an inch.
function normPage(p) {
  const base = pageSetup();
  const w = num(p && p.width), h = num(p && p.height);
  const width = clamp(w > 0 ? w : base.width, 72, 1584);
  const height = clamp(h > 0 ? h : base.height, 72, 1584);
  const src = (p && p.margin) || {};
  const m = {};
  for (const k of ["top", "right", "bottom", "left"]) {
    const v = num(src[k]);
    m[k] = v != null && v >= 0 ? v : base.margin[k];
  }
  const fit = (a, b, size) => {
    const room = size - 72;
    if (m[a] + m[b] > room) {
      const k = room / (m[a] + m[b]);
      m[a] *= k;
      m[b] *= k;
    }
  };
  fit("left", "right", width);
  fit("top", "bottom", height);
  return { width, height, margin: m };
}

const frameWidth = (pg) => pg.width - pg.margin.left - pg.margin.right;
const frameHeight = (pg) => pg.height - pg.margin.top - pg.margin.bottom;

// EG_HdrFtrReferences, then pgSz, pgMar, cols, docGrid — schema order.
function sectPrXml(pg, refs) {
  const m = pg.margin;
  const orient = pg.width > pg.height ? ' w:orient="landscape"' : "";
  const hdr = twips(clamp(m.top / 2, 0, 36));
  const ftr = twips(clamp(m.bottom / 2, 0, 36));
  return "<w:sectPr>" + refs +
    `<w:pgSz w:w="${twips(pg.width)}" w:h="${twips(pg.height)}"${orient}/>` +
    `<w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}"` +
    ` w:header="${hdr}" w:footer="${ftr}" w:gutter="0"/>` +
    '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>';
}

/* --------------------------------- Lists --------------------------------- */
const ORDERED_DEFAULT = ["decimal", "lowerLetter", "lowerRoman"];
const BULLET_DEFAULT = ["•", "◦", "▪"];
// Symbol / Wingdings private-use bullets a Word reader may hand over.
const PUA_BULLETS = { "": "•", "": "▪", "": "➢", "": "✓", "": "❖", "": "□", "": "o", "": "➔" };

function romanValue(s) {
  if (!/^(m{0,3})(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i.test(s)) return 0;
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  const t = s.toLowerCase();
  for (let i = 0; i < t.length; i++) {
    const a = v[t[i]], b = v[t[i + 1]] || 0;
    total += a < b ? -a : a;
  }
  return total;
}

// "a)" -> lowerLetter "%2)" (at level 1), "iv." -> lowerRoman, "1.2." ->
// "%1.%2.", "(3)" -> decimal "(%1)" starting at 3.
function orderedFormat(marker, level) {
  const n = level + 1;
  const fallback = { fmt: ORDERED_DEFAULT[level % 3], text: `%${n}.`, value: null };
  const m = /^\s*([([]?)\s*(\d+(?:\.\d+)*|[A-Za-z]+)\s*([.):\]]?)\s*$/.exec(String(marker == null ? "" : marker));
  if (!m) return fallback;
  const [, pre, body, post] = m;
  if (/^\d/.test(body)) {
    const parts = body.split(".");
    const value = parseInt(parts[parts.length - 1], 10);
    const text = parts.length > 1 && parts.length === n
      ? pre + parts.map((_, k) => `%${k + 1}`).join(".") + post
      : pre + `%${n}` + post;
    return { fmt: "decimal", text, value: Number.isFinite(value) ? value : null };
  }
  const lower = body === body.toLowerCase(), upper = body === body.toUpperCase();
  if (!lower && !upper) return fallback;
  const text = pre + `%${n}` + post;
  const roman = romanValue(body);
  if (roman && (body.length > 1 || /^i$/i.test(body))) return { fmt: lower ? "lowerRoman" : "upperRoman", text, value: roman };
  if (body.length <= 3 && new RegExp("^(" + body[0] + ")\\1*$").test(body)) {
    const value = (body.length - 1) * 26 + (body.toLowerCase().charCodeAt(0) - 96);
    return { fmt: lower ? "lowerLetter" : "upperLetter", text, value };
  }
  return fallback;
}

function bulletText(marker, level) {
  let s = String(marker == null ? "" : marker).trim();
  if (PUA_BULLETS[s]) s = PUA_BULLETS[s];
  else if (/^[-]$/.test(s)) s = "•";
  if (s === "o") return s;
  if (s === "-") return "–";
  if (s && s !== "*" && s !== "+" && Array.from(s).length <= 3 && !/[\p{L}\p{N}%]/u.test(s)) return s;
  return BULLET_DEFAULT[level % 3];
}

function newList(S) {
  const inst = { numId: S.lists.length + 1, levels: [] };
  S.lists.push(inst);
  return inst;
}

// Number a list paragraph. ctx.list follows the list being written in
// this container (body, cell, header) so a new instance — and with it
// restarted numbering — begins after any non-list block, when a level-0
// item switches between bullets and numbers, or when the source's own
// numbers jump. A jump on a deeper level starts a fresh definition that
// carries the outer counters forward, so the outer numbers keep counting.
function listNumId(S, ctx, list) {
  const level = int(list.level, 0, 8, 0);
  const ordered = !!list.ordered;
  const info = ordered ? orderedFormat(list.marker, level) : { fmt: "bullet", text: bulletText(list.marker, level), value: null };
  const start = num(list.start);
  const value = ordered ? (start != null ? Math.max(0, Math.round(start)) : info.value) : null;
  let st = ctx.list;
  if (st) {
    const def = st.inst.levels[level];
    const expected = st.count[level] != null ? st.count[level] + 1 : def ? def.start : null;
    const kindChanged = def && (def.fmt === "bullet") === ordered;
    const jumped = ordered && value != null && expected != null && value !== expected;
    if (kindChanged || jumped) {
      if (level === 0) st = null;
      else {
        const inst = newList(S);
        for (let j = 0; j < level; j++) {
          const old = st.inst.levels[j];
          if (old) inst.levels[j] = { ...old, start: st.count[j] != null ? st.count[j] + 1 : old.start };
        }
        st = { inst, count: st.count.slice(0, level) };
      }
    }
  }
  if (!st) st = { inst: newList(S), count: [] };
  ctx.list = st;
  const levels = st.inst.levels;
  if (!levels[level]) levels[level] = { fmt: info.fmt, text: info.text, start: value != null ? value : 1 };
  st.count[level] = st.count[level] != null ? st.count[level] + 1 : levels[level].start;
  st.count.length = level + 1;   // deeper levels restart under a new parent, as in Word
  return st.inst.numId;
}

function levelXml(def, l) {
  const font = def.text === "o" ? '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New" w:hint="default"/></w:rPr>' : "";
  // CT_Lvl: start, numFmt, lvlText, lvlJc, pPr, rPr
  return `<w:lvl w:ilvl="${l}"><w:start w:val="${clamp(def.start, 0, 32767)}"/><w:numFmt w:val="${def.fmt}"/>` +
    `<w:lvlText w:val="${esc(def.text)}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr>${font}</w:lvl>`;
}

function abstractNumXml(inst, i) {
  const first = inst.levels.find(Boolean);
  const bullets = first ? first.fmt === "bullet" : true;
  let lv = "";
  for (let l = 0; l < 9; l++) {
    const def = inst.levels[l] || (bullets
      ? { fmt: "bullet", text: BULLET_DEFAULT[l % 3], start: 1 }
      : { fmt: ORDERED_DEFAULT[l % 3], text: `%${l + 1}.`, start: 1 });
    lv += levelXml(def, l);
  }
  // a distinct nsid per list keeps Word from merging them back together
  const nsid = (((i + 1) * 2654435761) >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `<w:abstractNum w:abstractNumId="${i}"><w:nsid w:val="${nsid}"/><w:multiLevelType w:val="hybridMultilevel"/>${lv}</w:abstractNum>`;
}

function numberingXml(S) {
  const lists = S.lists.length ? S.lists : [
    { numId: 1, levels: [{ fmt: "bullet", text: "•", start: 1 }] },
    { numId: 2, levels: [{ fmt: "decimal", text: "%1.", start: 1 }] },
  ];
  // CT_Numbering: every abstractNum before the first num
  return XML_HEAD + `<w:numbering xmlns:w="${NS_W}">` +
    lists.map(abstractNumXml).join("") +
    lists.map((inst, i) => `<w:num w:numId="${inst.numId}"><w:abstractNumId w:val="${i}"/></w:num>`).join("") +
    "</w:numbering>";
}

/* ---------------------------------- Runs --------------------------------- */
// EG_RPrBase order: rStyle, rFonts, b, bCs, i, iCs, strike, color, sz,
// szCs, u, shd, vertAlign.
function runProps(S, r, { linked = false, mark = false, styleBold = false } = {}) {
  const p = [];
  if (linked && !mark) p.push('<w:rStyle w:val="Hyperlink"/>');
  const font = fontName(r.font);
  if (font) {
    S.fonts.add(font);
    const f = esc(font);
    p.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`);
  }
  if (r.bold) p.push("<w:b/><w:bCs/>");
  else if (r.bold === false && styleBold) p.push('<w:b w:val="0"/><w:bCs w:val="0"/>');
  if (r.italic) p.push("<w:i/><w:iCs/>");
  if (r.strike && !mark) p.push("<w:strike/>");
  const color = hex(r.color);
  if (color) p.push(`<w:color w:val="${color}"/>`);
  const size = num(r.size);
  if (size > 0) {
    const hp = clamp(Math.round(size * 2), 2, 3276);
    p.push(`<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`);
  }
  if (mark) return p.join("");
  if (r.underline) p.push('<w:u w:val="single"/>');
  const fill = hex(r.highlight);
  if (fill) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`);
  if (r.valign === "super") p.push('<w:vertAlign w:val="superscript"/>');
  else if (r.valign === "sub") p.push('<w:vertAlign w:val="subscript"/>');
  return p.join("");
}

const BREAKS = new Set(["\r\n", "\r", "\n", "\f", "\v", "\u2028", "\u2029"]);

// Text -> w:t / w:tab / w:br; XML-forbidden characters are dropped by esc().
function textXml(text) {
  let out = "";
  for (const piece of String(text).split(/(\r\n|[\r\n\t\f\v\u2028\u2029])/)) {
    if (!piece) continue;
    if (piece === "\t") out += "<w:tab/>";
    else if (BREAKS.has(piece)) out += "<w:br/>";
    else {
      const t = esc(piece);
      if (t) out += `<w:t xml:space="preserve">${t}</w:t>`;
    }
  }
  return out;
}

// PAGE / NUMPAGES as a complex field; "1" is only the cached result.
function fieldXml(pre, instr) {
  const r = (inner) => `<w:r>${pre}${inner}</w:r>`;
  return r('<w:fldChar w:fldCharType="begin"/>') +
    r(`<w:instrText xml:space="preserve"> ${instr} </w:instrText>`) +
    r('<w:fldChar w:fldCharType="separate"/>') +
    r("<w:t>1</w:t>") +
    r('<w:fldChar w:fldCharType="end"/>');
}

function runXml(S, ctx, r, linked, styleBold) {
  const props = runProps(S, r, { linked, styleBold });
  const pre = props ? `<w:rPr>${props}</w:rPr>` : "";
  if (r.break) return `<w:r>${pre}<w:br/></w:r>`;
  if (r.tab) return `<w:r>${pre}<w:tab/></w:r>`;
  const text = r.text == null ? "" : String(r.text);
  if (!text) return "";
  if (!ctx.fields || !/\{[nt]\}/.test(text)) {
    const body = textXml(text);
    return body ? `<w:r>${pre}${body}</w:r>` : "";
  }
  let out = "";
  for (const piece of text.split(/(\{[nt]\})/)) {
    if (piece === "{n}") out += fieldXml(pre, "PAGE");
    else if (piece === "{t}") out += fieldXml(pre, "NUMPAGES");
    else if (piece) {
      const body = textXml(piece);
      if (body) out += `<w:r>${pre}${body}</w:r>`;
    }
  }
  return out;
}

function runsXml(S, ctx, runs, styleBold) {
  let out = "";
  let i = 0;
  while (i < runs.length) {
    const link = runs[i].link ? safeLink(runs[i].link) : null;
    if (!link) {
      out += runXml(S, ctx, runs[i], false, styleBold);
      i++;
      continue;
    }
    let j = i, inner = "";
    while (j < runs.length && runs[j].link === runs[i].link) inner += runXml(S, ctx, runs[j++], true, styleBold);
    if (inner) {
      const target = link.anchor
        ? `w:anchor="${esc(link.anchor)}"`
        : `r:id="${ctx.part.rel("hyperlink", link.url, true)}"`;
      out += `<w:hyperlink ${target} w:history="1">${inner}</w:hyperlink>`;
    }
    i = j;
  }
  return out;
}

/* ------------------------------- Paragraphs ------------------------------ */
// A paragraph is kept in pieces until the end, so a section break can
// still slip its sectPr into the pPr of the paragraph that closes it.
function pEl(pPr, mark, body) {
  return { kind: "p", pPr: pPr || "", mark: mark || "", sect: "", body: body || "" };
}

function elXml(el) {
  if (el.kind !== "p") return el.xml;
  const props = el.pPr + (el.mark ? `<w:rPr>${el.mark}</w:rPr>` : "") + el.sect;
  return "<w:p>" + (props ? `<w:pPr>${props}</w:pPr>` : "") + el.body + "</w:p>";
}

const JC = { center: "center", right: "right", justify: "both" };

function spacingXml(st, extra) {
  const a = [];
  const before = num(st.spaceBefore), after = num(st.spaceAfter), lh = num(st.lineHeight);
  if (before != null) a.push(`w:before="${twips(clamp(before, 0, 1584))}"`);
  if (after != null) a.push(`w:after="${twips(clamp(after, 0, 1584))}"`);
  if (extra) a.push(extra);
  else if (lh > 0) {
    // a multiple of the font size, as Word's "multiple" spacing; a value
    // that can only be points becomes an at-least line height
    if (lh <= 6) a.push(`w:line="${Math.round(clamp(lh, 0.5, 6) * 240)}" w:lineRule="auto"`);
    else a.push(`w:line="${twips(clamp(lh, 1, 1584))}" w:lineRule="atLeast"`);
  }
  return a.length ? `<w:spacing ${a.join(" ")}/>` : "";
}

function indXml(st, list, width) {
  const left = num(st.indent), right = num(st.indentRight), first = num(st.firstLine);
  const a = [];
  if (list) {
    // the numbering level carries the usual hanging indent; only a source
    // indent overrides it (text at `indent`, marker in the hang)
    if (left > 0) {
      const l = clamp(left, 0, width);
      const hang = first != null && first < 0 ? Math.min(-first, l) : Math.min(18, l);
      a.push(`w:left="${twips(l)}"`, `w:hanging="${twips(hang)}"`);
    }
  } else {
    if (left != null && left !== 0) a.push(`w:left="${twips(clamp(left, -width, width))}"`);
    if (first != null && first > 0) a.push(`w:firstLine="${twips(clamp(first, 0, width))}"`);
    else if (first != null && first < 0) a.push(`w:hanging="${twips(clamp(-first, 0, width))}"`);
  }
  if (right != null && right !== 0) a.push(`w:right="${twips(clamp(right, -width, width))}"`);
  return a.length ? `<w:ind ${a.join(" ")}/>` : "";
}

// CT_PPrBase order: pStyle, keepNext, pageBreakBefore, numPr, pBdr, shd,
// spacing, ind, jc — then rPr (paragraph mark) and sectPr.
function paragraphEl(S, ctx, b) {
  const st = b.style && typeof b.style === "object" ? b.style : {};
  const runs = (Array.isArray(b.runs) ? b.runs : []).filter((r) => r && typeof r === "object");
  const heading = num(st.heading) >= 1 ? int(st.heading, 1, 6, 1) : 0;
  const list = st.list && typeof st.list === "object" ? st.list : null;
  const p = [];
  if (heading) p.push(`<w:pStyle w:val="Heading${heading}"/>`);
  else if (list) p.push('<w:pStyle w:val="ListParagraph"/>');
  else if (ctx.hf) p.push(`<w:pStyle w:val="${ctx.hf}"/>`);
  if (st.keepWithNext) p.push("<w:keepNext/>");
  if (st.pageBreakBefore && !ctx.hf) p.push("<w:pageBreakBefore/>");
  if (list) p.push(`<w:numPr><w:ilvl w:val="${int(list.level, 0, 8, 0)}"/><w:numId w:val="${listNumId(S, ctx, list)}"/></w:numPr>`);
  else ctx.list = null;
  const bb = st.borderBottom;
  if (bb && typeof bb === "object" && !(num(bb.width) <= 0)) {
    const sz = clamp(Math.round((num(bb.width) || 0.75) * 8), 2, 96);
    p.push(`<w:pBdr><w:bottom w:val="single" w:sz="${sz}" w:space="1" w:color="${hex(bb.color) || "auto"}"/></w:pBdr>`);
  }
  const shade = hex(st.shading);
  if (shade) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`);
  p.push(spacingXml(st));
  p.push(indXml(st, list, ctx.width));
  if (JC[st.align]) p.push(`<w:jc w:val="${JC[st.align]}"/>`);
  // the paragraph mark (and so a list marker) takes the first run's look
  const first = runs.find((r) => !r.break && !r.tab && r.text);
  const mark = first ? runProps(S, first, { mark: true }) : "";
  return pEl(p.join(""), mark, runsXml(S, ctx, runs, heading > 0));
}

function textParagraph(text, props) {
  return pEl("", "", `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${textXml(text)}</w:r>`);
}

/* --------------------------------- Images -------------------------------- */
function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (typeof data === "string" && /^data:[^,]*;base64,/.test(data) && typeof atob === "function") {
    const bin = atob(data.slice(data.indexOf(",") + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return null;
}

// Pixel size from the file header, for blocks that lost their size.
function pixelSize(b, mime) {
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  try {
    if (mime === "image/png" && b.length > 24) return { w: u32(16), h: u32(20) };
    if (mime === "image/gif" && b.length > 10) return { w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
    if (mime === "image/bmp" && b.length > 26) {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
        const len = (b[i + 2] << 8) | b[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
        }
        i += 2 + len;
      }
    }
  } catch (e) { /* truncated header */ }
  return null;
}

function imageEl(S, ctx, b) {
  const bytes = toBytes(b.data);
  const mime = bytes && bytes.length > 8 ? sniffImageMime(bytes) : null;
  const ext = IMAGE_EXT[mime];
  const jc = JC[b.align] ? `<w:jc w:val="${JC[b.align]}"/>` : "";
  if (!ext) return textParagraph("[görsel]", '<w:i/><w:iCs/><w:color w:val="808080"/>');
  let w = num(b.width), h = num(b.height);
  if (!(w > 0 && h > 0)) {
    const px = pixelSize(bytes, mime);
    if (px && px.w > 0 && px.h > 0) {
      if (w > 0) h = (w * px.h) / px.w;
      else if (h > 0) w = (h * px.w) / px.h;
      else { w = px.w * 0.75; h = px.h * 0.75; }   // 96 dpi, as Word assumes
    } else {
      w = w > 0 ? w : 144;
      h = h > 0 ? h : w;
    }
  }
  const k = Math.min(1, ctx.width / w, ctx.height / h);
  w = Math.max(1, w * k);
  h = Math.max(1, h * k);

  // the same bytes (a logo in the header and the body) are stored once
  let file = S.mediaIndex.get(bytes);
  if (!file) {
    file = `image${S.media.length + 1}.${ext}`;
    S.media.push({ path: "word/media/" + file, data: bytes });
    S.mediaIndex.set(bytes, file);
    S.exts.add(ext);
  }
  const rid = ctx.part.rel("image", "media/" + file);
  const id = ++S.drawingId;   // docPr ids are unique across the package
  const cx = emu(w), cy = emu(h);
  const descr = b.alt ? ` descr="${esc(b.alt)}"` : "";
  const drawing =
    '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Resim ${id}"${descr}/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}">` +
    `<pic:pic xmlns:pic="${NS_PIC}"><pic:nvPicPr><pic:cNvPr id="${id}" name="${file}"${descr}/>` +
    '<pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr></pic:nvPicPr>' +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    "</a:graphicData></a:graphic></wp:inline></w:drawing>";
  ctx.list = null;
  // single line spacing: a "multiple" would stretch the line the picture sits on
  return pEl('<w:spacing w:line="240" w:lineRule="auto"/>' + jc, "", `<w:r>${drawing}</w:r>`);
}

/* --------------------------------- Tables -------------------------------- */
const CELL_PAD_X = 4, CELL_PAD_Y = 2;   // points; layout.js pads cells 4pt
const VALIGN = { top: "top", middle: "center", bottom: "bottom" };

// Lay the cells on a grid: rowspans from rows above take their columns
// first, colspans never run into them, short rows are padded later.
function placeCells(rows) {
  const occ = rows.map(() => []);
  let nCols = 0;
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of row.cells) {
      if (!cell || typeof cell !== "object") continue;
      while (occ[r][c]) c++;
      if (c >= 63) break;   // Word's column limit
      let span = 1;
      const want = int(cell.colspan, 1, 63, 1);
      while (span < want && c + span < 63 && !occ[r][c + span]) span++;
      const rowspan = int(cell.rowspan, 1, rows.length - r, 1);
      const pl = { cell, col: c, span, rowspan };
      for (let rr = r; rr < r + rowspan; rr++) {
        for (let cc = c; cc < c + span; cc++) occ[rr][cc] = rr === r ? pl : { cont: pl };
      }
      c += span;
      nCols = Math.max(nCols, c);
    }
    nCols = Math.max(nCols, occ[r].length);
  });
  return { occ, nCols };
}

function columnWidths(t, nCols, width) {
  const given = Array.isArray(t.colWidths) ? t.colWidths.slice(0, nCols).map(num) : [];
  const known = given.filter((w) => w > 0);
  let widths;
  if (!known.length) widths = new Array(nCols).fill(width / nCols);
  else {
    const avg = sum(known) / known.length;
    widths = Array.from({ length: nCols }, (_, i) => (given[i] > 0 ? given[i] : avg));
  }
  const total = sum(widths);
  if (total > width) widths = widths.map((w) => (w * width) / total);
  return widths.map((w) => twips(Math.max(w, 12)));
}

function borderAttrs(border) {
  if (!border) return 'w:val="nil"';
  const w = num(border.width);
  if (w != null && w <= 0) return 'w:val="nil"';
  const sz = clamp(Math.round((w || 0.5) * 8), 2, 96);
  return `w:val="single" w:sz="${sz}" w:space="0" w:color="${hex(border.color) || "000000"}"`;
}

function cellXml(S, ctx, pl, cont, tw) {
  const width = sum(tw.slice(pl.col, pl.col + pl.span));
  const cell = pl.cell;
  // CT_TcPrBase order: tcW, gridSpan, vMerge, shd, vAlign
  let pr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
  if (pl.span > 1) pr += `<w:gridSpan w:val="${pl.span}"/>`;
  if (pl.rowspan > 1) pr += cont ? "<w:vMerge/>" : '<w:vMerge w:val="restart"/>';
  const fill = hex(cell.shading);
  if (fill) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
  if (VALIGN[cell.valign]) pr += `<w:vAlign w:val="${VALIGN[cell.valign]}"/>`;
  let body = "";
  if (!cont) {
    const inner = { ...ctx, width: Math.max(12, width / 20 - 2 * CELL_PAD_X), inCell: true, list: null };
    const els = blockEls(S, inner, Array.isArray(cell.blocks) ? cell.blocks : []);
    body = els.map(elXml).join("");
    // a cell must end with a paragraph — Word repairs the file otherwise
    if (!els.length || els[els.length - 1].kind !== "p") body += "<w:p/>";
  } else body = "<w:p/>";
  return `<w:tc><w:tcPr>${pr}</w:tcPr>${body}</w:tc>`;
}

function tableEl(S, ctx, t) {
  const rows = (Array.isArray(t.rows) ? t.rows : []).filter((r) => r && Array.isArray(r.cells) && r.cells.length);
  if (!rows.length) return null;
  ctx.list = null;
  const { occ, nCols } = placeCells(rows);
  if (!nCols) return null;
  const tw = columnWidths(t, nCols, ctx.width);
  const border = t.border === null ? null : t.border && typeof t.border === "object" ? t.border : { width: 0.5, color: "#000000" };
  const line = borderAttrs(border);
  const sides = ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} ${line}/>`).join("");
  // CT_TblPrBase order: tblStyle, tblW, tblBorders, tblLayout, tblCellMar
  const tblPr = "<w:tblPr>" +
    `<w:tblStyle w:val="${border ? "TableGrid" : "TableNormal"}"/>` +
    `<w:tblW w:w="${sum(tw)}" w:type="dxa"/>` +
    `<w:tblBorders>${sides}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/>' +
    `<w:tblCellMar><w:top w:w="${twips(CELL_PAD_Y)}" w:type="dxa"/><w:left w:w="${twips(CELL_PAD_X)}" w:type="dxa"/>` +
    `<w:bottom w:w="${twips(CELL_PAD_Y)}" w:type="dxa"/><w:right w:w="${twips(CELL_PAD_X)}" w:type="dxa"/></w:tblCellMar>` +
    "</w:tblPr>";
  const grid = "<w:tblGrid>" + tw.map((w) => `<w:gridCol w:w="${w}"/>`).join("") + "</w:tblGrid>";

  const headerRows = int(t.headerRows, 0, rows.length, 0);
  let inHeader = true;   // only rows at the very top can repeat
  let body = "";
  rows.forEach((row, r) => {
    const isHeader = inHeader && (r < headerRows || row.header === true);
    inHeader = isHeader;
    let trPr = "";
    const h = num(row.height);
    if (h > 0) trPr += `<w:trHeight w:val="${twips(Math.min(h, 1500))}" w:hRule="atLeast"/>`;
    if (isHeader) trPr += "<w:tblHeader/>";
    let cells = "";
    let c = 0;
    while (c < nCols) {
      const o = occ[r][c];
      if (o && o.cont) { cells += cellXml(S, ctx, o.cont, true, tw); c += o.cont.span; }
      else if (o) { cells += cellXml(S, ctx, o, false, tw); c += o.span; }
      else {
        // pad a short row with one empty cell up to the next column in use
        let e = c;
        while (e < nCols && !occ[r][e]) e++;
        cells += cellXml(S, ctx, { cell: {}, col: c, span: e - c, rowspan: 1 }, false, tw);
        c = e;
      }
    }
    body += "<w:tr>" + (trPr ? `<w:trPr>${trPr}</w:trPr>` : "") + cells + "</w:tr>";
  });
  return { kind: "tbl", xml: "<w:tbl>" + tblPr + grid + body + "</w:tbl>" };
}

/* --------------------------------- Blocks -------------------------------- */
function blockEl(S, ctx, b) {
  if (!b || typeof b !== "object") return null;
  try {
    switch (b.type) {
      case "paragraph": return paragraphEl(S, ctx, b);
      case "image": return imageEl(S, ctx, b);
      case "table": return tableEl(S, ctx, b);
      default: return null;   // page / section breaks are the body's business
    }
  } catch (err) {
    if (S.strict) throw err;
    return null;   // one odd block must not cost the whole document
  }
}

function blockEls(S, ctx, blocks) {
  const out = [];
  for (const b of blocks) {
    if (b && (b.type === "pagebreak" || b.type === "section")) { ctx.list = null; continue; }
    const el = blockEl(S, ctx, b);
    if (el) out.push(el);
  }
  return out;
}

function asBlocks(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return [{ type: "paragraph", runs: [{ text: v }], style: {} }];
  return [];
}

/* ----------------------------- Header / footer --------------------------- */
function headerFooter(S, kind, blocks, page) {
  const part = new Part();
  const ctx = { part, width: frameWidth(page), height: frameHeight(page) / 2, fields: true, hf: kind === "hdr" ? "Header" : "Footer", list: null };
  const els = blockEls(S, ctx, blocks);
  let body = els.map(elXml).join("");
  if (!els.length || els[els.length - 1].kind !== "p") body += "<w:p/>";
  return { xml: XML_HEAD + `<w:${kind} ${ROOT_NS}>${body}</w:${kind}>`, part };
}

/* ---------------------------------- Parts -------------------------------- */
function stylesXml(lang, first) {
  const center = twips(frameWidth(first) / 2), right = twips(frameWidth(first));
  const heading = (n, size, before, after, italic) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/>` +
    `<w:next w:val="Normal"/><w:uiPriority w:val="9"/>${n > 1 ? "<w:unhideWhenUsed/>" : ""}<w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/>${italic ? "<w:i/><w:iCs/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  const hf = (id, name) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>` +
    `<w:pPr><w:tabs><w:tab w:val="center" w:pos="${center}"/><w:tab w:val="right" w:pos="${right}"/></w:tabs></w:pPr></w:style>`;
  const single = 'w:val="single" w:sz="4" w:space="0" w:color="auto"';
  const f = DEFAULT_FONT;
  return XML_HEAD + `<w:styles xmlns:w="${NS_W}">` +
    "<w:docDefaults><w:rPrDefault><w:rPr>" +
    `<w:rFonts w:ascii="${f}" w:eastAsia="${f}" w:hAnsi="${f}" w:cs="${f}"/><w:sz w:val="22"/><w:szCs w:val="22"/>` +
    `<w:lang w:val="${lang}" w:eastAsia="en-US" w:bidi="ar-SA"/>` +
    "</w:rPr></w:rPrDefault>" +
    // no space after and 1.15 lines: the model's own defaults (layout.js)
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading(1, 40, 360, 120) + heading(2, 32, 240, 80) + heading(3, 28, 200, 80) +
    heading(4, 24, 160, 40) + heading(5, 22, 120, 40) + heading(6, 22, 120, 40, true) +
    '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/>' +
    '<w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>' +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/>' +
    '<w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/>' +
    '<w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/>' +
    "<w:semiHidden/><w:unhideWhenUsed/></w:style>" +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>' +
    '<w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>' +
    hf("Header", "header") + hf("Footer", "footer") +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/>' +
    '<w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>' +
    `<w:tblPr><w:tblBorders><w:top ${single}/><w:left ${single}/><w:bottom ${single}/><w:right ${single}/>` +
    `<w:insideH ${single}/><w:insideV ${single}/></w:tblBorders></w:tblPr></w:style>` +
    "</w:styles>";
}

// CT_Settings order: zoom, defaultTabStop, characterSpacingControl,
// compat, themeFontLang, decimalSymbol, listSeparator.
function settingsXml(lang) {
  const comma = /^(tr|de|fr|es|it|pt|nl|ru|pl|cs|da|fi|nb|sv|el|hu|ro|uk|az)\b/i.test(lang);
  return XML_HEAD + `<w:settings xmlns:w="${NS_W}">` +
    '<w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>' +
    // lines that end in a manual break are not stretched in justified text
    "<w:compat><w:doNotExpandShiftReturn/>" +
    '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    `<w:themeFontLang w:val="${lang}"/>` +
    `<w:decimalSymbol w:val="${comma ? "," : "."}"/><w:listSeparator w:val="${comma ? ";" : ","}"/>` +
    "</w:settings>";
}

function fontTableXml(fonts) {
  return XML_HEAD + `<w:fonts xmlns:w="${NS_W}" xmlns:r="${NS_R}">` +
    Array.from(fonts).map((name) => {
      const c = fontClass(name);
      return `<w:font w:name="${esc(name)}">${c.charset ? `<w:charset w:val="${c.charset}"/>` : ""}` +
        `<w:family w:val="${c.family}"/><w:pitch w:val="${c.pitch}"/></w:font>`;
    }).join("") + "</w:fonts>";
}

function coreXml(meta, opts) {
  const d = opts.date instanceof Date && !isNaN(opts.date) ? opts.date : new Date();
  const when = d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const title = meta.title || opts.title || "";
  const author = meta.author || opts.author || "";
  const tag = (t, v) => (v ? `<${t}>${esc(v)}</${t}>` : "");
  return XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    tag("dc:title", title) + tag("dc:subject", meta.subject) + tag("dc:creator", author) +
    tag("cp:lastModifiedBy", author) + "<cp:revision>1</cp:revision>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${when}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${when}</dcterms:modified>` +
    "</cp:coreProperties>";
}

function appXml() {
  return XML_HEAD +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    "<Application>Mühür PDF</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>" +
    "<LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged>" +
    "</Properties>";
}

function contentTypesXml(S, hasHeader, hasFooter) {
  const exts = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg" };
  if (S.exts.has("gif")) exts.gif = "image/gif";
  if (S.exts.has("bmp")) exts.bmp = "image/bmp";
  const over = (part, type) => `<Override PartName="${part}" ContentType="${type}"/>`;
  return XML_HEAD + `<Types xmlns="${NS_CT}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    Object.entries(exts).map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join("") +
    over("/word/document.xml", CT.main) + over("/word/styles.xml", CT.styles) +
    over("/word/numbering.xml", CT.numbering) + over("/word/settings.xml", CT.settings) +
    over("/word/fontTable.xml", CT.fontTable) +
    (hasHeader ? over("/word/header1.xml", CT.header) : "") +
    (hasFooter ? over("/word/footer1.xml", CT.footer) : "") +
    over("/docProps/core.xml", CT.core) + over("/docProps/app.xml", CT.app) +
    "</Types>";
}

function rootRelsXml() {
  return XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_PKG_REL}/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId3" Type="${REL}extended-properties" Target="docProps/app.xml"/>` +
    "</Relationships>";
}

/* ---------------------------------- Body --------------------------------- */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function pageBreakEl() {
  return pEl("", "", '<w:r><w:br w:type="page"/></w:r>');
}

// The page setup the document opens with: leading section blocks set it
// instead of producing an empty first section.
function firstSetup(flow) {
  let page = normPage(flow.page);
  for (const b of flow.blocks) {
    if (b && b.type === "section") page = normPage(b.page);
    else if (b && b.type !== "pagebreak") break;
  }
  return page;
}

async function bodyXml(S, flow, part, refs, onProgress) {
  const blocks = flow.blocks;
  const total = blocks.length;
  const els = [];
  let page = firstSetup(flow);
  const ctx = { part, width: frameWidth(page), height: frameHeight(page), fields: false, hf: null, list: null };
  // is there real content after index i before the next section / end?
  const contentFollows = (i) => {
    for (let j = i + 1; j < total; j++) {
      const b = blocks[j];
      if (!b || typeof b !== "object") continue;
      if (b.type === "section") return false;
      if (b.type === "paragraph" || b.type === "image" || b.type === "table" || b.type === "pagebreak") return true;
    }
    return false;
  };
  for (let i = 0; i < total; i++) {
    const b = blocks[i];
    if (b && b.type === "section") {
      ctx.list = null;
      if (els.length) {
        // close the running section in its last paragraph, or in an empty
        // one when it ends with a table
        const last = els[els.length - 1];
        const sect = sectPrXml(page, refs);
        if (last.kind === "p" && !last.sect) last.sect = sect;
        else els.push({ ...pEl("", "", ""), sect });
        page = normPage(b.page);
      }
      ctx.width = frameWidth(page);
      ctx.height = frameHeight(page);
    } else if (b && b.type === "pagebreak") {
      ctx.list = null;
      // a break with nothing after it would only add a blank page
      if (els.length && contentFollows(i)) els.push(pageBreakEl());
    } else {
      const el = blockEl(S, ctx, b);
      if (el) els.push(el);
    }
    if (onProgress && (i % 50 === 49 || i === total - 1)) onProgress(i + 1, total, PROGRESS_LABEL);
    if (i % 400 === 399) await tick();
  }
  if (!els.length) els.push(pEl("", "", ""));
  // Word keeps a paragraph after a closing table; give it one up front
  if (els[els.length - 1].kind !== "p") els.push(pEl("", "", ""));
  return els.map(elXml).join("") + sectPrXml(page, refs);
}

/* ---------------------------------- API ---------------------------------- */
export async function flowToDocx(flow, opts = {}) {
  if (!flow || typeof flow !== "object" || !Array.isArray(flow.blocks)) {
    throw new Error("Word'e dönüştürülecek belge geçersiz.");
  }
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const lang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(opts.lang || "")) ? opts.lang : "tr-TR";
  const meta = flow.meta && typeof flow.meta === "object" ? flow.meta : {};
  const S = {
    media: [], mediaIndex: new Map(), exts: new Set(),
    drawingId: 0, lists: [], fonts: new Set([DEFAULT_FONT]), strict: !!opts.strict,
  };
  if (onProgress) onProgress(0, flow.blocks.length, PROGRESS_LABEL);

  const doc = new Part();
  doc.rel("styles", "styles.xml");
  doc.rel("numbering", "numbering.xml");
  doc.rel("settings", "settings.xml");
  doc.rel("fontTable", "fontTable.xml");

  const first = firstSetup(flow);
  const headerBlocks = asBlocks(flow.header), footerBlocks = asBlocks(flow.footer);
  const header = headerBlocks.length ? headerFooter(S, "hdr", headerBlocks, first) : null;
  const footer = footerBlocks.length ? headerFooter(S, "ftr", footerBlocks, first) : null;
  let refs = "";
  if (header) refs += `<w:headerReference w:type="default" r:id="${doc.rel("header", "header1.xml")}"/>`;
  if (footer) refs += `<w:footerReference w:type="default" r:id="${doc.rel("footer", "footer1.xml")}"/>`;

  const body = await bodyXml(S, flow, doc, refs, onProgress);

  const files = {
    "[Content_Types].xml": contentTypesXml(S, !!header, !!footer),
    "_rels/.rels": rootRelsXml(),
    "docProps/core.xml": coreXml(meta, opts),
    "docProps/app.xml": appXml(),
    "word/document.xml": XML_HEAD + `<w:document ${ROOT_NS}><w:body>${body}</w:body></w:document>`,
    "word/styles.xml": stylesXml(lang, first),
    "word/numbering.xml": numberingXml(S),
    "word/settings.xml": settingsXml(lang),
    "word/fontTable.xml": fontTableXml(S.fonts),
    "word/_rels/document.xml.rels": doc.xml(),
  };
  if (header) {
    files["word/header1.xml"] = header.xml;
    if (header.part.rels.length) files["word/_rels/header1.xml.rels"] = header.part.xml();
  }
  if (footer) {
    files["word/footer1.xml"] = footer.xml;
    if (footer.part.rels.length) files["word/_rels/footer1.xml.rels"] = footer.part.xml();
  }
  for (const m of S.media) files[m.path] = m.data;
  return zip(files);
}
