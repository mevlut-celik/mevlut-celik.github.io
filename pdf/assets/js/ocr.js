/* ==========================================================================
   Mühür — ocr.js
   Scanned pages become searchable: each page is rendered, read by
   tesseract.js (LSTM, Turkish + English by default) and an INVISIBLE text
   layer (text render mode 3) is written into the original page — one run
   per word, placed on the word's baseline and squeezed with Tz so its
   advance matches the word's width on the image. The page looks exactly
   as before; text can now be selected, searched, copied and edited.

   Geometry: tesseract works in render pixels; pixels / (scale × UserUnit)
   are display points of the page as pdf.js renders it (its view box —
   the CropBox clipped to the MediaBox — with the page rotation applied);
   pdfwork.displayToPdf takes those to PDF user space. Every line keeps
   its own baseline slope, so slightly skewed scans still select along the
   printed line; vertical lines (margin notes) run up or down the page.
   The font size comes from the words' ink measured against the bundled
   font's glyphs, so replacement text matches the scan.

   The layer is wrapped in a /MuhurOCR marked-content block. Running OCR
   again on a page replaces that block instead of stacking a second copy,
   and words that land on text the page already carries are not written.
   ========================================================================== */

import { pdfjs, pdflib, openPdf, closePdf, tesseract, tesseractPaths, fontBytes } from "./libs.js";
import { renderPage, canvasToBytes } from "./convert/canvas.js";
import { displayToPdf } from "./pdfwork.js";

const FONT_FILE = "LiberationSans-Regular.ttf";
const MAX_PIXELS = 12e6;          // ~ A4 at 300 dpi is 8.7 MP
const TEXT_THRESHOLD = 20;        // fewer non-space characters than this = "no text"
const OCR_TAG = "MuhurOCR";       // marked-content tag of Mühür's text layer

export const LANGS = {
  "tur+eng": "Türkçe + İngilizce",
  tur: "Türkçe",
  eng: "İngilizce",
};

function abortError() {
  const err = new Error("OCR iptal edildi.");
  err.name = "AbortError";
  return err;
}

// `promise`, or a rejection as soon as `signal` aborts — `onAbort` runs
// first, to stop the work that would otherwise carry on in the worker.
function abortable(promise, signal, onAbort) {
  if (!signal) return promise;
  if (signal.aborted) { onAbort(); return Promise.reject(abortError()); }
  return new Promise((resolve, reject) => {
    const stop = () => { onAbort(); reject(abortError()); };
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", stop); resolve(v); },
      (e) => { signal.removeEventListener("abort", stop); reject(e); });
  });
}

/* --------------------------------- Worker -------------------------------- */
// tesseract.js 7 rejects createWorker only when its first step fails. A
// language file that cannot be fetched (offline on first use, a 404, a
// dropped download) or an initialisation error goes to errorHandler and
// the promise never settles — and no worker handle ever comes back to
// terminate. So the Web Worker is caught as it is constructed (spawning
// runs synchronously inside createWorker, before its first await) and
// creation races a failure promise fed by errorHandler and the signal.
function spawnWorker(T, langs, options) {
  const Native = globalThis.Worker;
  let raw = null;
  if (typeof Native === "function") {
    globalThis.Worker = function (...args) { raw = new Native(...args); return raw; };
  }
  try {
    const pending = T.createWorker(langs, 1, options);
    return { pending, raw };
  } finally {
    if (typeof Native === "function") globalThis.Worker = Native;
  }
}

const asError = (e) => (e instanceof Error ? e : new Error(String(e)));

// One tesseract worker, reused for every page of a run.
export async function createOcr({ langs = "tur+eng", onProgress, signal } = {}) {
  const T = await tesseract();
  if (signal && signal.aborted) throw abortError();
  let current = null;
  let starting = true;
  let fail;
  const failed = new Promise((_, reject) => { fail = reject; });
  failed.catch(() => null);
  const { pending, raw } = spawnWorker(T, langs, {
    ...tesseractPaths(),
    logger: (m) => {
      if (!onProgress) return;
      if (m.status === "recognizing text") onProgress(m.progress || 0, "Metin tanınıyor");
      else if (/loading|initializ/i.test(m.status || "")) onProgress(0, "OCR motoru hazırlanıyor");
    },
    errorHandler: (err) => {
      if (starting) fail(new Error("OCR motoru başlatılamadı (dil verisi indirilemedi ya da bozuk): " + err));
      else current = err;
    },
  });
  // The Web Worker is stopped directly, never through tesseract's own
  // terminate(): that one drops its reference, and a page cancelled while
  // its image is still being loaded then posts to null — an uncaught
  // rejection inside tesseract.js (fatal in Node). Posting to a stopped
  // worker does nothing. Node has no global Worker to catch, so there the
  // worker comes from the handle (`.worker`) once creation has resolved.
  let worker = null;
  let dead = false;
  const stop = (w) => { if (w.worker) w.worker.terminate(); else w.terminate(); };
  const kill = () => {
    dead = true;
    if (raw) raw.terminate();
    else if (worker) stop(worker);
    else pending.then(stop, () => null);
  };
  try {
    worker = await abortable(Promise.race([pending, failed]), signal, kill);
    // tesseract.js defaults to one uniform block (PSM 6); automatic layout
    // analysis (3) is what finds columns, captions and table rows
    await abortable(Promise.race([worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1" }), failed]), signal, kill);
  } catch (err) {
    kill();
    throw asError(err);
  } finally {
    starting = false;
  }
  return {
    async recognize(image, width, height) {
      // a stopped worker never answers: fail instead of waiting forever
      if (dead) throw signal && signal.aborted ? abortError() : new Error("OCR motoru kapatıldı.");
      current = null;
      const { data } = await abortable(worker.recognize(image, {}, { text: true, blocks: true }), signal, kill);
      if (current) throw asError(current);
      return toOcrPage(data, width, height);
    },
    terminate: async () => kill(),
  };
}

// tesseract's block tree -> the flat OcrPage the rest of the app uses.
function toOcrPage(data, width, height) {
  const words = [];
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const ids = [];
        for (const w of line.words || []) {
          const text = String(w.text || "").trim();
          if (!text) continue;
          ids.push(words.length);
          words.push({ text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, confidence: w.confidence, line: lines.length });
        }
        if (!ids.length) continue;
        const b = line.baseline;
        const box = line.bbox;
        const row = line.rowAttributes || {};
        const descent = row.descenders || 0;
        const vertical = lineDirection(b, box, ids.map((i) => words[i]));
        const hasBase = !vertical && b && b.has_baseline !== false && b.x1 > b.x0;
        lines.push({
          text: ids.map((i) => words[i].text).join(" "),
          x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1,
          baseline: hasBase ? [b.x0, b.y0, b.x1, b.y1] : null,
          vertical,
          // a vertical line's baseline is a column: glyph tops face left
          // when it runs up the page, right when it runs down
          baseX: !vertical ? null
            : b && b.has_baseline !== false && b.x0 >= box.x0 && b.x0 <= box.x1 ? (b.x0 + b.x1) / 2
            : vertical < 0 ? box.x1 - descent : box.x0 + descent,
          descent,
          rowHeight: row.rowHeight > 0 ? row.rowHeight : 0,
          words: ids,
        });
      }
    }
  }
  return { width, height, words, lines, text: lines.map((l) => l.text).join("\n") };
}

// Which way a line runs: 0 across the page, -1 up it (bottom to top, the
// way vertical e-signature notes sit in the margin of official letters),
// 1 down it. tesseract hands vertical lines a baseline with x0 == x1 (or
// one pixel apart), which reads as a near-infinite slope.
function lineDirection(b, box, words) {
  if (b && b.has_baseline !== false && (b.x0 !== b.x1 || b.y0 !== b.y1)) {
    if (Math.abs(b.y1 - b.y0) <= Math.abs(b.x1 - b.x0)) return 0;
    return b.y1 < b.y0 ? -1 : 1;
  }
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  if (bh <= 2 * bw) return 0;
  if (words.length > 1) {
    const a = words[0], z = words[words.length - 1];
    return a.y0 + a.y1 > z.y0 + z.y1 ? -1 : 1;
  }
  return [...words[0].text].length >= 3 ? -1 : 0; // one tall glyph is not a vertical line
}

/* ------------------------------ Preprocessing ---------------------------- */
// Ruled tables defeat tesseract's layout analysis: cells boxed by lines
// are taken for pictures and never read. The copy we hand to the OCR
// engine has its table rules painted white first (the PDF keeps the
// original image). A rule is a long run of dark pixels that is also
// THIN across (about 1 mm at most) with paper on both sides: the bar of
// a large heading letter is long but thick, and the edge of a dark
// header band is thin but has the band (dark) behind it. Runs that are
// mostly such "solid" pixels are left alone, which also spares the
// curve tips of big letters. One byte per pixel holds every mark.
const INK = 1, H_RUN = 2, V_RUN = 4, H_SOLID = 8, V_SOLID = 16, CLEAR = 32;
const LONG = H_RUN | V_RUN;

// Lines of a w×h mask: along the rows (dir 0) or down the columns (dir 1).
function axis(w, h, dir) {
  return dir === 0 ? { lines: h, len: w, line: w, step: 1 } : { lines: w, len: h, line: 1, step: w };
}

// Calls fn(offset, start, end) for every run of pixels carrying `bit`
// along each line of axis `a`.
function eachRun(m, a, bit, fn) {
  for (let l = 0; l < a.lines; l++) {
    const o = l * a.line;
    let k = 0;
    while (k < a.len) {
      if (!(m[o + k * a.step] & bit)) { k++; continue; }
      const s = k;
      while (k < a.len && m[o + k * a.step] & bit) k++;
      fn(o, s, k);
    }
  }
}

export function removeRules(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lum = (p) => (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  const DARK = 160;   // a pixel that can start or continue a rule
  const SOFT = 215;   // anti-aliased edge pixels cleared along with it
  const minH = Math.max(60, Math.round(w * 0.05));
  const minV = Math.max(60, Math.round(h * 0.06));
  const maxT = Math.max(3, Math.round(Math.min(w, h) * 0.005)); // ~1 mm on a page
  const GAP = 3;      // how far past a rule's edge to look for paper
  const SHARE = 0.25; // a run with more solid pixels than this is not a rule
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < m.length; i++, p += 4) if (lum(p) < DARK) m[i] = INK;
  const rows = axis(w, h, 0), cols = axis(w, h, 1);
  const mark = (bit) => (o, s, e, a) => { for (let k = s; k < e; k++) m[o + k * a.step] |= bit; };
  // 1. long dark runs
  const markLong = (a, min, bit) => { const f = mark(bit); eachRun(m, a, INK, (o, s, e) => { if (e - s >= min) f(o, s, e, a); }); };
  markLong(rows, minH, H_RUN);
  markLong(cols, minV, V_RUN);
  // 2. across each run: too thick, or ink right past it that is not
  //    another rule (a crossing or a double rule) -> part of a solid shape
  const markSolid = (a, bit, solid) => {
    const f = mark(solid);
    const paper = (o, k) => k < 0 || k >= a.len || (m[o + k * a.step] & (INK | LONG)) !== INK;
    eachRun(m, a, bit, (o, s, e) => {
      if (e - s > maxT || !paper(o, s - GAP) || !paper(o, e - 1 + GAP)) f(o, s, e, a);
    });
  };
  markSolid(cols, H_RUN, H_SOLID);
  markSolid(rows, V_RUN, V_SOLID);
  // 3. clear the thin pixels of runs that are (nearly) all rule
  const markClear = (a, bit, solid) => {
    eachRun(m, a, bit, (o, s, e) => {
      let n = 0;
      for (let k = s; k < e; k++) if (m[o + k * a.step] & solid) n++;
      if (n > SHARE * (e - s)) return;
      for (let k = s; k < e; k++) { const i = o + k * a.step; if (!(m[i] & solid)) m[i] |= CLEAR; }
    });
  };
  markClear(rows, H_RUN, H_SOLID);
  markClear(cols, V_RUN, V_SOLID);
  let removed = 0;
  for (let i = 0; i < m.length; i++) {
    if (!(m[i] & CLEAR)) continue;
    // widen by one pixel to take the soft edge of the rule as well
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const p = (yy * w + xx) * 4;
        if (lum(p) < SOFT) { d[p] = d[p + 1] = d[p + 2] = 255; removed++; }
      }
    }
  }
  if (removed) ctx.putImageData(img, 0, 0);
  return removed;
}

// Reversed text — white on a dark header bar or table head — is missed
// by tesseract's layout analysis: the bar reads as a picture. The OCR
// copy gets such bars inverted to dark text on a light ground. A bar is
// a wide, mostly solid dark region on a grid of ~1 mm cells, with light
// shapes inside it and full dark rows along its top and bottom edges
// (padding) — which a word of large bold letters, even touching ones,
// never has. -> number of bars inverted
export function invertBands(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const DARK = 160;
  const dark = (x, y) => { const p = (y * w + x) * 4; return (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8 < DARK; };
  const c = Math.max(4, Math.round(Math.min(w, h) * 0.005));
  const gw = Math.ceil(w / c), gh = Math.ceil(h / c);
  const ink = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = ((y / c) | 0) * gw;
    for (let x = 0; x < w; x++) if (dark(x, y)) ink[gy + ((x / c) | 0)]++;
  }
  const cellArea = (gx, gy) => (Math.min(w, (gx + 1) * c) - gx * c) * (Math.min(h, (gy + 1) * c) - gy * c);
  const solid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) solid[gy * gw + gx] = ink[gy * gw + gx] >= 0.75 * cellArea(gx, gy) ? 1 : 0;
  // fraction of dark pixels on row y (or column x) between a and b
  const rowInk = (y, a, b) => { let n = 0; for (let x = a; x < b; x++) if (dark(x, y)) n++; return n / Math.max(1, b - a); };
  const colInk = (x, a, b) => { let n = 0; for (let y = a; y < b; y++) if (dark(x, y)) n++; return n / Math.max(1, b - a); };
  const seen = new Uint8Array(gw * gh);
  const stack = [];
  let bands = 0;
  for (let start = 0; start < solid.length; start++) {
    if (!solid[start] || seen[start]) continue;
    // one 4-connected group of solid cells and its bounding box
    let n = 0, gx0 = gw, gy0 = gh, gx1 = -1, gy1 = -1;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const gx = i % gw, gy = (i / gw) | 0;
      n++;
      gx0 = Math.min(gx0, gx); gx1 = Math.max(gx1, gx); gy0 = Math.min(gy0, gy); gy1 = Math.max(gy1, gy);
      for (const j of [gx > 0 ? i - 1 : -1, gx < gw - 1 ? i + 1 : -1, gy > 0 ? i - gw : -1, gy < gh - 1 ? i + gw : -1]) {
        if (j >= 0 && solid[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    const bw = gx1 - gx0 + 1, bh = gy1 - gy0 + 1;
    if (bh < 2 || bw < 3 * bh || bw * c < w * 0.05) continue;     // a wide bar, not a glyph
    if (n < 0.5 * bw * bh || n > 0.97 * bw * bh) continue;        // mostly dark, with light inside
    // pixel edges: rows/columns at least half dark, searched a cell beyond the grid box
    const x0 = Math.max(0, (gx0 - 1) * c), x1 = Math.min(w, (gx1 + 2) * c);
    let top = Math.max(0, (gy0 - 1) * c), bottom = Math.min(h, (gy1 + 2) * c) - 1;
    while (top < bottom && rowInk(top, x0, x1) < 0.5) top++;
    while (bottom > top && rowInk(bottom, x0, x1) < 0.5) bottom--;
    let left = x0, right = x1 - 1;
    while (left < right && colInk(left, top, bottom + 1) < 0.5) left++;
    while (right > left && colInk(right, top, bottom + 1) < 0.5) right--;
    if (bottom - top < 2 * c) continue;
    // the padding: a full dark row near the top edge and near the bottom one
    const third = Math.max(1, ((bottom - top) / 3) | 0);
    let edgeTop = false, edgeBottom = false;
    for (let y = top; y < top + third && !edgeTop; y++) edgeTop = rowInk(y, left, right + 1) >= 0.9;
    for (let y = bottom; y > bottom - third && !edgeBottom; y--) edgeBottom = rowInk(y, left, right + 1) >= 0.9;
    if (!edgeTop || !edgeBottom) continue;
    for (let y = top; y <= bottom; y++) {
      for (let x = left, p = (y * w + left) * 4; x <= right; x++, p += 4) { d[p] = 255 - d[p]; d[p + 1] = 255 - d[p + 1]; d[p + 2] = 255 - d[p + 2]; }
    }
    bands++;
  }
  if (bands) ctx.putImageData(img, 0, 0);
  return bands;
}

/* ------------------------------ Page triage ------------------------------ */
// A page needs OCR when it carries (almost) no text but paints an image.
export async function pageNeedsOcr(pdf, pageIndex) {
  const lib = await pdfjs();
  const page = await pdf.getPage(pageIndex + 1);
  try {
    const tc = await page.getTextContent();
    let chars = 0;
    for (const it of tc.items) chars += it.str ? it.str.replace(/\s+/g, "").length : 0;
    if (chars >= TEXT_THRESHOLD) return false;
    const ops = await page.getOperatorList();
    const paint = new Set([lib.OPS.paintImageXObject, lib.OPS.paintInlineImageXObject, lib.OPS.paintImageMaskXObject, lib.OPS.paintImageXObjectRepeat, lib.OPS.paintJpegXObject].filter((v) => v != null));
    return ops.fnArray.some((f) => paint.has(f));
  } finally {
    page.cleanup();
  }
}

export async function scannedPages(pdf, limit) {
  const n = Math.min(pdf.numPages, limit || pdf.numPages);
  const out = [];
  for (let i = 0; i < n; i++) if (await pageNeedsOcr(pdf, i)) out.push(i);
  return out;
}

/* ----------------------------- Text geometry ----------------------------- */
function baselineAt(line, x) {
  if (!line.baseline) return line.y1 - (line.descent || (line.y1 - line.y0) * 0.2);
  const [x0, y0, x1, y1] = line.baseline;
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

function lineAngle(line) {
  if (!line.baseline) return 0;
  const [x0, y0, x1, y1] = line.baseline;
  const a = Math.atan2(y1 - y0, x1 - x0);
  return Math.abs(a) < 0.0035 ? 0 : a; // under 0.2° is noise
}

// Where a word starts on its line's baseline and how long it runs.
function wordSpan(line, w) {
  if (!line.vertical) return { x: w.x0, y: baselineAt(line, w.x0), len: w.x1 - w.x0 };
  return { x: line.baseX, y: line.vertical < 0 ? w.y1 : w.y0, len: w.y1 - w.y0 };
}

// Blank space between a word and the next one along the line.
function wordGap(line, w, next) {
  if (!line.vertical) return next.x0 - w.x1;
  return line.vertical < 0 ? w.y0 - next.y1 : next.y0 - w.y1;
}

// Lower median: of two disagreeing words, the smaller is the safer pick,
// since a word box only grows (a speck of dirt, an accent OCR dropped).
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[(s.length - 1) >> 1]; };

// Font size of a line in pixels, used as the invisible font size (and by
// the editor as the size of replacement text). Each word's ink is set
// against the ink the bundled font gives the same characters, and the
// median word wins, so lines without descenders or with only digits get
// the same size as any other. On a line with a baseline only the part
// above it is compared ("FATURA" and "2026" rise 0.69–0.70 em,
// "numarası" 0.54 em, "İzmir" 0.87 em), which keeps specks below the
// line and a comma read as a full stop out of it; the baseline is taken
// at the word's higher end, as a skewed word's box holds that rise too.
// Without a baseline (vertical lines) the whole ink height is used.
// Without usable words: tesseract's row height (ascender to descender,
// ~0.92 em), then the line's ink box.
const ROW_EM = 0.92;
function lineSize(line, words, inkOf) {
  const est = [];
  if (inkOf) {
    for (const i of line.words) {
      const w = words[i];
      const ink = inkOf(w.text);
      if (!ink) continue;
      if (line.baseline) {
        const rise = Math.min(baselineAt(line, w.x0), baselineAt(line, w.x1)) - w.y0;
        if (ink.top >= 0.3 && rise > 0) est.push(rise / ink.top); // not ".", "-" or "_"
      } else {
        const across = line.vertical ? w.x1 - w.x0 : w.y1 - w.y0;
        if (ink.top - ink.bottom >= 0.4 && across > 0) est.push(across / (ink.top - ink.bottom));
      }
    }
  }
  if (est.length) return Math.max(4, median(est));
  if (line.rowHeight > 0) return Math.max(4, line.rowHeight / ROW_EM);
  const rise = line.baseline ? Math.abs(line.baseline[3] - line.baseline[1]) : 0;
  return Math.max(4, ((line.vertical ? line.x1 - line.x0 : line.y1 - line.y0) - rise) / ROW_EM);
}

// Ink extent (em) of a string in a fontkit font: { top, bottom } of its
// tallest and deepest glyphs, relative to the baseline; null when no
// glyph has ink.
function inkMeter(fk, charset) {
  const cache = new Map();
  const glyph = (cp) => {
    if (!cache.has(cp)) {
      const bb = charset.has(cp) ? fk.glyphForCodePoint(cp).bbox : null;
      cache.set(cp, bb && bb.maxY > bb.minY ? [bb.maxY / fk.unitsPerEm, bb.minY / fk.unitsPerEm] : null);
    }
    return cache.get(cp);
  };
  return (text) => {
    let top = -Infinity, bottom = Infinity;
    for (const ch of text) {
      const g = glyph(ch.codePointAt(0));
      if (!g) continue;
      top = Math.max(top, g[0]);
      bottom = Math.min(bottom, g[1]);
    }
    return top > bottom ? { top, bottom } : null;
  };
}

// Runs and lines in display points, for pdf-analyze (scanned pages).
// The run model is horizontal only, so vertical lines are left out.
export function ocrPageToRuns(ocrPage, scale) {
  const runs = [];
  const lines = [];
  for (const line of ocrPage.lines) {
    if (line.vertical) continue;
    const size = lineSize(line, ocrPage.words) / scale;
    const lineRuns = line.words.map((i) => {
      const w = ocrPage.words[i];
      const run = {
        x: w.x0 / scale, y: w.y0 / scale, w: (w.x1 - w.x0) / scale, h: (w.y1 - w.y0) / scale,
        baseline: baselineAt(line, (w.x0 + w.x1) / 2) / scale,
        text: w.text, size, font: "sans", bold: false, italic: false, color: "#000000",
      };
      runs.push(run);
      return run;
    });
    lines.push({
      x: line.x0 / scale, y: line.y0 / scale, w: (line.x1 - line.x0) / scale, h: (line.y1 - line.y0) / scale,
      baseline: baselineAt(line, (line.x0 + line.x1) / 2) / scale, runs: lineRuns, text: line.text,
    });
  }
  return { runs, lines };
}

/* --------------------------- Text already there --------------------------- */
const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

// Text with no real Unicode behind it (a font without ToUnicode comes out
// as private-use or replacement characters) does not count as text.
const UNREADABLE = /[\uE000-\uF8FF\uFFFD\u0000-\u0008]/g;

// Letters and digits only, lower case, Turkish dotless i and diacritics
// folded: what OCR and the page's own text must share to be "the same".
const fold = (s) => s.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^\p{L}\p{N}]/gu, "");

// The page's own text (not Mühür's earlier OCR layer) in render pixels
// of `viewport`, so OCR does not write a second copy of it: a born-digital
// page forced through OCR, a stamp or page number printed on a scan, a
// text box added in the editor. Each item keeps its turned rectangle (a
// diagonal watermark is a band, not the page-sized box around it) and its
// folded words. -> { items, layer: whether Mühür's OCR layer is there }
async function pageText(pp, viewport) {
  const tc = await pp.getTextContent({ includeMarkedContent: true });
  const k = Math.hypot(viewport.transform[0], viewport.transform[1]);
  const items = [];
  const open = [];
  let layer = false;
  for (const it of tc.items) {
    if (it.type === "beginMarkedContent" || it.type === "beginMarkedContentProps") {
      open.push(it.tag === OCR_TAG);
      layer = layer || it.tag === OCR_TAG;
      continue;
    }
    if (it.type === "endMarkedContent") { open.pop(); continue; }
    if (open.includes(true) || !it.str) continue;
    const chars = it.str.replace(/\s+/g, "");
    if (!chars || (chars.match(UNREADABLE) || []).length * 2 > chars.length) continue;
    const t = multiply(viewport.transform, it.transform);
    const size = Math.hypot(t[2], t[3]);
    const along = Math.hypot(t[0], t[1]);
    if (!size || !along) continue;
    const words = it.str.split(/\s+/).map(fold).filter(Boolean);
    items.push({
      x: t[4], y: t[5],
      ux: t[0] / along, uy: t[1] / along,   // along the baseline
      vx: t[2] / size, vy: t[3] / size,     // towards the glyph tops
      len: it.width * k, size, words, key: words.join(""),
    });
  }
  return { items, layer };
}

// An OCR word is already on the page when its centre lies on a text item
// that says the same thing: one of its words, or — for words of four or
// more characters, which OCR may split or join differently — a stretch
// of its text. A different word under, say, a watermark is still written.
function covered(w, items) {
  const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
  const key = fold(w.text);
  for (const it of items) {
    const dx = cx - it.x, dy = cy - it.y;
    const s = dx * it.ux + dy * it.uy, v = dx * it.vx + dy * it.vy;
    if (s < 0 || s > it.len || v < -0.3 * it.size || v > it.size) continue;
    if (!key || it.words.includes(key) || (key.length >= 4 && it.key.includes(key))) return true;
  }
  return false;
}

/* ------------------------- Invisible text layer -------------------------- */
// Characters the bundled font cannot draw are swapped rather than dropped,
// so word lengths (and selection) stay sensible.
function drawable(text, charset) {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (charset.has(cp)) out += ch;
    else if (ch === "₺") out += charset.has(84) && charset.has(76) ? "TL" : "?";
    else out += charset.has(63) ? "?" : "";
  }
  return out;
}

const bytesToLatin1 = (b) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return s;
};
const latin1ToBytes = (s) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
};

// Mühür's earlier OCR layer comes off the page before a new one goes on,
// so running OCR again (say with another language) replaces the layer
// instead of stacking a second copy of every word. The block normally
// fills a content stream of its own, which is unlinked; if another tool
// merged the streams, only the block is cut out of the merged one. The
// page's Contents array is rebuilt rather than edited, in case another
// page shares it. -> whether a layer was removed
const OCR_BLOCK = new RegExp(`/${OCR_TAG}\\s+BMC\\b[\\s\\S]*?\\sEMC(?=\\s|$)`, "g");
function stripOcrLayer(doc, page) {
  const P = globalThis.PDFLib;
  page.node.normalize(); // Contents is an array from here on
  const contents = page.node.Contents();
  if (!(contents instanceof P.PDFArray)) return false;
  const kept = [];
  let changed = false;
  for (let i = 0; i < contents.size(); i++) {
    const entry = contents.get(i);
    const stream = doc.context.lookup(entry);
    let text = null;
    try {
      if (stream instanceof P.PDFRawStream) text = bytesToLatin1(P.decodePDFRawStream(stream).decode());
    } catch (e) { /* a filter pdf-lib cannot undo: leave the stream alone */ }
    const rest = text && text.includes("/" + OCR_TAG) ? text.replace(OCR_BLOCK, "") : text;
    if (rest === text) { kept.push(entry); continue; }
    changed = true;
    if (rest.trim()) kept.push(doc.context.register(doc.context.flateStream(latin1ToBytes(rest))));
  }
  if (changed) page.node.set(P.PDFName.of("Contents"), doc.context.obj(kept));
  return changed;
}

// opts: { scale (pixels per display point), box + rotation (the rendered
// view, see displayToPdf), font, charset, inkOf, taken (pageText items) }
// -> { written, covered }
function writeTextLayer(doc, page, ocrPage, { scale, box, rotation, font, charset, inkOf, taken }) {
  const P = globalThis.PDFLib;
  const keep = ocrPage.words.map((w) => !covered(w, taken));
  const skipped = keep.filter((k) => !k).length;
  if (skipped === ocrPage.words.length) return { written: 0, covered: skipped };
  const key = page.node.newFontDictionary(font.name, font.ref);
  const ops = [
    P.beginMarkedContent(OCR_TAG), P.pushGraphicsState(), P.concatTransformationMatrix(...displayToPdf(box, rotation)),
    P.beginText(), P.setTextRenderingMode(P.TextRenderingMode.Invisible),
  ];
  let count = 0;
  for (const line of ocrPage.lines) {
    const size = lineSize(line, ocrPage.words, inkOf) / scale;
    // text space (y up) -> display space (y down), turned along the
    // baseline; a vertical line runs up (-1) or down (1) the page
    const angle = line.vertical ? 0 : lineAngle(line);
    const cos = line.vertical ? 0 : Math.cos(angle);
    const sin = line.vertical ? line.vertical : Math.sin(angle);
    ops.push(P.setFontAndSize(key, size));
    line.words.forEach((wi, k) => {
      if (!keep[wi]) return;
      const w = ocrPage.words[wi];
      const text = drawable(w.text, charset);
      if (!text) return;
      const span = wordSpan(line, w);
      const x = span.x / scale, y = span.y / scale, width = span.len / scale;
      const natural = font.widthOfTextAtSize(text, size);
      if (natural <= 0 || width <= 0) return;
      ops.push(P.setTextMatrix(cos, sin, sin, -cos, x, y), P.setCharacterSqueeze(Math.max(5, Math.min(500, (100 * width) / natural))), P.showText(font.encodeText(text)));
      count++;
      // a space stretched over the gap to the next word, so copy and paste
      // keeps the words apart in every reader
      const ni = line.words[k + 1];
      if (ni != null && keep[ni] && charset.has(32)) {
        const gap = wordGap(line, w, ocrPage.words[ni]) / scale;
        const sw = font.widthOfTextAtSize(" ", size);
        if (gap > 0 && sw > 0) {
          ops.push(P.setTextMatrix(cos, sin, sin, -cos, x + width * cos, y + width * sin), P.setCharacterSqueeze(Math.max(5, Math.min(1000, (100 * gap) / sw))), P.showText(font.encodeText(" ")));
        }
      }
    });
  }
  ops.push(P.setCharacterSqueeze(100), P.endText(), P.popGraphicsState(), P.endMarkedContent());
  page.pushOperators(...ops);
  return { written: count, covered: skipped };
}

/* --------------------------------- OCR a PDF ----------------------------- */
// opts: { pages: "auto" | "all" | number[], langs, dpi, onProgress(done, total, label), signal }
// -> { bytes, pages: number[] (0-based, OCRed), words: number (written),
//      text: string[], covered: number (words skipped: already text on the
//      page), replaced: number (pages whose earlier Mühür OCR layer was
//      replaced) }. pages is empty, and bytes are the input, when there was
//      nothing to recognise or everything recognised was already text.
export async function ocrPdf(bytes, opts = {}) {
  const { langs = "tur+eng", dpi = 300, onProgress, signal } = opts;
  const P = await pdflib();
  const pdf = await openPdf(bytes);
  let ocr = null;
  const check = () => {
    if (signal && signal.aborted) throw abortError();
  };
  try {
    let targets;
    if (Array.isArray(opts.pages)) targets = opts.pages.filter((i) => i >= 0 && i < pdf.numPages);
    else if (opts.pages === "all") targets = Array.from({ length: pdf.numPages }, (_, i) => i);
    else {
      targets = [];
      for (let i = 0; i < pdf.numPages; i++) {
        check();
        if (onProgress) onProgress(0, 1, `Sayfalar inceleniyor ${i + 1}/${pdf.numPages}`);
        if (await pageNeedsOcr(pdf, i)) targets.push(i);
      }
    }
    if (!targets.length) return { bytes, pages: [], words: 0, text: [], covered: 0, replaced: 0 };

    const total = targets.length;
    let done = 0;
    const report = (p, label) => { if (onProgress) onProgress(done + Math.max(0, Math.min(1, p)), total, label); };
    ocr = await createOcr({ langs, signal, onProgress: (p, label) => report(p, `${label} · sayfa ${targets[done] + 1}`) });

    const doc = await P.PDFDocument.load(bytes, { updateMetadata: false });
    doc.registerFontkit(globalThis.fontkit);
    const ttf = await fontBytes(FONT_FILE);
    const font = await doc.embedFont(ttf, { subset: true });
    const charset = new Set(font.getCharacterSet());
    const inkOf = inkMeter(globalThis.fontkit.create(ttf), charset);
    const pages = doc.getPages();
    const texts = [];
    let words = 0, skipped = 0, replaced = 0;
    for (const index of targets) {
      check();
      report(0, `Sayfa ${index + 1} hazırlanıyor`);
      // the geometry pdf.js renders: its view box (CropBox ∩ MediaBox,
      // normalised), rotation and UserUnit — not pdf-lib's raw CropBox
      const pp = await pdf.getPage(index + 1);
      let scale, geo, own;
      try {
        const vp = pp.getViewport({ scale: 1 });
        scale = Math.min(dpi / 72, Math.sqrt(MAX_PIXELS / (vp.width * vp.height)));
        const [x0, y0, x1, y1] = pp.view;
        geo = { box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, rotation: pp.rotate, unit: pp.userUnit || 1 };
        own = await pageText(pp, pp.getViewport({ scale }));
      } finally {
        pp.cleanup();
      }
      const canvas = await renderPage(pdf, index, scale);
      invertBands(canvas);
      removeRules(canvas);
      const png = await canvasToBytes(canvas, "image/png");
      const w = canvas.width, h = canvas.height;
      canvas.width = canvas.height = 0;
      check();
      const result = await ocr.recognize(png, w, h);
      if (own.layer && stripOcrLayer(doc, pages[index])) replaced++;
      const n = writeTextLayer(doc, pages[index], result, { scale: scale * geo.unit, box: geo.box, rotation: geo.rotation, font, charset, inkOf, taken: own.items });
      words += n.written;
      skipped += n.covered;
      texts.push(result.text);
      done++;
      report(0, `Sayfa ${index + 1} tamamlandı`);
    }
    check();
    // Every word read is already text on its page (a born-digital page sent
    // through "Bu sayfa" or "Tüm sayfalar") and no old layer was replaced:
    // the document would come back unchanged, so it is not rewritten and
    // no page counts as OCRed — the caller then saves no new version.
    if (!words && !replaced && skipped) return { bytes, pages: [], words: 0, text: [], covered: skipped, replaced: 0 };
    if (onProgress) onProgress(total, total, "PDF kaydediliyor");
    doc.setProducer("Mühür PDF (pdf-lib, tesseract.js)");
    const out = await doc.save({ useObjectStreams: false });
    return { bytes: out, pages: targets, words, text: texts, covered: skipped, replaced };
  } finally {
    if (ocr) await ocr.terminate().catch(() => null);
    closePdf(pdf);
  }
}
