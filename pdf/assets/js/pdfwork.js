/* ==========================================================================
   Mühür — pdfwork.js
   Turns the editor's state into a PDF with pdf-lib.

   The editor stores every object in "display space": points, origin at the
   top-left of the page as it is shown (its rotation already applied). Here
   each page gets the affine map from that space back to PDF user space for
   its crop box and final /Rotate, and every object is drawn in a local
   frame built on top of it — so a text box on a rotated scan still comes
   out upright, where the user put it.

   Fonts are Liberation Sans/Serif/Mono (metric-compatible with Arial,
   Times and Courier, Turkish glyphs included), subset on embed. The screen
   uses the same files with kerning and ligatures off, so line widths match.
   ========================================================================== */

import { hexToRgb, base64ToBytes, sha256Hex, formatDateTime, tzLabel } from "./util.js";
import { stripTextInRects } from "./textstrip.js";

const lib = () => globalThis.PDFLib;

/* -------------------------------- Fonts --------------------------------- */
export const FONT_FAMILIES = {
  sans:  { label: "Sans (Arial uyumlu)",       file: "LiberationSans",  css: "Muhur Sans",  ascent: 1854, descent: 434 },
  serif: { label: "Serif (Times uyumlu)",      file: "LiberationSerif", css: "Muhur Serif", ascent: 1825, descent: 443 },
  mono:  { label: "Mono (Courier uyumlu)",     file: "LiberationMono",  css: "Muhur Mono",  ascent: 1705, descent: 615 },
};
export const LINE_HEIGHT = 1.2;
export const TEXT_PAD = 2;          // points of padding inside a text box

export function fontFileName(family, bold, italic) {
  const f = FONT_FAMILIES[family] || FONT_FAMILIES.sans;
  const style = bold && italic ? "BoldItalic" : bold ? "Bold" : italic ? "Italic" : "Regular";
  return f.file + "-" + style + ".ttf";
}

// Distance from the top of a CSS line box to the baseline, in em.
export function baselineInLine(family) {
  const f = FONT_FAMILIES[family] || FONT_FAMILIES.sans;
  const a = f.ascent / 2048;
  const d = f.descent / 2048;
  return (LINE_HEIGHT - (a + d)) / 2 + a;
}

/* -------------------------------- Matrices ------------------------------ */
// [a b c d e f]: x' = a x + c y + e, y' = b x + d y + f
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// Display space (y down, rotation applied) -> PDF user space.
export function displayToPdf(box, rotation) {
  const x0 = box.x, y0 = box.y, x1 = box.x + box.width, y1 = box.y + box.height;
  switch (((rotation % 360) + 360) % 360) {
    case 90:  return [0, 1, 1, 0, x0, y0];
    case 180: return [-1, 0, 0, 1, x1, y0];
    case 270: return [0, -1, -1, 0, x1, y1];
    default:  return [1, 0, 0, -1, x0, y1];
  }
}

export function displaySize(width, height, rotation) {
  return rotation % 180 === 0 ? [width, height] : [height, width];
}

// Local frame of a box: origin at its bottom-left, y up, rotated `deg`
// clockwise (as on screen) around its centre.
export function boxFrame(x, y, w, h, deg) {
  let m = [1, 0, 0, -1, x, y + h];
  if (deg) {
    const t = (deg * Math.PI) / 180;
    const cos = Math.cos(t), sin = Math.sin(t);
    const cx = x + w / 2, cy = y + h / 2;
    m = multiply([cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy], m);
  }
  return m;
}

/* -------------------------------- Text ---------------------------------- */
// Greedy word wrap, the way CSS `white-space: pre-wrap; overflow-wrap:
// break-word` does it: trailing spaces hang, over-long words break.
export function wrapText(text, maxWidth, measure) {
  const out = [];
  for (const para of String(text || "").split("\n")) {
    if (!(maxWidth > 0)) { out.push(para); continue; }
    const tokens = para.match(/\S+|\s+/g) || [""];
    let line = "";
    for (const tok of tokens) {
      const next = line + tok;
      if (/^\s+$/.test(tok) || measure(next.replace(/\s+$/, "")) <= maxWidth || line === "") {
        if (line === "" && !/^\s+$/.test(tok) && measure(tok) > maxWidth) {
          // break a long word character by character
          let part = "";
          for (const ch of tok) {
            if (part && measure(part + ch) > maxWidth) { out.push(part); part = ""; }
            part += ch;
          }
          line = part;
        } else {
          line = next;
        }
      } else {
        out.push(line.replace(/\s+$/, ""));
        line = tok;
        if (measure(tok) > maxWidth) {
          let part = "";
          line = "";
          for (const ch of tok) {
            if (part && measure(part + ch) > maxWidth) { out.push(part); part = ""; }
            part += ch;
          }
          line = part;
        }
      }
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out;
}

/* -------------------------------- Helpers ------------------------------- */
function dataUrlBytes(url) {
  const comma = url.indexOf(",");
  return base64ToBytes(url.slice(comma + 1));
}

function rgb(hex) {
  const [r, g, b] = hexToRgb(hex);
  return lib().rgb(r, g, b);
}

export function layerRank(it) {
  switch (it.type) {
    case "highlight": case "whiteout": case "redact": return 0;
    case "path": return it.blend === "multiply" ? 0 : 1;
    case "line": case "rect": case "ellipse": case "mark": return 1;
    case "note": return 3;
    default: return 2;
  }
}

export function isPristine(state) {
  const pages = state.pages || [];
  const sameOrder = pages.every((p, i) => p.src === "main" && p.index === i && !p.rotate);
  return sameOrder && pages.length === (state.mainPageCount || pages.length) &&
    !(state.items || []).length && !Object.keys(state.forms || {}).length &&
    !state.watermark && !state.pageNumbers && !state.metaChanged;
}

/* ============================== Build PDF =============================== */
// ctx: { state, loadSource(srcId) -> bytes, fontBytes(file) -> bytes,
//        renderBytes(pdfBytes, pageIndex, scale) -> canvas, options }
export async function buildPdf(ctx) {
  const P = lib();
  const { state } = ctx;
  const opts = ctx.options || {};
  const sources = new Map();
  const loadDoc = async (src) => {
    if (!sources.has(src)) sources.set(src, P.PDFDocument.load(await ctx.loadSource(src), { updateMetadata: false, ignoreEncryption: true }));
    return sources.get(src);
  };

  const base = state.sources && state.sources.main ? await loadDoc("main") : await P.PDFDocument.create();
  base.registerFontkit(globalThis.fontkit);

  // ---- fonts, embedded on first use
  const fontCache = new Map();
  const font = async (family, bold, italic) => {
    const file = fontFileName(family, bold, italic);
    if (!fontCache.has(file)) {
      fontCache.set(file, ctx.fontBytes(file).then((bytes) =>
        base.embedFont(bytes, { subset: true, features: { liga: false, clig: false, calt: false, kern: false } })));
    }
    return fontCache.get(file);
  };

  // ---- form values (before pages move, while widgets still match fields)
  const formEntries = Object.entries(state.forms || {});
  if (formEntries.length && state.sources && state.sources.main) {
    // pdf-lib serialises a font while building field appearances; text
    // encoded with that font afterwards would be lost, so forms get their own.
    const formFont = await base.embedFont(await ctx.fontBytes(fontFileName("sans", false, false)), { subset: true });
    await fillForm(base, formEntries, formFont, !!opts.flattenForms);
  }

  // ---- assemble pages in their final order
  // Every page object is fetched or copied first and rotated only after,
  // so a duplicate never inherits its twin's new rotation.
  const basePages = base.getPages();
  const used = new Set();
  const finalPages = [];
  for (const entry of state.pages) {
    let page;
    if (entry.src === "main" && !used.has(entry.index) && basePages[entry.index]) {
      page = basePages[entry.index];
      used.add(entry.index);
    } else if (entry.src) {
      const srcDoc = entry.src === "main" ? base : await loadDoc(entry.src);
      [page] = await base.copyPages(srcDoc, [entry.index]);
    } else {
      page = P.PDFPage.create(base);
      page.setSize(entry.w || 595.28, entry.h || 841.89);
    }
    finalPages.push({ page, entry, baseRot: entry.src ? page.getRotation().angle : 0 });
  }
  for (const f of finalPages) {
    f.page.setRotation(P.degrees((((f.baseRot + (f.entry.rotate || 0)) % 360) + 360) % 360));
  }
  for (let i = base.getPageCount() - 1; i >= 0; i--) base.removePage(i);
  finalPages.forEach(({ page }) => base.addPage(page));

  // ---- per page: redaction, objects, watermark, numbers, notes
  const imageCache = new Map();
  const image = async (assetId) => {
    if (!imageCache.has(assetId)) {
      const url = state.assets[assetId];
      const bytes = dataUrlBytes(url);
      imageCache.set(assetId, /^data:image\/png/.test(url) ? base.embedPng(bytes) : base.embedJpg(bytes));
    }
    return imageCache.get(assetId);
  };

  const itemsByPage = new Map();
  for (const item of state.items || []) {
    if (!itemsByPage.has(item.page)) itemsByPage.set(item.page, []);
    itemsByPage.get(item.page).push(item);
  }
  // the same stacking the editor shows: marks, then ink, then objects
  for (const list of itemsByPage.values()) list.sort((a, b) => layerRank(a) - layerRank(b));

  const total = finalPages.length;
  const redactPages = [];
  for (let i = 0; i < finalPages.length; i++) {
    const { page, entry } = finalPages[i];
    const items = itemsByPage.get(entry.id) || [];

    const redactions = items.filter((it) => it.type === "redact");
    if (redactions.length) redactPages.push({ index: i, rects: redactions, notes: items.filter((it) => it.type === "note") });

    const box = page.getCropBox();
    const rotation = page.getRotation().angle;
    const toPdf = displayToPdf(box, rotation);
    const [dw, dh] = displaySize(box.width, box.height, rotation);

    // edited lines: take the original text out of the page, not just cover it
    const edited = items.filter((it) => it.type === "text" && it.cover && it.origin === "edit");
    if (edited.length) {
      const rects = edited.map(({ cover: c }) => {
        const [ax, ay] = apply(toPdf, c.x, c.y);
        const [bx, by] = apply(toPdf, c.x + c.w, c.y + c.h);
        return { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) };
      });
      try { stripTextInRects(base, page, rects); } catch (e) { console.warn("Orijinal metin çıkarılamadı; örtü ile gizlendi.", e); }
    }

    const painter = new Painter(base, page, toPdf);

    // covers under everything, then objects in their stacking order
    for (const it of items) if (it.type === "text" && it.cover) painter.fillRect(it.cover, it.cover.color || "#ffffff", 1);
    for (const it of items) await drawItem(painter, it, { font, image });

    if (state.watermark && state.watermark.text) await drawWatermark(painter, state.watermark, dw, dh, font);
    if (state.pageNumbers) await drawPageNumber(painter, state.pageNumbers, i, total, dw, dh, font);
    if (opts.notes !== false) for (const it of items) if (it.type === "note") addNote(base, page, toPdf, it);
  }

  if (opts.audit) await appendAuditPage(base, opts.audit, font);

  // ---- metadata
  const meta = state.meta || {};
  if (meta.title) base.setTitle(meta.title, { showInWindowTitleBar: true });
  if (meta.author) base.setAuthor(meta.author);
  if (meta.subject) base.setSubject(meta.subject);
  if (meta.keywords) base.setKeywords(String(meta.keywords).split(/\s*,\s*/).filter(Boolean));
  base.setProducer("Mühür PDF (pdf-lib)");
  base.setCreator("Mühür PDF");
  base.setModificationDate(new Date());

  const bytes = await base.save({ useObjectStreams: false });
  if (!redactPages.length) return bytes;
  if (!ctx.renderBytes) throw new Error("Karartma için sayfa görüntüleyici gerekli.");
  return applyRedactions(bytes, redactPages, ctx.renderBytes, opts.notes !== false);
}

// Second pass: each page with redactions is rendered from the finished
// file (form values, objects and all), painted black where asked, and
// replaced by that image — so nothing under a redaction survives.
async function applyRedactions(bytes, pages, renderBytes, keepNotes) {
  const P = lib();
  const doc = await P.PDFDocument.load(bytes, { updateMetadata: false });
  const scale = 2.5; // ~180 dpi
  for (const rp of pages) {
    const canvas = await renderBytes(bytes, rp.index, scale);
    const c2d = canvas.getContext("2d");
    c2d.fillStyle = "#000";
    for (const r of rp.rects) c2d.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    const jpg = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const w = canvas.width / scale;
    const h = canvas.height / scale;
    const old = doc.getPage(rp.index);
    dropFieldsOn(doc, old);
    doc.removePage(rp.index);
    const fresh = doc.insertPage(rp.index, [w, h]);
    fresh.drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    if (keepNotes) for (const n of rp.notes) addNote(doc, fresh, displayToPdf({ x: 0, y: 0, width: w, height: h }, 0), n);
  }
  return doc.save({ useObjectStreams: false });
}

function dropFieldsOn(doc, page) {
  const P = lib();
  const annots = page.node.lookup(P.PDFName.of("Annots"));
  if (!(annots instanceof P.PDFArray) || !annots.size()) return;
  const refs = new Set(annots.asArray().map((r) => r.toString()));
  let form;
  try { form = doc.getForm(); } catch (e) { return; }
  for (const field of form.getFields()) {
    try {
      const widgets = field.acroField.getWidgets();
      const onPage = widgets.some((wd) => {
        const p = wd.P();
        if (p && p.toString() === page.ref.toString()) return true;
        const ref = doc.context.getObjectRef(wd.dict);
        return ref && refs.has(ref.toString());
      });
      if (onPage) form.removeField(field);
    } catch (e) { /* leave the field */ }
  }
}

async function fillForm(doc, entries, sans, flatten) {
  const P = lib();
  let form;
  try { form = doc.getForm(); } catch (e) { return; }
  for (const [name, value] of entries) {
    let field;
    try { field = form.getField(name); } catch (e) { continue; }
    try {
      if (field instanceof P.PDFTextField) {
        const text = String(value == null ? "" : value);
        const max = field.getMaxLength();
        field.setText(max ? text.slice(0, max) : text);
      } else if (field instanceof P.PDFCheckBox) {
        if (value) field.check(); else field.uncheck();
      } else if (field instanceof P.PDFRadioGroup) {
        if (value) field.select(String(value)); else field.clear();
      } else if (field instanceof P.PDFDropdown || field instanceof P.PDFOptionList) {
        if (value == null || value === "") field.clear(); else field.select(value);
      }
    } catch (e) { /* a value the field refuses is skipped, not fatal */ }
  }
  try { form.updateFieldAppearances(sans); } catch (e) { /* keep existing appearances */ }
  if (flatten) {
    try { form.flatten({ updateFieldAppearances: false }); } catch (e) { /* leave the form live */ }
  }
}

/* ================================ Painter =============================== */
// Low-level drawing on one page through a display-space matrix.
class Painter {
  constructor(doc, page, toPdf) {
    this.doc = doc;
    this.page = page;
    this.toPdf = toPdf;
    this.gsCache = new Map();
  }

  ops(...list) { this.page.pushOperators(...list.filter(Boolean)); }

  gs(fillOpacity, strokeOpacity, blend) {
    const P = lib();
    const key = [fillOpacity, strokeOpacity, blend || ""].join("|");
    if (!this.gsCache.has(key)) {
      const dict = { Type: "ExtGState", ca: fillOpacity, CA: strokeOpacity };
      if (blend) dict.BM = blend;
      const ref = this.doc.context.register(this.doc.context.obj(dict));
      this.gsCache.set(key, this.page.node.newExtGState("GS", ref));
    }
    return P.setGraphicsState(this.gsCache.get(key));
  }

  begin(matrix) {
    const P = lib();
    const m = multiply(this.toPdf, matrix || [1, 0, 0, 1, 0, 0]);
    this.ops(P.pushGraphicsState(), P.concatTransformationMatrix(...m));
  }

  end() { this.ops(lib().popGraphicsState()); }

  fillRect(r, color, opacity, blend) {
    const P = lib();
    const [cr, cg, cb] = hexToRgb(color);
    this.begin();
    this.ops(this.gs(opacity == null ? 1 : opacity, 1, blend), P.setFillingRgbColor(cr, cg, cb),
      P.rectangle(r.x, r.y, r.w, r.h), P.fill());
    this.end();
  }

  stroke({ color, width, opacity, dash, cap, blend, fill, fillOpacity }, pathOps) {
    const P = lib();
    const list = [this.gs(fillOpacity == null ? (opacity == null ? 1 : opacity) : fillOpacity, opacity == null ? 1 : opacity, blend)];
    if (color) { const [r, g, b] = hexToRgb(color); list.push(P.setStrokingRgbColor(r, g, b), P.setLineWidth(width || 1)); }
    if (fill) { const [r, g, b] = hexToRgb(fill); list.push(P.setFillingRgbColor(r, g, b)); }
    list.push(P.setLineCap(cap === "butt" ? P.LineCapStyle.Butt : P.LineCapStyle.Round), P.setLineJoin(P.LineJoinStyle.Round));
    if (dash && color) list.push(P.setDashPattern([width * 3, width * 2], 0));
    list.push(...pathOps);
    list.push(fill && color ? P.fillAndStroke() : fill ? P.fill() : P.stroke());
    this.begin();
    this.ops(...list);
    this.end();
  }
}

/* ================================ Objects =============================== */
const KAPPA = 0.5522847498;

function ellipseOps(x, y, w, h) {
  const P = lib();
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  const ox = rx * KAPPA, oy = ry * KAPPA;
  return [
    P.moveTo(cx - rx, cy),
    P.appendBezierCurve(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry),
    P.appendBezierCurve(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy),
    P.appendBezierCurve(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry),
    P.appendBezierCurve(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy),
    P.closePath(),
  ];
}

// Smooth a freehand stroke through the midpoints of its samples.
export function smoothPathOps(points) {
  const P = lib();
  if (!points.length) return [];
  const ops = [P.moveTo(points[0][0], points[0][1])];
  if (points.length === 1) { ops.push(P.lineTo(points[0][0] + 0.01, points[0][1])); return ops; }
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    ops.push(P.appendQuadraticCurve(x, y, (x + nx) / 2, (y + ny) / 2));
  }
  const last = points[points.length - 1];
  ops.push(P.lineTo(last[0], last[1]));
  return ops;
}

export function arrowHead(x1, y1, x2, y2, width) {
  const size = Math.max(8, width * 3.2);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  return [
    [x2 - size * Math.cos(ang - spread), y2 - size * Math.sin(ang - spread)],
    [x2, y2],
    [x2 - size * Math.cos(ang + spread), y2 - size * Math.sin(ang + spread)],
  ];
}

export const MARK_PATHS = {
  check: [[0.12, 0.55], [0.4, 0.82], [0.9, 0.18]],
  cross: [[0.18, 0.18], [0.82, 0.82], null, [0.82, 0.18], [0.18, 0.82]],
};

async function drawText(painter, it, font) {
  const P = lib();
  const f = await font(it.font || "sans", !!it.bold, !!it.italic);
  const size = it.size || 12;
  const pad = TEXT_PAD;
  const measure = (s) => f.widthOfTextAtSize(s, size);
  const lines = it.autoW ? String(it.text || "").split("\n") : wrapText(it.text, it.w - pad * 2, measure);
  const lead = size * LINE_HEIGHT;
  const base = baselineInLine(it.font) * size;
  const [r, g, b] = hexToRgb(it.color || "#000000");
  const h = it.h || lines.length * lead + pad * 2;
  painter.begin(boxFrame(it.x, it.y, it.w, h, it.rotation || 0));
  const list = [painter.gs(it.opacity == null ? 1 : it.opacity, 1)];
  if (it.bg) {
    const [br, bg, bb] = hexToRgb(it.bg);
    list.push(P.setFillingRgbColor(br, bg, bb), P.rectangle(0, 0, it.w, h), P.fill());
  }
  const key = painter.page.node.newFontDictionary(f.name, f.ref);
  list.push(P.beginText(), P.setFillingRgbColor(r, g, b), P.setFontAndSize(key, size));
  lines.forEach((line, i) => {
    if (!line) return;
    const lw = measure(line);
    const avail = it.w - pad * 2;
    const dx = it.align === "center" ? (avail - lw) / 2 : it.align === "right" ? avail - lw : 0;
    const y = h - pad - i * lead - base;
    list.push(P.setTextMatrix(1, 0, 0, 1, pad + dx, y), P.showText(f.encodeText(line)));
  });
  list.push(P.endText());
  painter.ops(...list);
  painter.end();
}

async function drawImageItem(painter, it, image) {
  const P = lib();
  const img = await image(it.asset);
  const key = painter.page.node.newXObject("Im", img.ref);
  painter.begin(boxFrame(it.x, it.y, it.w, it.h, it.rotation || 0));
  painter.ops(painter.gs(it.opacity == null ? 1 : it.opacity, 1), P.concatTransformationMatrix(it.w, 0, 0, it.h, 0, 0), P.drawObject(key));
  painter.end();
}

async function drawStamp(painter, it, font) {
  const P = lib();
  const f = await font("sans", true, false);
  const fs = await font("sans", false, false);
  const [r, g, b] = hexToRgb(it.color || "#c0352b");
  const w = it.w, h = it.h;
  const lw = Math.max(1.5, h * 0.05);
  const rad = Math.min(h * 0.18, 8);
  const hasSub = !!it.sub;
  const mainSize = hasSub ? h * 0.42 : h * 0.55;
  const subSize = h * 0.2;
  painter.begin(boxFrame(it.x, it.y, w, h, it.rotation || 0));
  const list = [painter.gs(it.opacity == null ? 0.9 : it.opacity, it.opacity == null ? 0.9 : it.opacity),
    P.setStrokingRgbColor(r, g, b), P.setFillingRgbColor(r, g, b), P.setLineWidth(lw)];
  list.push(...roundRectOps(lw / 2, lw / 2, w - lw, h - lw, rad), P.stroke());
  const fitSize = Math.min(mainSize, (w - lw * 6) / Math.max(1, f.widthOfTextAtSize(it.text, 1)));
  const tw = f.widthOfTextAtSize(it.text, fitSize);
  const ty = hasSub ? h * 0.46 : (h - fitSize * 0.72) / 2;
  const kMain = painter.page.node.newFontDictionary(f.name, f.ref);
  list.push(P.beginText(), P.setFontAndSize(kMain, fitSize), P.setTextMatrix(1, 0, 0, 1, (w - tw) / 2, ty), P.showText(f.encodeText(it.text)), P.endText());
  if (hasSub) {
    const sSize = Math.min(subSize, (w - lw * 6) / Math.max(1, fs.widthOfTextAtSize(it.sub, 1)));
    const sw = fs.widthOfTextAtSize(it.sub, sSize);
    const kSub = painter.page.node.newFontDictionary(fs.name, fs.ref);
    list.push(P.beginText(), P.setFontAndSize(kSub, sSize), P.setTextMatrix(1, 0, 0, 1, (w - sw) / 2, h * 0.17), P.showText(fs.encodeText(it.sub)), P.endText());
  }
  painter.ops(...list);
  painter.end();
}

function roundRectOps(x, y, w, h, r) {
  const P = lib();
  const k = r * KAPPA;
  return [
    P.moveTo(x + r, y),
    P.lineTo(x + w - r, y), P.appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
    P.lineTo(x + w, y + h - r), P.appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
    P.lineTo(x + r, y + h), P.appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
    P.lineTo(x, y + r), P.appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    P.closePath(),
  ];
}

async function drawItem(painter, it, res) {
  const P = lib();
  switch (it.type) {
    case "text": return drawText(painter, it, res.font);
    case "image": return drawImageItem(painter, it, res.image);
    case "stamp": return drawStamp(painter, it, res.font);
    case "whiteout": return painter.fillRect(it, it.color || "#ffffff", 1);
    case "path": {
      return painter.stroke({ color: it.color, width: it.width, opacity: it.opacity, blend: it.blend === "multiply" ? "Multiply" : null },
        smoothPathOps(it.points));
    }
    case "line": {
      const ops = [P.moveTo(it.x1, it.y1), P.lineTo(it.x2, it.y2)];
      painter.stroke({ color: it.color, width: it.width, opacity: it.opacity, dash: it.dash }, ops);
      if (it.head) {
        const pts = arrowHead(it.x1, it.y1, it.x2, it.y2, it.width);
        painter.stroke({ color: it.color, width: it.width, opacity: it.opacity, fill: it.color },
          [P.moveTo(pts[0][0], pts[0][1]), P.lineTo(pts[1][0], pts[1][1]), P.lineTo(pts[2][0], pts[2][1]), P.closePath()]);
      }
      return;
    }
    case "rect":
    case "ellipse": {
      const sw = it.stroke ? it.width || 1 : 0;
      const x = it.x + sw / 2, y = it.y + sw / 2, w = Math.max(0.1, it.w - sw), h = Math.max(0.1, it.h - sw);
      const ops = it.type === "rect" ? [P.rectangle(x, y, w, h)] : ellipseOps(x, y, w, h);
      return painter.stroke({ color: it.stroke || null, width: sw, opacity: it.opacity, dash: it.dash, fill: it.fill || null, cap: "butt" }, ops);
    }
    case "highlight": {
      for (const [x, y, w, h] of it.rects) {
        if (it.style === "underline" || it.style === "strike") {
          const t = Math.max(0.8, h * 0.07);
          const ly = it.style === "underline" ? y + h * 0.94 - t / 2 : y + h * 0.56;
          painter.fillRect({ x, y: ly - t / 2, w, h: t }, it.color, it.opacity == null ? 1 : it.opacity);
        } else {
          painter.fillRect({ x, y, w, h }, it.color, it.opacity == null ? 1 : it.opacity, "Multiply");
        }
      }
      return;
    }
    case "mark": {
      const { x, y, w, h } = it;
      if (it.glyph === "dot") {
        return painter.stroke({ fill: it.color, opacity: 1 }, ellipseOps(x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.5));
      }
      const pts = MARK_PATHS[it.glyph] || MARK_PATHS.check;
      const ops = [];
      let start = true;
      for (const p of pts) {
        if (!p) { start = true; continue; }
        ops.push(start ? P.moveTo(x + p[0] * w, y + p[1] * h) : P.lineTo(x + p[0] * w, y + p[1] * h));
        start = false;
      }
      return painter.stroke({ color: it.color, width: Math.max(1, w * 0.11) }, ops);
    }
    default:
      return undefined;
  }
}

async function drawWatermark(painter, wm, dw, dh, font) {
  const P = lib();
  const f = await font("sans", true, false);
  const size = wm.size || 64;
  const tw = f.widthOfTextAtSize(wm.text, size);
  const h = size;
  const x = (dw - tw) / 2, y = (dh - h) / 2;
  const [r, g, b] = hexToRgb(wm.color || "#c0352b");
  const op = wm.opacity == null ? 0.18 : wm.opacity;
  painter.begin(boxFrame(x, y, tw, h, -(wm.angle == null ? 45 : wm.angle)));
  const key = painter.page.node.newFontDictionary(f.name, f.ref);
  painter.ops(painter.gs(op, op), P.beginText(), P.setFillingRgbColor(r, g, b), P.setFontAndSize(key, size),
    P.setTextMatrix(1, 0, 0, 1, 0, size * 0.22), P.showText(f.encodeText(wm.text)), P.endText());
  painter.end();
}

export function pageNumberText(pn, index, total) {
  const n = index + (pn.start || 1);
  const t = total + (pn.start || 1) - 1;
  return String(pn.format || "{n} / {t}").replace(/\{n\}/g, n).replace(/\{t\}/g, t);
}

export function pageNumberBox(pn, textWidth, size, dw, dh) {
  const m = pn.margin == null ? 28 : pn.margin;
  const pos = pn.position || "bc";
  const y = pos[0] === "t" ? m : dh - m - size;
  const x = pos[1] === "l" ? m : pos[1] === "r" ? dw - m - textWidth : (dw - textWidth) / 2;
  return { x, y };
}

async function drawPageNumber(painter, pn, index, total, dw, dh, font) {
  if (pn.skipFirst && index === 0) return;
  const P = lib();
  const f = await font("sans", false, false);
  const size = pn.size || 10;
  const text = pageNumberText(pn, index, total);
  const tw = f.widthOfTextAtSize(text, size);
  const { x, y } = pageNumberBox(pn, tw, size, dw, dh);
  const [r, g, b] = hexToRgb(pn.color || "#333333");
  painter.begin(boxFrame(x, y, tw, size, 0));
  const key = painter.page.node.newFontDictionary(f.name, f.ref);
  painter.ops(P.beginText(), P.setFillingRgbColor(r, g, b), P.setFontAndSize(key, size),
    P.setTextMatrix(1, 0, 0, 1, 0, size * 0.2), P.showText(f.encodeText(text)), P.endText());
  painter.end();
}

function addNote(doc, page, toPdf, it) {
  const P = lib();
  const [x1, y1] = apply(toPdf, it.x, it.y);
  const [x2, y2] = apply(toPdf, it.x + 20, it.y + 20);
  const [r, g, b] = hexToRgb(it.color || "#f5c518");
  const dict = doc.context.obj({
    Type: "Annot", Subtype: "Text", Name: "Comment", F: 4, Open: false,
    Rect: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
    Contents: P.PDFHexString.fromText(it.text || ""),
    T: P.PDFHexString.fromText(it.author || ""),
    M: P.PDFString.of(pdfDateString(it.date ? new Date(it.date) : new Date())),
    C: [r, g, b],
  });
  const ref = doc.context.register(dict);
  const annots = page.node.lookup(P.PDFName.of("Annots"));
  if (annots instanceof P.PDFArray) annots.push(ref);
  else page.node.set(P.PDFName.of("Annots"), doc.context.obj([ref]));
}

function pdfDateString(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ============================== Audit page ============================== */
// A last page that records who signed, when, and the fingerprint of the
// content they signed. It is part of what the digital signature covers.
async function appendAuditPage(doc, audit, font) {
  const P = lib();
  const page = doc.addPage([595.28, 841.89]);
  const bold = await font("sans", true, false);
  const reg = await font("sans", false, false);
  const mono = await font("mono", false, false);
  const ink = P.rgb(0.09, 0.1, 0.12);
  const mute = P.rgb(0.39, 0.4, 0.43);
  const seal = P.rgb(0.75, 0.21, 0.17);
  const left = 56;
  let y = 841.89 - 72;

  page.drawCircle({ x: left + 10, y: y + 6, size: 10, color: seal });
  page.drawText("İmza Denetim Kaydı", { x: left + 30, y, size: 20, font: bold, color: ink });
  y -= 22;
  page.drawText("Mühür PDF tarafından belgeye eklenmiştir.", { x: left + 30, y, size: 10, font: reg, color: mute });
  y -= 30;
  page.drawLine({ start: { x: left, y }, end: { x: 595.28 - left, y }, thickness: 0.6, color: P.rgb(0.85, 0.84, 0.82) });
  y -= 26;

  const row = (label, value, useMono) => {
    page.drawText(label, { x: left, y, size: 9, font: reg, color: mute });
    const f = useMono ? mono : reg;
    const lines = wrapText(String(value || "—"), 330, (s) => f.widthOfTextAtSize(s, useMono ? 8.5 : 10.5));
    lines.forEach((ln, i) => page.drawText(ln, { x: left + 150, y: y - i * 14, size: useMono ? 8.5 : 10.5, font: f, color: ink }));
    y -= Math.max(1, lines.length) * 14 + 10;
  };

  row("Belge", audit.documentName);
  row("Belge kimliği", audit.documentId, true);
  row("Sayfa sayısı", String(audit.pageCount) + " sayfa (bu kayıt hariç)");
  row("İçerik özeti (SHA-256)", audit.contentHash, true);
  y -= 6;
  row("İmzalayan", audit.signerName);
  row("E-posta", audit.signerEmail);
  row("Sertifika", audit.certificateLabel);
  row("Sertifika parmak izi", audit.certificateFingerprint, true);
  row("İmza zamanı", audit.time);
  if (audit.reason) row("Neden", audit.reason);
  if (audit.location) row("Konum", audit.location);
  if (audit.visualSignatures && audit.visualSignatures.length) row("Görsel imzalar", audit.visualSignatures.join(", "));
  row("Uygulama", "Mühür PDF — tarayıcıda, sunucusuz");

  y -= 10;
  page.drawLine({ start: { x: left, y }, end: { x: 595.28 - left, y }, thickness: 0.6, color: P.rgb(0.85, 0.84, 0.82) });
  y -= 22;
  const note = "Bu belge PAdES uyumlu (adbe.pkcs7.detached) dijital imza ile imzalanmıştır. İmza, bu sayfa dahil " +
    "belgenin tamamını kapsar; imzadan sonra yapılan her değişiklik PDF okuyucuların imza panelinde görünür. " +
    "Öz-imzalı sertifikalar kimliği bir sertifika otoritesi üzerinden kanıtlamaz; kimlik doğrulaması için " +
    "sertifika parmak izini imzalayanla karşılaştırın.";
  for (const ln of wrapText(note, 595.28 - left * 2, (s) => reg.widthOfTextAtSize(s, 9))) {
    page.drawText(ln, { x: left, y, size: 9, font: reg, color: mute });
    y -= 13;
  }
  return page;
}

export async function auditInfo({ docName, docId, pageCount, contentBytes, user, identityInfo, reason, location, visualSignatures }) {
  const now = new Date();
  return {
    documentName: docName,
    documentId: docId,
    pageCount,
    contentHash: await sha256Hex(contentBytes),
    signerName: user.name,
    signerEmail: user.email,
    certificateLabel: identityInfo ? (identityInfo.selfSigned ? "Öz-imzalı (Mühür) · " : "") + identityInfo.issuerName + " · " + identityInfo.keyLabel : "—",
    certificateFingerprint: identityInfo ? identityInfo.fingerprint : "—",
    time: formatDateTime(now) + " (" + tzLabel(now) + ")",
    reason, location, visualSignatures,
  };
}

/* ========================== Library operations ========================== */
export async function imagesToPdf(files) {
  const P = lib();
  const doc = await P.PDFDocument.create();
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let img;
    if (/png$/i.test(file.type)) img = await doc.embedPng(bytes);
    else if (/jpe?g$/i.test(file.type)) img = await doc.embedJpg(bytes);
    else img = await doc.embedPng(await reencodeAsPng(file));
    // fit on A4 in the image's orientation, 24pt margin
    const landscape = img.width > img.height;
    const [pw, ph] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    const s = Math.min((pw - 48) / img.width, (ph - 48) / img.height, 1);
    const w = img.width * s, h = img.height * s;
    const page = doc.addPage([pw, ph]);
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  doc.setProducer("Mühür PDF (pdf-lib)");
  return doc.save({ useObjectStreams: false });
}

async function reencodeAsPng(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function mergePdfs(list) {
  const P = lib();
  const out = await P.PDFDocument.create();
  for (const bytes of list) {
    const src = await P.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  out.setProducer("Mühür PDF (pdf-lib)");
  return out.save({ useObjectStreams: false });
}

export async function blankPdf(width, height) {
  const P = lib();
  const doc = await P.PDFDocument.create();
  doc.addPage([width || 595.28, height || 841.89]);
  doc.setProducer("Mühür PDF (pdf-lib)");
  return doc.save({ useObjectStreams: false });
}

export { rgb as colorOf };
