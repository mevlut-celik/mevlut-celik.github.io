/* ==========================================================================
   Mühür — ocr.js
   Scanned pages become searchable: each page is rendered, read by
   tesseract.js (LSTM, Turkish + English by default) and an INVISIBLE text
   layer (text render mode 3) is written into the original page — one run
   per word, placed on the word's baseline and squeezed with Tz so its
   advance matches the word's width on the image. The page looks exactly
   as before; text can now be selected, searched, copied and edited.

   Geometry: tesseract works in render pixels; pixels / scale are display
   points (page rotation applied); pdfwork.displayToPdf takes those to PDF
   user space. Every line keeps its own baseline slope, so slightly skewed
   scans still select along the printed line.
   ========================================================================== */

import { pdfjs, pdflib, openPdf, closePdf, tesseract, tesseractPaths, fontBytes } from "./libs.js";
import { renderPage, canvasToBytes } from "./convert/canvas.js";
import { displayToPdf } from "./pdfwork.js";

const FONT_FILE = "LiberationSans-Regular.ttf";
const MAX_PIXELS = 12e6;          // ~ A4 at 300 dpi is 8.7 MP
const TEXT_THRESHOLD = 20;        // fewer non-space characters than this = "no text"

export const LANGS = {
  "tur+eng": "Türkçe + İngilizce",
  tur: "Türkçe",
  eng: "İngilizce",
};

/* --------------------------------- Worker -------------------------------- */
// One tesseract worker, reused for every page of a run.
export async function createOcr({ langs = "tur+eng", onProgress } = {}) {
  const T = await tesseract();
  let current = null;
  const worker = await T.createWorker(langs, 1, {
    ...tesseractPaths(),
    logger: (m) => {
      if (!onProgress) return;
      if (m.status === "recognizing text") onProgress(m.progress || 0, "Metin tanınıyor");
      else if (/loading|initializ/i.test(m.status || "")) onProgress(0, "OCR motoru hazırlanıyor");
    },
    errorHandler: (err) => { current = err; },
  });
  // tesseract.js defaults to one uniform block (PSM 6); automatic layout
  // analysis (3) is what finds columns, captions and table rows
  await worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1" });
  return {
    async recognize(image, width, height) {
      current = null;
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      if (current) throw current;
      return toOcrPage(data, width, height);
    },
    terminate: () => worker.terminate(),
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
        const hasBase = b && (b.has_baseline !== false) && b.x1 > b.x0;
        lines.push({
          text: ids.map((i) => words[i].text).join(" "),
          x0: line.bbox.x0, y0: line.bbox.y0, x1: line.bbox.x1, y1: line.bbox.y1,
          baseline: hasBase ? [b.x0, b.y0, b.x1, b.y1] : null,
          descent: line.rowAttributes ? line.rowAttributes.descenders || 0 : 0,
          words: ids,
        });
      }
    }
  }
  return { width, height, words, lines, text: lines.map((l) => l.text).join("\n") };
}

/* ------------------------------ Preprocessing ---------------------------- */
// Ruled tables defeat tesseract's layout analysis: cells boxed by lines
// are taken for pictures and never read. The copy we hand to the OCR
// engine has every long horizontal and vertical rule painted white first
// (the PDF keeps the original image). Lines are found as long runs of
// dark pixels; glyph strokes are far shorter than the thresholds.
export function removeRules(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  const DARK = 160;   // a pixel that can start or continue a rule
  const SOFT = 215;   // anti-aliased edge pixels cleared along with it
  const minH = Math.max(60, Math.round(w * 0.05));
  const minV = Math.max(60, Math.round(h * 0.06));
  const clear = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (lum[y * w + x] >= DARK) { x++; continue; }
      const start = x;
      while (x < w && lum[y * w + x] < DARK) x++;
      if (x - start >= minH) for (let k = start; k < x; k++) clear[y * w + k] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (lum[y * w + x] >= DARK) { y++; continue; }
      const start = y;
      while (y < h && lum[y * w + x] < DARK) y++;
      if (y - start >= minV) for (let k = start; k < y; k++) clear[k * w + x] = 1;
    }
  }
  let removed = 0;
  for (let i = 0; i < clear.length; i++) {
    if (!clear[i]) continue;
    // widen by one pixel to take the soft edge of the rule as well
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (lum[j] < SOFT) { const p = j * 4; d[p] = d[p + 1] = d[p + 2] = 255; removed++; }
      }
    }
  }
  if (removed) ctx.putImageData(img, 0, 0);
  return removed;
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

// Glyph height of a line in pixels, used as the invisible font size.
function lineSize(line) {
  return Math.max(4, (line.y1 - line.y0) / 1.15);
}

// Runs and lines in display points, for pdf-analyze (scanned pages).
export function ocrPageToRuns(ocrPage, scale) {
  const runs = [];
  const lines = [];
  for (const line of ocrPage.lines) {
    const size = lineSize(line) / scale;
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

function writeTextLayer(doc, page, ocrPage, scale, font, charset) {
  const P = globalThis.PDFLib;
  if (!ocrPage.words.length) return 0;
  const toPdf = displayToPdf(page.getCropBox(), page.getRotation().angle);
  const key = page.node.newFontDictionary(font.name, font.ref);
  const ops = [P.pushGraphicsState(), P.concatTransformationMatrix(...toPdf), P.beginText(), P.setTextRenderingMode(P.TextRenderingMode.Invisible)];
  let count = 0;
  for (const line of ocrPage.lines) {
    const size = lineSize(line) / scale;
    const angle = lineAngle(line);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    ops.push(P.setFontAndSize(key, size));
    line.words.forEach((wi, k) => {
      const w = ocrPage.words[wi];
      const text = drawable(w.text, charset);
      if (!text) return;
      const x = w.x0 / scale;
      const y = baselineAt(line, w.x0) / scale;
      const width = (w.x1 - w.x0) / scale;
      const natural = font.widthOfTextAtSize(text, size);
      if (natural <= 0 || width <= 0) return;
      // text space (y up) -> display space (y down), turned along the baseline
      ops.push(P.setTextMatrix(cos, sin, sin, -cos, x, y), P.setCharacterSqueeze(Math.max(5, Math.min(500, (100 * width) / natural))), P.showText(font.encodeText(text)));
      count++;
      // a space stretched over the gap to the next word, so copy and paste
      // keeps the words apart in every reader
      const next = line.words[k + 1] != null ? ocrPage.words[line.words[k + 1]] : null;
      if (next && charset.has(32)) {
        const gap = (next.x0 - w.x1) / scale;
        const sw = font.widthOfTextAtSize(" ", size);
        if (gap > 0 && sw > 0) {
          ops.push(P.setTextMatrix(cos, sin, sin, -cos, x + width * cos, y + width * sin), P.setCharacterSqueeze(Math.max(5, Math.min(1000, (100 * gap) / sw))), P.showText(font.encodeText(" ")));
        }
      }
    });
  }
  ops.push(P.setCharacterSqueeze(100), P.endText(), P.popGraphicsState());
  page.pushOperators(...ops);
  return count;
}

/* --------------------------------- OCR a PDF ----------------------------- */
// opts: { pages: "auto" | "all" | number[], langs, dpi, onProgress(done, total, label), signal }
// -> { bytes, pages: number[] (0-based, OCRed), words: number, text: string[] }
export async function ocrPdf(bytes, opts = {}) {
  const { langs = "tur+eng", dpi = 300, onProgress, signal } = opts;
  const P = await pdflib();
  const pdf = await openPdf(bytes);
  let ocr = null;
  const check = () => {
    if (signal && signal.aborted) {
      const err = new Error("OCR iptal edildi.");
      err.name = "AbortError";
      throw err;
    }
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
    if (!targets.length) return { bytes, pages: [], words: 0, text: [] };

    const total = targets.length;
    let done = 0;
    const report = (p, label) => { if (onProgress) onProgress(done + Math.max(0, Math.min(1, p)), total, label); };
    ocr = await createOcr({ langs, onProgress: (p, label) => report(p, `${label} · sayfa ${targets[done] + 1}`) });

    const doc = await P.PDFDocument.load(bytes, { updateMetadata: false });
    doc.registerFontkit(globalThis.fontkit);
    const font = await doc.embedFont(await fontBytes(FONT_FILE), { subset: true });
    const charset = new Set(font.getCharacterSet());
    const pages = doc.getPages();
    const texts = [];
    let words = 0;
    for (const index of targets) {
      check();
      report(0, `Sayfa ${index + 1} hazırlanıyor`);
      const pp = await pdf.getPage(index + 1);
      const vp = pp.getViewport({ scale: 1 });
      pp.cleanup();
      const scale = Math.min(dpi / 72, Math.sqrt(MAX_PIXELS / (vp.width * vp.height)));
      const canvas = await renderPage(pdf, index, scale);
      removeRules(canvas);
      const png = await canvasToBytes(canvas, "image/png");
      const w = canvas.width, h = canvas.height;
      canvas.width = canvas.height = 0;
      check();
      const result = await ocr.recognize(png, w, h);
      words += writeTextLayer(doc, pages[index], result, scale, font, charset);
      texts.push(result.text);
      done++;
      report(0, `Sayfa ${index + 1} tamamlandı`);
    }
    check();
    if (onProgress) onProgress(total, total, "PDF kaydediliyor");
    doc.setProducer("Mühür PDF (pdf-lib, tesseract.js)");
    const out = await doc.save({ useObjectStreams: false });
    return { bytes: out, pages: targets, words, text: texts };
  } finally {
    if (ocr) await ocr.terminate().catch(() => null);
    closePdf(pdf);
  }
}
