/* ==========================================================================
   Mühür — editor.js
   The document editor: pages rendered by pdf.js with three layers of our
   own on top (marks, ink, objects), the tools that create them, selection
   with move / resize / rotate, in-place text editing, the page organiser,
   find, undo/redo and autosave.

   Every object lives in display space (points, top-left origin, page
   rotation applied). On screen each length is `calc(var(--s) * Npx)`, so
   zooming only changes --s; on export pdfwork.js maps the same numbers
   back into the PDF.
   ========================================================================== */

import { E, DEFAULTS, STAMPS } from "./ed.js";
import * as store from "./store.js";
import { pdfjs, pdflib, openPdf, fontBytes, forge } from "./libs.js";
import * as W from "./pdfwork.js";
import { $, $$, h, icon, toast, confirmDialog, promptDialog, menu, closeMenu, busy, pickFiles } from "./ui.js";
import { uid, clamp, debounce, formatDate, downloadBytes, safeFileName, rgbToHex } from "./util.js";
import { currentVersion, createDoc, inspectPdf, rasterizePdf, renderThumb } from "./docs.js";
import { hasSignatures, verifyPdf, describeIdentity } from "./sign.js";
import * as panels from "./panels.js";
import * as sigui from "./sigui.js";

const SVGNS = "http://www.w3.org/2000/svg";
const PAD = W.TEXT_PAD;
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const PT_PX = 96 / 72;
const DRAW_TOOLS = new Set(["pen", "marker", "rect", "ellipse", "line", "arrow", "whiteout", "redact", "sigfield", "areahl"]);
const PLACE_TOOLS = new Set(["note", "stamp", "check", "cross", "dot", "date", "image", "signature", "initials"]);
const MARKUP_TOOLS = new Set(["highlight", "underline", "strike"]);
const BOX_TYPES = new Set(["text", "image", "stamp"]);
const RECT_TYPES = new Set(["rect", "ellipse", "whiteout", "redact", "mark"]);

let lib = null;
const dom = {};
let bound = false;
let io = null;
let thumbIO = null;
let history = [];
let future = [];
let onExit = null;
let spaceDown = false;
let editing = null;          // { item, textarea, before, isNew }
let placing = null;          // { template, w, h, then }
let drag = null;             // current pointer interaction
let clipboard = null;
let sigFieldResolve = null;
let find = { q: "", hits: [], index: -1 };
let lastToolInGroup = { markup: "highlight", draw: "pen", shape: "rect", stamp: "stamp", mark: "check" };
const pdfPages = new Map();  // "src:index" -> PDFPageProxy
const textCache = new Map(); // "src:index" -> textContent
const lineCache = new Map(); // pageId -> lines in display space
const thumbCache = new Map();

/* ============================== Utilities =============================== */
const P = (v) => `calc(var(--s) * ${Math.round(v * 1000) / 1000}px)`;
const norm = (r) => ((r % 360) + 360) % 360;
const items = () => E.state.items;
const itemById = (id) => E.state.items.find((i) => i.id === id) || null;
const opts = (tool) => {
  if (!E.toolOpts[tool]) E.toolOpts[tool] = { ...(DEFAULTS[tool] || {}) };
  return E.toolOpts[tool];
};
function svg(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  return el;
}
function pageKey(entry) { return entry.src + ":" + entry.index; }
function isTyping(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem("muhur.tools") || "{}");
    for (const [k, v] of Object.entries(saved)) E.toolOpts[k] = { ...(DEFAULTS[k] || {}), ...v };
  } catch (e) { /* ignore */ }
}
const savePrefs = debounce(() => {
  try { localStorage.setItem("muhur.tools", JSON.stringify(E.toolOpts)); } catch (e) { /* ignore */ }
}, 400);
E.savePrefs = savePrefs;

/* ============================ Text measuring ============================ */
const measureCtx = document.createElement("canvas").getContext("2d");
function cssFamily(f) { return '"' + (W.FONT_FAMILIES[f] || W.FONT_FAMILIES.sans).css + '"'; }
function measurer(it) {
  measureCtx.font = `${it.italic ? "italic " : ""}${it.bold ? 700 : 400} 100px ${cssFamily(it.font)}`;
  if ("fontKerning" in measureCtx) measureCtx.fontKerning = "none";
  const size = it.size || 12;
  return (s) => (measureCtx.measureText(s).width / 100) * size;
}
function textLines(it) {
  if (it.autoW) return String(it.text || "").split("\n");
  return W.wrapText(it.text, it.w - PAD * 2, measurer(it));
}
function measureTextItem(it) {
  const m = measurer(it);
  const lines = textLines(it);
  if (it.autoW) it.w = Math.max(...lines.map((l) => m(l)), (it.size || 12) * 0.5) + PAD * 2 + 1;
  it.h = Math.max(1, lines.length) * (it.size || 12) * W.LINE_HEIGHT + PAD * 2;
  return lines;
}
E.measureText = measureTextItem;

async function loadFonts(list) {
  const want = list || [["sans", false, false], ["sans", true, false]];
  await Promise.all(want.map(([f, b, i]) => document.fonts.load(`${i ? "italic " : ""}${b ? 700 : 400} 16px ${cssFamily(f)}`).catch(() => null)));
}
async function loadFontsForItems() {
  const set = new Map();
  for (const it of items()) {
    if (it.type === "text") set.set(it.font + it.bold + it.italic, [it.font || "sans", !!it.bold, !!it.italic]);
  }
  await loadFonts([["sans", false, false], ["sans", true, false], ...set.values()]);
}

/* =============================== Geometry =============================== */
function pageGeom(entry) {
  if (!entry.src) {
    const rot = norm(entry.rotate || 0);
    const [w, h] = rot % 180 ? [entry.h, entry.w] : [entry.w, entry.h];
    return { rot, w, h };
  }
  const pp = pdfPages.get(pageKey(entry));
  const rot = norm(pp.rotate + (entry.rotate || 0));
  const vp = pp.getViewport({ scale: 1, rotation: rot });
  return { rot, w: vp.width, h: vp.height, vp, pp };
}

async function ensurePdfPage(entry) {
  if (!entry.src) return null;
  const key = pageKey(entry);
  if (!pdfPages.has(key)) {
    const src = E.sources.get(entry.src);
    pdfPages.set(key, await src.pdf.getPage(entry.index + 1));
  }
  return pdfPages.get(key);
}

function bbox(it) {
  switch (it.type) {
    case "path": {
      const xs = it.points.map((p) => p[0]);
      const ys = it.points.map((p) => p[1]);
      const pad = (it.width || 1) / 2;
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
    }
    case "line": {
      const pad = Math.max(it.width || 1, it.head ? Math.max(8, it.width * 3.2) : 0) / 2;
      const x = Math.min(it.x1, it.x2) - pad, y = Math.min(it.y1, it.y2) - pad;
      return { x, y, w: Math.abs(it.x2 - it.x1) + pad * 2, h: Math.abs(it.y2 - it.y1) + pad * 2 };
    }
    case "highlight": {
      const xs = it.rects.map((r) => r[0]), ys = it.rects.map((r) => r[1]);
      const x2 = it.rects.map((r) => r[0] + r[2]), y2 = it.rects.map((r) => r[1] + r[3]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...x2) - x, h: Math.max(...y2) - y };
    }
    case "note": return { x: it.x, y: it.y, w: 20, h: 20 };
    default: return { x: it.x, y: it.y, w: it.w, h: it.h };
  }
}

function rotPoint(x, y, cx, cy, deg) {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

function aabb(it) {
  const b = bbox(it);
  if (!it.rotation) return b;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => rotPoint(x, y, cx, cy, it.rotation));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/* =============================== PageView =============================== */
class PageView {
  constructor(entry) {
    this.entry = entry;
    this.id = entry.id;
    this.sig = sigOf(entry);
    this.el = h("div.pv", { dataset: { pageId: entry.id } });
    this.label = h("span.pv__label");
    this.page = h("div.page");
    this.canvas = h("canvas.page__canvas", { "aria-hidden": "true" });
    this.covers = h("div.page__covers");
    this.marks = h("div.page__marks");
    this.textLayer = h("div.textLayer");
    this.ink = svg("svg", { class: "page__ink", preserveAspectRatio: "none" });
    this.objs = h("div.page__objs");
    this.forms = h("div.page__forms");
    this.deco = h("div.page__deco");
    this.ui = h("div.page__ui");
    this.page.append(this.canvas, this.covers, this.marks, this.textLayer, this.ink, this.objs, this.forms, this.deco, this.ui);
    this.el.append(this.label, this.page);
    this.renderedScale = 0;
    this.task = null;
    this.textDone = false;
    this.formsDone = false;
    this.visible = false;
  }

  layout() {
    const g = pageGeom(this.entry);
    this.g = g;
    this.page.style.width = g.w * E.scale + "px";
    this.page.style.height = g.h * E.scale + "px";
    this.page.style.setProperty("--s", E.scale);
    this.page.style.setProperty("--total-scale-factor", E.scale);
    this.ink.setAttribute("viewBox", `0 0 ${g.w} ${g.h}`);
  }

  async draw() {
    if (this.renderedScale === E.scale || !this.el.isConnected) return;
    const g = this.g;
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    const maxPixels = 14e6;
    if (g.w * E.scale * ratio * g.h * E.scale * ratio > maxPixels) ratio = Math.sqrt(maxPixels / (g.w * E.scale * g.h * E.scale));
    const scale = E.scale * ratio;
    if (this.task) { try { this.task.cancel(); } catch (e) { /* done */ } }
    const target = document.createElement("canvas");
    target.width = Math.max(1, Math.round(g.w * scale));
    target.height = Math.max(1, Math.round(g.h * scale));
    if (this.entry.src) {
      const vp = g.pp.getViewport({ scale, rotation: g.rot });
      this.task = g.pp.render({ canvas: target, viewport: vp, annotationMode: lib.AnnotationMode.ENABLE_FORMS, background: "#ffffff" });
      try {
        await this.task.promise;
      } catch (err) {
        if (err && err.name === "RenderingCancelledException") return;
        throw err;
      } finally {
        this.task = null;
      }
    } else {
      const c = target.getContext("2d");
      c.fillStyle = "#fff";
      c.fillRect(0, 0, target.width, target.height);
    }
    // swap in one go so a zoom never shows a blank page
    this.canvas.width = target.width;
    this.canvas.height = target.height;
    this.canvas.getContext("2d").drawImage(target, 0, 0);
    target.width = 0;
    this.canvasScale = scale;
    this.renderedScale = E.scale;
  }

  async drawText() {
    if (this.textDone || !this.entry.src) return;
    this.textDone = true;
    const tc = await textContent(this.entry);
    const layer = new lib.TextLayer({ textContentSource: tc, container: this.textLayer, viewport: this.g.pp.getViewport({ scale: 1, rotation: this.g.rot }) });
    await layer.render();
  }

  release() {
    if (this.task) { try { this.task.cancel(); } catch (e) { /* done */ } }
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.renderedScale = 0;
  }
}

function sigOf(entry) { return [entry.src, entry.index, entry.rotate || 0, entry.w || 0, entry.h || 0].join("|"); }

async function textContent(entry) {
  const key = pageKey(entry);
  if (!textCache.has(key)) textCache.set(key, (await ensurePdfPage(entry)).getTextContent());
  return textCache.get(key);
}

/* ============================ Render queue ============================== */
const queue = new Set();
let active = 0;
function requestDraw(pv) {
  if (pv.renderedScale === E.scale) return;
  queue.add(pv);
  pump();
}
function pump() {
  while (active < 2 && queue.size) {
    const st = dom.stage.getBoundingClientRect();
    const mid = st.top + st.height / 2;
    let best = null, bestD = Infinity;
    for (const pv of queue) {
      if (!pv.el.isConnected) { queue.delete(pv); continue; }
      const r = pv.el.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestD) { best = pv; bestD = d; }
    }
    if (!best) return;
    queue.delete(best);
    active++;
    best.draw().catch((e) => console.warn(e)).finally(() => { active--; pump(); });
  }
}

/* ============================== Pages DOM =============================== */
function syncPages() {
  const keep = new Map();
  for (const entry of E.state.pages) {
    const old = E.views.get(entry.id);
    if (old && old.sig === sigOf(entry)) { old.entry = entry; keep.set(entry.id, old); } else if (old) { old.release(); }
  }
  for (const [id, pv] of E.views) if (!keep.has(id)) { pv.release(); io.unobserve(pv.el); pv.el.remove(); }
  E.views.clear();
  const frag = document.createDocumentFragment();
  E.state.pages.forEach((entry, i) => {
    let pv = keep.get(entry.id);
    if (!pv) {
      pv = new PageView(entry);
      pv.layout();
      io.observe(pv.el);
    }
    pv.label.textContent = i + 1;
    E.views.set(entry.id, pv);
    frag.append(pv.el);
  });
  dom.pages.append(frag);
  for (const pv of E.views.values()) { renderItems(pv); renderDeco(pv); }
  if (!E.views.has(E.current)) E.current = E.state.pages[0] && E.state.pages[0].id;
  dom.pageTotal.textContent = "/ " + E.state.pages.length;
  updatePager();
}

function setupObserver() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const pv = E.views.get(en.target.dataset.pageId);
      if (!pv) continue;
      pv.visible = en.isIntersecting;
      if (en.isIntersecting) {
        requestDraw(pv);
        pv.drawText().catch(() => null);
        if (!pv.formsDone) renderForms(pv).catch((e) => console.warn(e));
      } else {
        queue.delete(pv);
        pv.release();
      }
    }
  }, { root: dom.stage, rootMargin: "120% 0px" });
}

/* ================================ Zoom ================================== */
function fitWidthScale() {
  const avail = dom.stage.clientWidth - 64;
  const maxW = Math.max(...E.state.pages.map((p) => pageGeom(p).w), 100);
  return avail / maxW;
}
function fitPageScale() {
  const pv = E.views.get(E.current) || [...E.views.values()][0];
  const g = pageGeom(pv.entry);
  return Math.min((dom.stage.clientWidth - 64) / g.w, (dom.stage.clientHeight - 56) / g.h);
}

function setZoom(scale, anchor) {
  scale = clamp(scale, 0.15, 8);
  const st = dom.stage;
  const rect = st.getBoundingClientRect();
  const ax = anchor ? anchor.x - rect.left : st.clientWidth / 2;
  const ay = anchor ? anchor.y - rect.top : st.clientHeight / 2;
  // remember which page point sits under the anchor
  let ref = null;
  for (const pv of E.views.values()) {
    const r = pv.page.getBoundingClientRect();
    if (r.top - 9 <= rect.top + ay && r.bottom + 9 >= rect.top + ay) {
      ref = { pv, x: (rect.left + ax - r.left) / E.scale, y: (rect.top + ay - r.top) / E.scale };
      break;
    }
  }
  E.scale = scale;
  for (const pv of E.views.values()) pv.layout();
  if (ref) {
    const r = ref.pv.page.getBoundingClientRect();
    st.scrollTop += r.top + ref.y * scale - (rect.top + ay);
    st.scrollLeft += r.left + ref.x * scale - (rect.left + ax);
  }
  dom.zoomBtn.textContent = Math.round((scale / PT_PX) * 100) + "%";
  redrawVisible();
  renderSelectionAll();
}
const redrawVisible = debounce(() => { for (const pv of E.views.values()) if (pv.visible) requestDraw(pv); }, 140);

function zoomStep(dir) {
  const pct = E.scale / PT_PX;
  const next = dir > 0 ? ZOOMS.find((z) => z > pct + 0.01) : [...ZOOMS].reverse().find((z) => z < pct - 0.01);
  if (next) setZoom(next * PT_PX);
}

function zoomMenu() {
  menu(dom.zoomBtn, [
    ...ZOOMS.map((z) => ({ label: Math.round(z * 100) + "%", active: Math.abs(E.scale / PT_PX - z) < 0.005, onClick: () => setZoom(z * PT_PX) })),
    "sep",
    { label: "Sayfa genişliğine sığdır", icon: "move-horizontal", onClick: () => setZoom(fitWidthScale()) },
    { label: "Sayfaya sığdır", icon: "maximize", onClick: () => setZoom(fitPageScale()) },
  ]);
}

/* =========================== Current page / pager ======================= */
const onScroll = () => {
  if (onScroll.raf) return;
  onScroll.raf = requestAnimationFrame(() => {
    onScroll.raf = 0;
    const st = dom.stage.getBoundingClientRect();
    const line = st.top + st.height * 0.4;
    let cur = null;
    for (const pv of E.views.values()) {
      const r = pv.el.getBoundingClientRect();
      if (r.top <= line) cur = pv; else break;
    }
    cur = cur || [...E.views.values()][0];
    if (cur && cur.id !== E.current) { E.current = cur.id; updatePager(); }
  });
};

function updatePager() {
  const idx = E.state.pages.findIndex((p) => p.id === E.current);
  dom.pageInput.value = idx + 1;
  for (const pv of E.views.values()) pv.page.classList.toggle("is-current", pv.id === E.current);
  $$(".thumb", dom.thumbs).forEach((t) => t.classList.toggle("is-current", t.dataset.pageId === E.current));
  const cur = dom.thumbs.querySelector(".thumb.is-current");
  if (cur && !drag) {
    const tr = cur.getBoundingClientRect();
    const lr = dom.thumbs.getBoundingClientRect();
    if (tr.top < lr.top || tr.bottom > lr.bottom) cur.scrollIntoView({ block: "nearest" });
  }
}

function scrollToPage(pageId, y) {
  const pv = E.views.get(pageId);
  if (!pv) return;
  const top = pv.el.offsetTop - 18 + (y ? y * E.scale - dom.stage.clientHeight / 3 : 0);
  dom.stage.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  E.current = pageId;
  updatePager();
}
E.scrollToPage = scrollToPage;
E.pageIndex = (id) => E.state.pages.findIndex((p) => p.id === id);
E.item = itemById;

/* ============================ Item rendering ============================ */
function renderItems(pv) {
  pv.covers.textContent = "";
  pv.marks.textContent = "";
  pv.objs.textContent = "";
  pv.ink.textContent = "";
  let marker = null;
  for (const it of items()) {
    if (it.page !== pv.id) continue;
    if (editing && editing.item.id === it.id) {
      // keep the live editor element instead of rebuilding it
      if (it.cover) pv.covers.append(coverEl(it));
      pv.objs.append(editing.el);
      continue;
    }
    switch (it.type) {
      case "text":
        if (it.cover) pv.covers.append(coverEl(it));
        pv.objs.append(textEl(it));
        break;
      case "image": pv.objs.append(imageEl(it)); break;
      case "stamp": pv.objs.append(stampEl(it)); break;
      case "note": pv.objs.append(noteEl(it)); break;
      case "highlight": for (const el of highlightEls(it)) pv.marks.append(el); break;
      case "whiteout": pv.marks.append(boxDiv(it, "white-box", { background: it.color || "#fff" })); break;
      case "redact": pv.marks.append(boxDiv(it, "redact-box")); break;
      case "path":
        if (it.blend === "multiply") {
          if (!marker) { marker = svg("svg", { class: "page__marker", viewBox: `0 0 ${pv.g.w} ${pv.g.h}`, preserveAspectRatio: "none" }); pv.marks.append(marker); }
          marker.append(inkEl(it));
        } else pv.ink.append(inkEl(it));
        break;
      default: pv.ink.append(inkEl(it));
    }
  }
  renderSelection(pv);
  markThumb(pv.id);
}
E.renderPage = (pageId) => { const pv = E.views.get(pageId); if (pv) renderItems(pv); };
E.renderAll = () => { for (const pv of E.views.values()) { renderItems(pv); renderDeco(pv); } };

function boxStyle(it) {
  return { left: P(it.x), top: P(it.y), width: P(it.w), height: P(it.h), transform: it.rotation ? `rotate(${it.rotation}deg)` : "", opacity: it.opacity == null ? "" : it.opacity };
}

function coverEl(it) {
  const c = it.cover;
  return h("div.cover", { style: { left: P(c.x), top: P(c.y), width: P(c.w), height: P(c.h), background: c.color || "#fff" } });
}

function textEl(it) {
  const lines = textLines(it);
  const el = h("div.it.it--text", { dataset: { id: it.id }, style: boxStyle(it) });
  Object.assign(el.style, {
    fontFamily: cssFamily(it.font) + ", sans-serif",
    fontWeight: it.bold ? 700 : 400,
    fontStyle: it.italic ? "italic" : "normal",
    fontSize: P(it.size || 12),
    color: it.color || "#000",
    background: it.bg || "",
    padding: P(PAD),
    textAlign: it.align || "left",
  });
  el.style.setProperty("--lead", (it.size || 12) * W.LINE_HEIGHT);
  for (const ln of lines) el.append(h("div.ln", { text: ln || "​" }));
  return el;
}

function imageEl(it) {
  const el = h("div.it.it--image", { dataset: { id: it.id }, style: boxStyle(it) });
  el.append(h("img", { src: E.state.assets[it.asset] || "", alt: "", draggable: "false" }));
  return el;
}

function stampGeometry(it) {
  const hasSub = !!it.sub;
  const lw = Math.max(1.5, it.h * 0.05);
  return { lw, rad: Math.min(it.h * 0.18, 8), main: hasSub ? it.h * 0.42 : it.h * 0.55, sub: it.h * 0.2, hasSub };
}

function stampEl(it) {
  const g = stampGeometry(it);
  const el = h("div.it.it--stamp", { dataset: { id: it.id }, style: boxStyle(it) });
  Object.assign(el.style, {
    borderWidth: P(g.lw), borderRadius: P(g.rad), borderColor: it.color, color: it.color,
    opacity: it.opacity == null ? 0.9 : it.opacity, gap: P(it.h * 0.04),
  });
  const m = measurer({ font: "sans", bold: true, size: 1 });
  const fit = Math.min(g.main, (it.w - g.lw * 6) / Math.max(1, m(it.text)));
  el.append(h("b", { text: it.text, style: { fontSize: P(fit) } }));
  if (g.hasSub) {
    const ms = measurer({ font: "sans", size: 1 });
    el.append(h("span", { text: it.sub, style: { fontSize: P(Math.min(g.sub, (it.w - g.lw * 6) / Math.max(1, ms(it.sub)))) } }));
  }
  return el;
}

function noteEl(it) {
  return h("div.it.it--note", {
    dataset: { id: it.id }, title: it.text || "Not",
    style: { left: P(it.x), top: P(it.y), width: P(20), height: P(20), background: it.color || "#f5c518" },
    html: icon("message-square-text"),
  });
}

function boxDiv(it, cls, style) {
  return h("div." + cls, { dataset: { id: it.id }, style: { left: P(it.x), top: P(it.y), width: P(it.w), height: P(it.h), ...(style || {}) } });
}

function highlightEls(it) {
  return it.rects.map(([x, y, w, hh]) => {
    if (it.style === "underline" || it.style === "strike") {
      const t = Math.max(0.8, hh * 0.07);
      const ly = it.style === "underline" ? y + hh * 0.94 - t / 2 : y + hh * 0.56;
      const el = h("div.hl", { dataset: { id: it.id }, style: { left: P(x), top: P(y), width: P(w), height: P(hh) } });
      el.append(h("div", { style: { position: "absolute", left: 0, right: 0, top: P(ly - y - t / 2), height: P(t), background: it.color } }));
      return el;
    }
    return h("div.hl.hl--highlight", { dataset: { id: it.id }, style: { left: P(x), top: P(y), width: P(w), height: P(hh), background: it.color, opacity: it.opacity == null ? "" : it.opacity } });
  });
}

function smoothD(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0][0]} ${points[0][1]}l0.01 0`;
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = points[points.length - 1];
  return d + `L${last[0]} ${last[1]}`;
}

function inkEl(it) {
  const g = svg("g", { "data-id": it.id, opacity: it.opacity == null ? null : it.opacity });
  const stroke = (el, color, width, dash) => {
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-width", width);
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    if (dash) el.setAttribute("stroke-dasharray", `${width * 3} ${width * 2}`);
  };
  const hit = (el, width) => {
    el.setAttribute("class", "ink-hit");
    el.setAttribute("stroke-width", Math.max(width + 6, 10));
    return el;
  };
  switch (it.type) {
    case "path": {
      const d = smoothD(it.points);
      const p = svg("path", { d, fill: "none" });
      stroke(p, it.color, it.width);
      g.append(p, hit(svg("path", { d, fill: "none" }), it.width));
      break;
    }
    case "line": {
      const l = svg("line", { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2 });
      stroke(l, it.color, it.width, it.dash);
      g.append(l);
      if (it.head) {
        const pts = W.arrowHead(it.x1, it.y1, it.x2, it.y2, it.width);
        const poly = svg("polygon", { points: pts.map((p) => p.join(",")).join(" "), fill: it.color });
        stroke(poly, it.color, it.width);
        g.append(poly);
      }
      g.append(hit(svg("line", { x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2 }), it.width));
      break;
    }
    case "rect":
    case "ellipse": {
      const sw = it.stroke ? it.width || 1 : 0;
      const x = it.x + sw / 2, y = it.y + sw / 2, w = Math.max(0.1, it.w - sw), hh = Math.max(0.1, it.h - sw);
      const shape = it.type === "rect" ? svg("rect", { x, y, width: w, height: hh }) : svg("ellipse", { cx: x + w / 2, cy: y + hh / 2, rx: w / 2, ry: hh / 2 });
      shape.setAttribute("fill", it.fill || "none");
      if (it.stroke) { stroke(shape, it.stroke, sw, it.dash); shape.setAttribute("stroke-linecap", "butt"); }
      const hs = shape.cloneNode();
      hs.setAttribute("fill", "transparent");
      g.append(shape, hit(hs, sw));
      break;
    }
    case "mark": {
      const { x, y, w } = it;
      if (it.glyph === "dot") {
        g.append(svg("circle", { cx: x + w / 2, cy: y + it.h / 2, r: w / 4, fill: it.color }));
      } else {
        let d = "";
        let start = true;
        for (const p of W.MARK_PATHS[it.glyph] || W.MARK_PATHS.check) {
          if (!p) { start = true; continue; }
          d += (start ? "M" : "L") + (x + p[0] * w) + " " + (y + p[1] * it.h);
          start = false;
        }
        const p = svg("path", { d, fill: "none" });
        stroke(p, it.color, Math.max(1, w * 0.11));
        g.append(p);
      }
      const r = svg("rect", { x, y, width: w, height: it.h, fill: "transparent" });
      r.setAttribute("class", "ink-hit");
      g.append(r);
      break;
    }
    default: break;
  }
  return g;
}

/* --------------------------- watermark & numbers ------------------------ */
function renderDeco(pv) {
  pv.deco.textContent = "";
  const wm = E.state.watermark;
  if (wm && wm.text) {
    const m = measurer({ font: "sans", bold: true, size: wm.size || 64 });
    const tw = m(wm.text);
    pv.deco.append(h("div.deco-wm", {
      text: wm.text,
      style: {
        width: P(tw), height: P(wm.size || 64), marginLeft: P(-tw / 2), marginTop: P(-(wm.size || 64) / 2),
        fontSize: P(wm.size || 64), color: wm.color || "#c0352b", opacity: wm.opacity == null ? 0.18 : wm.opacity,
        transform: `rotate(${-(wm.angle == null ? 45 : wm.angle)}deg)`, lineHeight: P(wm.size || 64),
      },
    }));
  }
  const pn = E.state.pageNumbers;
  const idx = E.pageIndex(pv.id);
  if (pn && !(pn.skipFirst && idx === 0)) {
    const size = pn.size || 10;
    const text = W.pageNumberText(pn, idx, E.state.pages.length);
    const tw = measurer({ font: "sans", size })(text);
    const { x, y } = W.pageNumberBox(pn, tw, size, pv.g.w, pv.g.h);
    pv.deco.append(h("div.deco-pn", { text, style: { left: P(x), top: P(y), fontSize: P(size), color: pn.color || "#333" } }));
  }
}
E.renderDeco = () => { for (const pv of E.views.values()) renderDeco(pv); };

/* ============================== Selection =============================== */
function select(id) {
  if (editing && (!id || editing.item.id !== id)) finishEdit();
  const prev = E.selection;
  E.selection = id && itemById(id) ? id : null;
  if (prev) { const it = itemById(prev); if (it) { const pv = E.views.get(it.page); if (pv) renderSelection(pv); } }
  if (E.selection) { const pv = E.views.get(itemById(E.selection).page); if (pv) renderSelection(pv); }
  panels.renderProps();
  panels.syncComments();
}
E.select = select;

function renderSelectionAll() { for (const pv of E.views.values()) renderSelection(pv); }

function renderSelection(pv) {
  $$(".sel, .sel__bar", pv.ui).forEach((n) => n.remove());
  $$(".is-selected", pv.ink).forEach((n) => n.classList.remove("is-selected"));
  const it = E.selection && itemById(E.selection);
  if (!it || it.page !== pv.id) return;
  if (E.tool !== "select" && !(editing && editing.item.id === it.id)) return;
  const b = bbox(it);
  const sel = h("div.sel", { style: { left: P(b.x), top: P(b.y), width: P(b.w), height: P(b.h), transform: it.rotation ? `rotate(${it.rotation}deg)` : "" } });
  const handles = handleSet(it);
  if (it.type === "line") {
    sel.classList.add("sel--soft");
    sel.style.border = "0";
    pv.ui.append(h("div.sel", { style: { left: 0, top: 0, width: 0, height: 0, border: 0 } },
      h("span.sel__h", { dataset: { h: "p1" }, style: { left: P(it.x1), top: P(it.y1) } }),
      h("span.sel__h", { dataset: { h: "p2" }, style: { left: P(it.x2), top: P(it.y2) } })));
  } else {
    for (const k of handles) sel.append(h("span.sel__h", { dataset: { h: k } }));
    if (BOX_TYPES.has(it.type)) sel.append(h("span.sel__stem"), h("span.sel__h", { dataset: { h: "rot" } }));
    if (it.type === "highlight") sel.classList.add("sel--soft");
    pv.ui.append(sel);
  }
  if (!(editing && editing.item.id === it.id)) {
    const box = aabb(it);
    const bar = selBar(it);
    bar.style.left = P(box.x + box.w / 2);
    bar.style.top = P(box.y);
    bar.style.bottom = "auto";
    bar.style.transform = "translate(-50%, calc(-100% - " + (BOX_TYPES.has(it.type) ? 38 : 10) + "px))";
    if (box.y * E.scale < 60) { bar.style.top = P(box.y + box.h); bar.style.transform = "translate(-50%, 12px)"; }
    pv.ui.append(bar);
  }
  const g = pv.ink.querySelector(`[data-id="${it.id}"]`);
  if (g) g.classList.add("is-selected");
}

function handleSet(it) {
  if (it.type === "text") return ["w", "e"];
  if (it.type === "note" || it.type === "highlight") return [];
  if (it.type === "path") return ["nw", "ne", "se", "sw"];
  return ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
}

function selBar(it) {
  const bar = h("div.sel__bar");
  const add = (name, tip, fn) => bar.append(h("button.ibtn", { type: "button", "aria-label": tip, title: tip, html: icon(name), onclick: (e) => { e.stopPropagation(); fn(); } }));
  if (it.type === "text") add("pencil", "Metni düzenle", () => startEdit(it));
  if (it.type === "note") add("pencil", "Notu düzenle", () => openNote(it));
  add("copy", "Çoğalt (Ctrl+D)", () => duplicateSelection());
  add("trash-2", "Sil (Delete)", () => deleteSelection());
  bar.addEventListener("pointerdown", (e) => e.stopPropagation());
  return bar;
}

/* =============================== History =============================== */
function snapshot() {
  const s = E.state;
  return JSON.stringify({ pages: s.pages, items: s.items, forms: s.forms, watermark: s.watermark, pageNumbers: s.pageNumbers, meta: s.meta, metaChanged: s.metaChanged, sources: s.sources });
}
E.snapshot = snapshot;

function commit(before) {
  if (before != null) {
    history.push(before);
    if (history.length > 200) history.shift();
    future = [];
  }
  afterChange();
}
E.commit = commit;

function afterChange() {
  scheduleSave();
  dom.undo.disabled = !history.length;
  dom.redo.disabled = !future.length;
  panels.refresh();
}

async function restore(snap) {
  const o = JSON.parse(snap);
  const pagesChanged = JSON.stringify(o.pages) !== JSON.stringify(E.state.pages);
  Object.assign(E.state, o);
  for (const p of E.state.pages) await ensurePdfPage(p);
  if (E.selection && !itemById(E.selection)) E.selection = null;
  if (pagesChanged) { syncPages(); buildThumbs(); } else { E.renderAll(); }
  refreshForms();
  afterChange();
}
async function undo() {
  if (editing) finishEdit();
  if (!history.length) return;
  future.push(snapshot());
  await restore(history.pop());
}
async function redo() {
  if (!future.length) return;
  history.push(snapshot());
  await restore(future.pop());
}

/* ================================ Save ================================== */
const scheduleSave = debounce(() => saveNow().catch(() => null), 700);
async function saveNow() {
  if (!E.open) return;
  setStatus("saving", "Kaydediliyor…");
  try {
    await store.putState(E.doc.id, E.state);
    E.doc.modified = Date.now();
    E.doc.pages = E.state.pages.length;
    await store.putDoc(E.doc);
    setStatus("saved", "Bu cihaza kaydedildi");
  } catch (err) {
    console.error(err);
    setStatus("error", "Kaydedilemedi");
    toast("Değişiklikler kaydedilemedi: " + (err.message || err), "error");
  }
}
function setStatus(state, text) {
  dom.status.dataset.state = state;
  dom.status.textContent = text;
}
export async function flushEditor() {
  if (!E.open) return;
  if (editing) finishEdit();
  scheduleSave.cancel();
  await saveNow();
}

/* ============================= Item helpers ============================= */
function addItem(it, { select: doSelect = true, before } = {}) {
  const snap = before || snapshot();
  it.id = it.id || uid("i");
  E.state.items.push(it);
  E.renderPage(it.page);
  commit(snap);
  if (doSelect) select(it.id);
  return it;
}

function deleteSelection() {
  const it = E.selection && itemById(E.selection);
  if (!it) return;
  const before = snapshot();
  if (editing && editing.item.id === it.id) { editing.el.remove(); editing = null; }
  E.state.items = E.state.items.filter((x) => x.id !== it.id);
  E.selection = null;
  E.renderPage(it.page);
  commit(before);
  panels.renderProps();
}

function cloneItem(it) { return JSON.parse(JSON.stringify(it)); }

function shiftItem(it, dx, dy) {
  switch (it.type) {
    case "path": it.points = it.points.map(([x, y]) => [x + dx, y + dy]); break;
    case "line": it.x1 += dx; it.y1 += dy; it.x2 += dx; it.y2 += dy; break;
    case "highlight": it.rects = it.rects.map(([x, y, w, hh]) => [x + dx, y + dy, w, hh]); break;
    default: it.x += dx; it.y += dy;
  }
  if (it.cover && it.origin !== "edit") { it.cover.x += dx; it.cover.y += dy; }
}

function duplicateSelection() {
  const it = E.selection && itemById(E.selection);
  if (!it) return;
  const copy = cloneItem(it);
  copy.id = uid("i");
  delete copy.cover;
  delete copy.origin;
  shiftItem(copy, 12, 12);
  addItem(copy);
}

function clampToPage(it) {
  const pv = E.views.get(it.page);
  if (!pv) return;
  const b = aabb(it);
  let dx = 0, dy = 0;
  if (b.x + b.w < 8) dx = 8 - (b.x + b.w);
  if (b.x > pv.g.w - 8) dx = pv.g.w - 8 - b.x;
  if (b.y + b.h < 8) dy = 8 - (b.y + b.h);
  if (b.y > pv.g.h - 8) dy = pv.g.h - 8 - b.y;
  if (dx || dy) shiftItem(it, dx, dy);
}

/* ============================ Pointer events ============================ */
function pagePoint(pv, e) {
  const r = pv.page.getBoundingClientRect();
  return [(e.clientX - r.left) / E.scale, (e.clientY - r.top) / E.scale];
}

function mode() {
  if (spaceDown || E.tool === "hand") return "hand";
  if (placing) return "place";
  if (DRAW_TOOLS.has(E.tool)) return "draw";
  if (MARKUP_TOOLS.has(E.tool)) return "markup";
  if (E.tool === "text") return "text";
  if (E.tool === "edittext") return "edittext";
  if (PLACE_TOOLS.has(E.tool)) return "place";
  return "select";
}
function applyMode() { dom.pages.dataset.mode = mode(); dom.stage.classList.toggle("is-hand", mode() === "hand"); }

function onPointerDown(e) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  if (e.target.closest(".it__edit, .fw, .sel__bar")) return;
  const m = mode();
  if (m === "hand") { startPan(e); return; }
  const pvEl = e.target.closest(".pv");
  if (!pvEl) { if (m === "select" && e.target.closest(".stage")) select(null); return; }
  const pv = E.views.get(pvEl.dataset.pageId);
  const pt = pagePoint(pv, e);
  if (m === "draw") { startDraw(pv, e, pt); return; }
  if (m === "place") { e.preventDefault(); place(pv, pt); return; }
  if (m === "text") {
    const hitEl = e.target.closest(".it--text");
    if (hitEl) { e.preventDefault(); startEdit(itemById(hitEl.dataset.id)); return; }
    e.preventDefault();
    createTextAt(pv, pt);
    return;
  }
  if (m === "edittext") { e.preventDefault(); editTextAt(pv, pt, e); return; }
  if (m === "markup") {
    if (!e.target.closest(".textLayer span")) startDraw(pv, e, pt, "areahl");
    return;
  }
  // select
  const handle = e.target.closest(".sel__h");
  if (handle) { e.preventDefault(); startHandle(pv, e, pt, handle.dataset.h); return; }
  const hitEl = e.target.closest("[data-id]");
  if (hitEl && (pv.objs.contains(hitEl) || pv.ink.contains(hitEl) || pv.marks.contains(hitEl))) {
    e.preventDefault();
    const it = itemById(hitEl.dataset.id);
    if (!it) return;
    const already = E.selection === it.id;
    select(it.id);
    startMove(pv, e, pt, it, already);
    return;
  }
  if (E.selection) select(null);
}

function capture(e) { try { dom.pages.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }

function startPan(e) {
  e.preventDefault();
  const st = dom.stage;
  drag = { kind: "pan", x: e.clientX, y: e.clientY, sl: st.scrollLeft, stp: st.scrollTop };
  st.classList.add("is-panning");
  try { st.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
}

function onPointerMove(e) {
  if (!drag) { hover(e); return; }
  if (drag.kind === "pan") {
    dom.stage.scrollLeft = drag.sl - (e.clientX - drag.x);
    dom.stage.scrollTop = drag.stp - (e.clientY - drag.y);
    return;
  }
  const pt = pagePoint(drag.pv, e);
  drag.move(pt, e);
}

function onPointerUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.kind === "pan") { dom.stage.classList.remove("is-panning"); return; }
  d.up(pagePoint(d.pv, e), e);
}

function hover(e) {
  const m = mode();
  if (m === "place" && placing) {
    const pvEl = e.target.closest && e.target.closest(".pv");
    $$(".ghost").forEach((g) => { if (!pvEl || !pvEl.contains(g)) g.remove(); });
    if (!pvEl) return;
    const pv = E.views.get(pvEl.dataset.pageId);
    const [x, y] = pagePoint(pv, e);
    let ghost = pv.ui.querySelector(".ghost");
    if (!ghost) { ghost = placing.ghost(); ghost.classList.add("ghost"); pv.ui.append(ghost); }
    ghost.style.left = P(x - placing.w / 2);
    ghost.style.top = P(y - placing.h / 2);
    ghost.style.width = P(placing.w);
    ghost.style.height = P(placing.h);
  } else if (m === "edittext") {
    const pvEl = e.target.closest && e.target.closest(".pv");
    $$(".hover-line").forEach((g) => g.remove());
    if (!pvEl || e.target.closest(".it--text")) return;
    const pv = E.views.get(pvEl.dataset.pageId);
    const lines = lineCache.get(pv.id);
    if (!lines) { pageLines(pv).catch(() => null); return; }
    const [x, y] = pagePoint(pv, e);
    const ln = lineAt(lines, x, y);
    if (ln) pv.ui.append(h("div.hover-line", { style: { left: P(ln.x - 1), top: P(ln.top - 1), width: P(ln.w + 2), height: P(ln.h + 2) } }));
  }
}

/* ------------------------------ move/resize ----------------------------- */
function startMove(pv, e, pt, it, wasSelected) {
  capture(e);
  const before = snapshot();
  const orig = cloneItem(it);
  let moved = false;
  drag = {
    pv,
    move: ([x, y], ev) => {
      let dx = x - pt[0], dy = y - pt[1];
      if (!moved && Math.hypot(dx, dy) * E.scale < 3) return;
      if (it.type === "highlight") return;
      moved = true;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      Object.assign(it, cloneItem(orig));
      shiftItem(it, dx, dy);
      clampToPage(it);
      renderItems(pv);
    },
    up: () => {
      if (moved) commit(before);
      else if (wasSelected && it.type === "text") startEdit(it);
      else if (wasSelected && it.type === "note") openNote(it);
    },
  };
}

function startHandle(pv, e, pt, hName) {
  capture(e);
  const it = itemById(E.selection);
  if (!it) return;
  const before = snapshot();
  const orig = cloneItem(it);
  const b0 = bbox(orig);
  const cx = b0.x + b0.w / 2, cy = b0.y + b0.h / 2;
  const lockDefault = it.type === "image" || it.type === "stamp" || it.type === "mark";
  drag = {
    pv,
    move: ([x, y], ev) => {
      Object.assign(it, cloneItem(orig));
      if (hName === "rot") {
        let a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
        a = ev.shiftKey ? Math.round(a / 15) * 15 : Math.round(a);
        for (const snap of [0, 90, 180, 270, 360, -90]) if (Math.abs(a - snap) < 4) a = snap;
        it.rotation = norm(a) || 0;
      } else if (hName === "p1" || hName === "p2") {
        let nx = x, ny = y;
        const ox = hName === "p1" ? orig.x2 : orig.x1, oy = hName === "p1" ? orig.y2 : orig.y1;
        if (ev.shiftKey) {
          const ang = Math.round(Math.atan2(ny - oy, nx - ox) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(nx - ox, ny - oy);
          nx = ox + Math.cos(ang) * len; ny = oy + Math.sin(ang) * len;
        }
        if (hName === "p1") { it.x1 = nx; it.y1 = ny; } else { it.x2 = nx; it.y2 = ny; }
      } else {
        resizeBox(it, orig, b0, hName, x - pt[0], y - pt[1], lockDefault !== ev.shiftKey);
      }
      renderItems(pv);
    },
    up: () => {
      if (it.type === "text") measureTextItem(it);
      renderItems(pv);
      commit(before);
      panels.renderProps();
    },
  };
}

function resizeBox(it, orig, b0, hName, dx, dy, lock) {
  const rot = orig.rotation || 0;
  const [ldx, ldy] = rotPoint(dx, dy, 0, 0, -rot);
  let l = 0, t = 0, r = b0.w, btm = b0.h;
  if (hName.includes("w")) l += ldx;
  if (hName.includes("e")) r += ldx;
  if (hName.includes("n")) t += ldy;
  if (hName.includes("s")) btm += ldy;
  const min = it.type === "text" ? (orig.size || 12) : 4;
  let w = Math.max(min, r - l), hh = Math.max(4, btm - t);
  if (hName.includes("w")) l = r - w; else r = l + w;
  if (hName.includes("n")) t = btm - hh; else btm = t + hh;
  if (lock && hName.length === 2 && b0.w && b0.h) {
    const ratio = b0.w / b0.h;
    if (w / hh > ratio) w = hh * ratio; else hh = w / ratio;
    if (hName.includes("w")) l = r - w; else r = l + w;
    if (hName.includes("n")) t = btm - hh; else btm = t + hh;
  }
  if (it.type === "text") {
    it.autoW = false;
    it.w = w;
    const [ncx, ncy] = rotPoint(l + w / 2 - b0.w / 2, 0, 0, 0, rot);
    it.x = b0.x + b0.w / 2 + ncx - w / 2;
    it.y = orig.y + ncy;
    measureTextItem(it);
    return;
  }
  // new centre, back in page space
  const [ox, oy] = rotPoint((l + r) / 2 - b0.w / 2, (t + btm) / 2 - b0.h / 2, 0, 0, rot);
  const ncx = b0.x + b0.w / 2 + ox, ncy = b0.y + b0.h / 2 + oy;
  if (it.type === "path") {
    const sx = w / b0.w, sy = hh / b0.h;
    const nx = ncx - w / 2, ny = ncy - hh / 2;
    it.points = orig.points.map(([px, py]) => [nx + (px - b0.x) * sx, ny + (py - b0.y) * sy]);
    return;
  }
  it.x = ncx - w / 2;
  it.y = ncy - hh / 2;
  it.w = w;
  it.h = hh;
}

/* -------------------------------- drawing ------------------------------- */
function startDraw(pv, e, pt, override) {
  e.preventDefault();
  capture(e);
  const tool = override || E.tool;
  const o = opts(tool === "areahl" ? E.tool : tool);
  const clampPt = ([x, y]) => [clamp(x, 0, pv.g.w), clamp(y, 0, pv.g.h)];
  if (tool === "pen" || tool === "marker") {
    const points = [pt];
    const tmp = svg("svg", { class: "page__ink", viewBox: `0 0 ${pv.g.w} ${pv.g.h}`, preserveAspectRatio: "none" });
    tmp.style.pointerEvents = "none";
    if (tool === "marker") tmp.style.mixBlendMode = "multiply";
    const path = svg("path", { fill: "none", stroke: o.color, "stroke-width": o.width, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: o.opacity });
    tmp.append(path);
    pv.ui.append(tmp);
    drag = {
      pv,
      move: (p) => {
        const last = points[points.length - 1];
        const q = clampPt(p);
        if (Math.hypot(q[0] - last[0], q[1] - last[1]) * E.scale < 1.5) return;
        points.push(q);
        path.setAttribute("d", smoothD(points));
      },
      up: () => {
        tmp.remove();
        const simple = simplify(points, 0.35);
        addItem({ type: "path", page: pv.id, points: simple.map(([x, y]) => [round2(x), round2(y)]), color: o.color, width: o.width, opacity: o.opacity, blend: tool === "marker" ? "multiply" : null }, { select: false });
      },
    };
    return;
  }
  const draft = h("div.draft");
  if (tool === "sigfield") draft.className = "sigfield";
  pv.ui.append(draft);
  let end = pt;
  const rectOf = (a, b, square) => {
    let x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), hh = Math.abs(b[1] - a[1]);
    if (square) { const s = Math.max(w, hh); x = b[0] < a[0] ? a[0] - s : a[0]; y = b[1] < a[1] ? a[1] - s : a[1]; w = hh = s; }
    return { x, y, w, h: hh };
  };
  let lineEl = null;
  if (tool === "line" || tool === "arrow") {
    draft.remove();
    lineEl = svg("svg", { class: "page__ink", viewBox: `0 0 ${pv.g.w} ${pv.g.h}`, preserveAspectRatio: "none" });
    lineEl.append(svg("line", { stroke: o.color, "stroke-width": o.width, "stroke-linecap": "round" }));
    pv.ui.append(lineEl);
  }
  drag = {
    pv,
    move: (p, ev) => {
      end = clampPt(p);
      if (lineEl) {
        if (ev.shiftKey) {
          const ang = Math.round(Math.atan2(end[1] - pt[1], end[0] - pt[0]) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(end[0] - pt[0], end[1] - pt[1]);
          end = [pt[0] + Math.cos(ang) * len, pt[1] + Math.sin(ang) * len];
        }
        const l = lineEl.firstChild;
        l.setAttribute("x1", pt[0]); l.setAttribute("y1", pt[1]); l.setAttribute("x2", end[0]); l.setAttribute("y2", end[1]);
        return;
      }
      const r = rectOf(pt, end, ev.shiftKey && (tool === "rect" || tool === "ellipse"));
      Object.assign(draft.style, { left: P(r.x), top: P(r.y), width: P(r.w), height: P(r.h) });
    },
    up: (p, ev) => {
      draft.remove();
      if (lineEl) lineEl.remove();
      const tiny = Math.hypot(end[0] - pt[0], end[1] - pt[1]) * E.scale < 4;
      if (tool === "line" || tool === "arrow") {
        if (tiny) return;
        addItem({ type: "line", page: pv.id, x1: pt[0], y1: pt[1], x2: end[0], y2: end[1], color: o.color, width: o.width, opacity: o.opacity, dash: o.dash, head: tool === "arrow" ? "end" : null });
        setTool("select");
        return;
      }
      let r = rectOf(pt, end, ev && ev.shiftKey && (tool === "rect" || tool === "ellipse"));
      if (tool === "sigfield") {
        if (tiny) r = { x: pt[0] - 90, y: pt[1] - 30, w: 180, h: 60 };
        const done = sigFieldResolve;
        sigFieldResolve = null;
        setTool("select");
        if (done) done({ pageId: pv.id, rect: r });
        return;
      }
      if (tool === "areahl") {
        if (tiny) return;
        addItem({ type: "highlight", page: pv.id, rects: [[r.x, r.y, r.w, r.h]], style: E.tool, color: o.color, text: "" }, { select: false });
        return;
      }
      if (tiny) r = { x: pt[0], y: pt[1], w: tool === "redact" || tool === "whiteout" ? 120 : 100, h: tool === "redact" || tool === "whiteout" ? 18 : 60 };
      if (tool === "whiteout") { addItem({ type: "whiteout", page: pv.id, ...r, color: o.color || "#ffffff" }, { select: false }); return; }
      if (tool === "redact") {
        addItem({ type: "redact", page: pv.id, ...r }, { select: false });
        if (!sessionStorage.getItem("muhur.redactTip")) {
          toast("Karartılan alanlar indirirken kalıcı olarak silinir; o sayfa görüntüye dönüştürülür.", "warn", { timeout: 7000 });
          try { sessionStorage.setItem("muhur.redactTip", "1"); } catch (err) { /* ignore */ }
        }
        return;
      }
      addItem({ type: tool, page: pv.id, ...r, stroke: o.stroke, fill: o.fill, width: o.width, opacity: o.opacity, dash: o.dash });
      setTool("select");
    },
  };
}

function round2(v) { return Math.round(v * 100) / 100; }

// Ramer–Douglas–Peucker
function simplify(points, eps) {
  if (points.length < 3) return points;
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
    t = clamp(t, 0, 1);
    const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return x * x + y * y;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = d2(points[i], points[s], points[e]); if (d > max) { max = d; idx = i; } }
    if (max > eps * eps && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

/* ---------------------------- text: add & edit -------------------------- */
function createTextAt(pv, [x, y]) {
  const o = opts("text");
  const it = {
    id: uid("i"), type: "text", page: pv.id, x: x - PAD, y: y - (o.size * W.LINE_HEIGHT) / 2 - PAD, w: 10, h: 10,
    autoW: true, text: "", font: o.font, size: o.size, color: o.color, bold: o.bold, italic: o.italic, align: o.align, bg: o.bg,
  };
  measureTextItem(it);
  const before = snapshot();
  E.state.items.push(it);
  E.selection = it.id;
  startEdit(it, { isNew: true, before });
}

function startEdit(it, { isNew = false, before } = {}) {
  if (!it || it.type !== "text") return;
  if (editing && editing.item.id === it.id) { editing.ta.focus(); return; }
  if (editing) finishEdit();
  const pv = E.views.get(it.page);
  if (!pv) return;
  E.selection = it.id;
  const el = textEl(it);
  el.classList.add("is-editing");
  const ta = h("textarea.it__edit", { spellcheck: "true", "aria-label": "Metin" });
  if (!it.autoW) ta.classList.add("is-wrap");
  ta.value = it.text || "";
  ta.style.padding = P(PAD);
  el.append(ta);
  editing = { item: it, el, ta, before: before || snapshot(), isNew };
  renderItems(pv);
  ta.addEventListener("input", () => {
    it.text = ta.value;
    measureTextItem(it);
    const fresh = textEl(it);
    el.style.width = fresh.style.width;
    el.style.height = fresh.style.height;
    el.style.left = fresh.style.left;
    $$(".ln", el).forEach((n) => n.remove());
    for (const ln of textLines(it)) el.insertBefore(h("div.ln", { text: ln || "​" }), ta);
    renderSelection(pv);
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishEdit(); }
    e.stopPropagation();
  });
  ta.addEventListener("blur", () => setTimeout(() => { if (editing && editing.ta === ta && document.activeElement !== ta) finishEdit(); }, 0));
  requestAnimationFrame(() => {
    ta.focus();
    const n = ta.value.length;
    ta.setSelectionRange(n, n);
  });
  panels.renderProps();
}

function finishEdit() {
  if (!editing) return;
  const { item, before, isNew } = editing;
  editing = null;
  item.text = String(item.text || "").replace(/\s+$/, (m) => (m.includes("\n") ? "" : m));
  const pv = E.views.get(item.page);
  if (!item.text.trim() && !item.cover) {
    E.state.items = E.state.items.filter((x) => x.id !== item.id);
    if (E.selection === item.id) E.selection = null;
    if (!isNew) commit(before);
  } else {
    measureTextItem(item);
    if (before !== snapshot()) commit(before);
  }
  if (pv) renderItems(pv);
  if (E.tool === "text" || E.tool === "edittext") { /* stay in the tool */ } else renderSelectionAll();
  panels.renderProps();
}

/* -------------------------- edit existing text -------------------------- */
async function pageLines(pv) {
  if (lineCache.has(pv.id)) return lineCache.get(pv.id);
  if (!pv.entry.src) { lineCache.set(pv.id, []); return []; }
  const tc = await textContent(pv.entry);
  const vp = pv.g.pp.getViewport({ scale: 1, rotation: pv.g.rot });
  const runs = [];
  for (const item of tc.items) {
    if (!item.str || !item.str.trim() || !item.transform) continue;
    const m = lib.Util.transform(vp.transform, item.transform);
    const angle = Math.atan2(m[1], m[0]);
    if (Math.abs(angle) > 0.02) continue;
    const size = Math.hypot(m[2], m[3]);
    if (size < 1) continue;
    const st = tc.styles[item.fontName] || {};
    const asc = st.ascent || 0.8;
    const desc = st.descent || -0.2;
    const width = item.width * Math.hypot(vp.transform[0], vp.transform[1]);
    runs.push({ x: m[4], baseline: m[5], size, w: width, top: m[5] - size * asc, h: size * (asc - desc), str: item.str, fontName: item.fontName, family: st.fontFamily || "sans-serif" });
  }
  runs.sort((a, b) => (Math.abs(a.baseline - b.baseline) < Math.min(a.size, b.size) * 0.3 ? a.x - b.x : a.baseline - b.baseline));
  const lines = [];
  for (const r of runs) {
    const ln = lines[lines.length - 1];
    if (ln && Math.abs(ln.baseline - r.baseline) < Math.min(ln.size, r.size) * 0.35 && r.x >= ln.x + ln.w - r.size * 0.6 &&
      r.x - (ln.x + ln.w) < r.size * 1.4 && Math.abs(ln.size - r.size) / ln.size < 0.3) {
      const gap = r.x - (ln.x + ln.w);
      if (gap > r.size * 0.15 && !/\s$/.test(ln.text) && !/^\s/.test(r.str)) ln.text += " ";
      ln.text += r.str;
      const right = Math.max(ln.x + ln.w, r.x + r.w);
      ln.top = Math.min(ln.top, r.top);
      ln.h = Math.max(ln.top + ln.h, r.top + r.h) - ln.top;
      ln.w = right - ln.x;
    } else {
      lines.push({ ...r, text: r.str });
    }
  }
  for (const ln of lines) ln.text = ln.text.replace(/\s+/g, " ").trim();
  lineCache.set(pv.id, lines);
  return lines;
}

function lineAt(lines, x, y) {
  let best = null;
  for (const ln of lines) {
    if (x >= ln.x - 2 && x <= ln.x + ln.w + 2 && y >= ln.top - 2 && y <= ln.top + ln.h + 2) {
      if (!best || ln.h < best.h) best = ln;
    }
  }
  return best;
}

function fontGuess(pv, ln) {
  let name = "";
  try { const f = pv.g.pp.commonObjs.get(ln.fontName); name = (f && (f.name || f.loadedName)) || ""; } catch (e) { /* not loaded */ }
  const n = name.toLowerCase();
  const fam = /courier|mono|consol|menlo/.test(n) || ln.family === "monospace" ? "mono"
    : /times|serif|georgia|garamond|cambria|minion|book|roman/.test(n.replace("sans-serif", "")) && !/sans/.test(n) ? "serif"
      : ln.family === "serif" && !/sans|arial|helvet|calibri|verdana/.test(n) ? "serif" : "sans";
  return { font: fam, bold: /bold|black|heavy|semibold|demi/.test(n), italic: /italic|oblique/.test(n) };
}

function sampleColors(pv, ln) {
  const fallback = { ink: "#000000", bg: "#ffffff" };
  if (!pv.canvas.width || !pv.canvasScale) return fallback;
  const s = pv.canvasScale;
  const x = Math.max(0, Math.floor(ln.x * s)), y = Math.max(0, Math.floor(ln.top * s));
  const w = Math.min(pv.canvas.width - x, Math.ceil(ln.w * s)), hh = Math.min(pv.canvas.height - y, Math.ceil(ln.h * s));
  if (w < 2 || hh < 2) return fallback;
  let data;
  try { data = pv.canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, w, hh).data; } catch (e) { return fallback; }
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const unq = (k) => [((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17];
  const bg = unq(bgKey);
  let ink = null, inkCount = 0;
  for (const [k, c] of counts) {
    const col = unq(k);
    const d = Math.hypot(col[0] - bg[0], col[1] - bg[1], col[2] - bg[2]);
    if (d > 110 && c > inkCount) { ink = col; inkCount = c; }
  }
  // snap near-black and near-white so tiny antialiasing tints do not leak
  const snap = (c) => (c[0] + c[1] + c[2] < 90 ? [0, 0, 0] : c[0] + c[1] + c[2] > 720 ? [255, 255, 255] : c);
  return { ink: rgbToHex(...snap(ink || [0, 0, 0])), bg: rgbToHex(...snap(bg)) };
}

async function editTextAt(pv, pt, e) {
  const hitEl = e.target.closest(".it--text");
  if (hitEl) { startEdit(itemById(hitEl.dataset.id)); return; }
  const lines = await pageLines(pv);
  const ln = lineAt(lines, pt[0], pt[1]);
  $$(".hover-line").forEach((g) => g.remove());
  if (!ln) {
    toast(lines.length ? "Düzenlemek için bir metin satırına tıkla." : "Bu sayfada seçilebilir metin yok (taranmış olabilir). Metin eklemek için 'Metin ekle' aracını kullan.", "info");
    return;
  }
  // already edited? open that one instead of covering twice
  const existing = items().find((it) => it.page === pv.id && it.origin === "edit" && it.cover && Math.abs(it.cover.x - (ln.x - 1)) < 0.5 && Math.abs(it.cover.y - (ln.top - 1)) < 0.5);
  if (existing) { startEdit(existing); return; }
  const fg = fontGuess(pv, ln);
  const col = sampleColors(pv, ln);
  const size = Math.round(ln.size * 100) / 100;
  await loadFonts([[fg.font, fg.bold, fg.italic]]);
  const it = {
    id: uid("i"), type: "text", page: pv.id, origin: "edit",
    x: ln.x - PAD, y: ln.baseline - W.baselineInLine(fg.font) * size - PAD, w: 10, h: 10, autoW: true,
    text: ln.text, font: fg.font, size, color: col.ink, bold: fg.bold, italic: fg.italic, align: "left", bg: null,
    cover: { x: ln.x - 1, y: ln.top - 1, w: ln.w + 2, h: ln.h + 2, color: col.bg },
  };
  measureTextItem(it);
  const before = snapshot();
  E.state.items.push(it);
  E.selection = it.id;
  startEdit(it, { before });
}

/* ---------------------------- markup (text) ----------------------------- */
function onSelectionUp() {
  if (mode() !== "markup") return;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const within = range.commonAncestorContainer;
  const node = within.nodeType === 1 ? within : within.parentElement;
  if (!node || !node.closest || !(node.closest(".textLayer") || node.closest(".pages"))) return;
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
  const byPage = new Map();
  for (const r of rects) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (const pv of E.views.values()) {
      const pr = pv.page.getBoundingClientRect();
      if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
        if (!byPage.has(pv)) byPage.set(pv, []);
        byPage.get(pv).push([(r.left - pr.left) / E.scale, (r.top - pr.top) / E.scale, r.width / E.scale, r.height / E.scale]);
        break;
      }
    }
  }
  if (!byPage.size) return;
  const text = sel.toString().replace(/\s+/g, " ").trim();
  const o = opts(E.tool);
  const before = snapshot();
  for (const [pv, list] of byPage) {
    E.state.items.push({ id: uid("i"), type: "highlight", page: pv.id, rects: mergeRects(list), style: E.tool, color: o.color, text });
    renderItems(pv);
  }
  sel.removeAllRanges();
  commit(before);
}

function mergeRects(list) {
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - r[1]) < Math.min(last[3], r[3]) * 0.5 && r[0] <= last[0] + last[2] + 2) {
      const x2 = Math.max(last[0] + last[2], r[0] + r[2]);
      const y = Math.min(last[1], r[1]);
      const y2 = Math.max(last[1] + last[3], r[1] + r[3]);
      last[0] = Math.min(last[0], r[0]); last[1] = y; last[2] = x2 - last[0]; last[3] = y2 - y;
    } else out.push(r.slice());
  }
  return out.map((r) => r.map(round2));
}

/* ------------------------------- placing -------------------------------- */
function beginPlacing(template, w, hh, ghost) {
  placing = { template, w, h: hh, ghost };
  applyMode();
}

function place(pv, [x, y]) {
  if (!placing) return;
  const p = placing;
  const it = { ...cloneItem(p.template), page: pv.id };
  const w = p.w, hh = p.h;
  it.x = clamp(x - w / 2, 0, Math.max(0, pv.g.w - w));
  it.y = clamp(y - hh / 2, 0, Math.max(0, pv.g.h - hh));
  if (it.type !== "note") { it.w = w; it.h = hh; }
  if (it.type === "text") measureTextItem(it);
  $$(".ghost").forEach((g) => g.remove());
  const keep = ["check", "cross", "dot", "date", "stamp"].includes(E.tool);
  addItem(it, { select: !keep });
  if (it.type === "note") { setTool("select"); select(it.id); openNote(it, true); return; }
  if (!keep) setTool("select");
}

function stampTemplate() {
  const o = opts("stamp");
  const preset = STAMPS.find((s) => s.id === o.preset);
  const text = (o.preset === "custom" ? o.text : preset ? preset.text : o.text) || "ONAYLANDI";
  const color = o.color || (preset && preset.color) || "#1f7a4a";
  const now = new Date();
  const sub = o.sub === "none" ? "" : o.sub === "date" ? formatDate(now) : o.sub === "name" ? E.user.name : formatDate(now) + " · " + E.user.name;
  const hh = 46;
  const m = measurer({ font: "sans", bold: true, size: hh * (sub ? 0.42 : 0.55) });
  const ms = measurer({ font: "sans", size: hh * 0.2 });
  const w = Math.ceil(Math.max(m(text), sub ? ms(sub) : 0) + Math.max(1.5, hh * 0.05) * 6 + 16);
  return { item: { type: "stamp", text, sub, color, opacity: 0.9, rotation: 0 }, w, h: hh };
}

function dateText() {
  const o = opts("date");
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const months = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  switch (o.format) {
    case "d mmmm yyyy": return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    case "yyyy-mm-dd": return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    case "dd/mm/yyyy": return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
    default: return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
}

async function preparePlacing(tool, extra) {
  const o = opts(tool);
  if (tool === "stamp") {
    const t = stampTemplate();
    beginPlacing(t.item, t.w, t.h, () => stampEl({ ...t.item, x: 0, y: 0, w: t.w, h: t.h, id: "ghost" }));
    return true;
  }
  if (tool === "check" || tool === "cross" || tool === "dot") {
    const s = o.size || 18;
    const item = { type: "mark", glyph: tool, color: o.color };
    beginPlacing(item, s, s, () => {
      const g = svg("svg", { viewBox: `0 0 ${s} ${s}` });
      g.append(inkEl({ ...item, x: 0, y: 0, w: s, h: s, id: "ghost" }));
      return h("div", {}, g);
    });
    return true;
  }
  if (tool === "date") {
    const it = { type: "text", text: dateText(), font: o.font || "sans", size: o.size || 12, color: o.color || "#111", bold: false, italic: false, align: "left", autoW: true, x: 0, y: 0, w: 10, h: 10 };
    measureTextItem(it);
    beginPlacing(it, it.w, it.h, () => textEl({ ...it, id: "ghost" }));
    return true;
  }
  if (tool === "note") {
    const item = { type: "note", text: "", color: o.color, author: E.user.name, date: new Date().toISOString() };
    beginPlacing(item, 20, 20, () => noteEl({ ...item, x: 0, y: 0, id: "ghost" }));
    return true;
  }
  if (tool === "image") {
    const [file] = await pickFiles(dom.fileImage, { accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml" });
    if (!file) return false;
    const { url, w, h: hh } = await imageToAsset(file, 2000);
    const asset = uid("a");
    E.state.assets[asset] = url;
    const s = Math.min(1, 240 / Math.max(w, hh));
    const item = { type: "image", asset, rotation: 0, opacity: 1 };
    beginPlacing(item, w * s, hh * s, () => h("div", {}, h("img", { src: url, style: { width: "100%", height: "100%" } })));
    return true;
  }
  if (tool === "signature" || tool === "initials") {
    let sig = extra;
    if (!sig) {
      sig = E.signatures.find((s) => s.kind === (tool === "initials" ? "initials" : "signature"));
      if (!sig) sig = await sigui.createSignature(tool === "initials" ? "initials" : "signature");
      if (!sig) return false;
    }
    const asset = "sig_" + sig.id;
    E.state.assets[asset] = sig.url;
    const target = sig.kind === "initials" ? 54 : 150;
    const s = target / sig.w;
    const item = { type: "image", asset, kind: sig.kind, rotation: 0, opacity: 1 };
    beginPlacing(item, sig.w * s, sig.h * s, () => h("div", {}, h("img", { src: sig.url, style: { width: "100%", height: "100%" } })));
    return true;
  }
  return false;
}

export async function imageToAsset(file, maxSide) {
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Görsel okunamadı.")); i.src = url; });
  const w = img.naturalWidth || 300, hh = img.naturalHeight || 300;
  const s = Math.min(1, maxSide / Math.max(w, hh));
  const keepPng = /png|gif|svg|webp/.test(file.type);
  if (s === 1 && /jpe?g|png/.test(file.type)) return { url, w, h: hh };
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(hh * s);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL(keepPng ? "image/png" : "image/jpeg", 0.9), w: c.width, h: c.height };
}

/* -------------------------------- notes --------------------------------- */
let notePop = null;
function openNote(it, isNew) {
  closeNote();
  const pv = E.views.get(it.page);
  if (!pv) return;
  const r = pv.page.getBoundingClientRect();
  const before = isNew ? null : snapshot();
  const ta = h("textarea.textarea", { rows: 4, placeholder: "Yorumunu yaz…" });
  ta.value = it.text || "";
  const pop = h("div.popnote", {},
    h("div.popnote__head", { html: `<span class="citem__dot" style="background:${it.color}"></span><strong>${(it.author || E.user.name).replace(/</g, "&lt;")}</strong><span>${new Date(it.date || Date.now()).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}</span>` }),
    ta,
    h("div.popnote__actions", {},
      h("button.btn.btn--sm.btn--danger-ghost", { type: "button", html: icon("trash-2") + "Sil", onclick: () => { closeNote(); select(it.id); deleteSelection(); } }),
      h("button.btn.btn--sm.btn--primary", { type: "button", text: "Kaydet", onclick: () => save() })));
  const save = () => {
    const snap = before || snapshot();
    it.text = ta.value;
    closeNote();
    renderItems(pv);
    commit(snap);
  };
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
    if (e.key === "Escape") { closeNote(); }
  });
  document.body.append(pop);
  let x = r.left + (it.x + 26) * E.scale, y = r.top + it.y * E.scale;
  if (x + 290 > innerWidth) x = r.left + it.x * E.scale - 290;
  pop.style.left = clamp(x, 8, innerWidth - 290) + "px";
  pop.style.top = clamp(y, 8, innerHeight - pop.offsetHeight - 8) + "px";
  notePop = pop;
  ta.focus();
}
function closeNote() { if (notePop) { notePop.remove(); notePop = null; } }
E.openNote = (id) => { const it = itemById(id); if (it) { scrollToPage(it.page, it.y); select(id); openNote(it); } };

/* ================================= Tools ================================ */
async function setTool(tool, extra) {
  if (editing) finishEdit();
  closeNote();
  placing = null;
  $$(".ghost, .hover-line").forEach((g) => g.remove());
  if (tool !== "sigfield" && sigFieldResolve) { const r = sigFieldResolve; sigFieldResolve = null; r(null); }
  E.tool = tool;
  for (const [group, list] of Object.entries(GROUPS)) if (list.includes(tool)) setGroupTool(group, tool);
  $$(".tool[data-tool]", dom.tools).forEach((b) => b.classList.toggle("is-active", b.dataset.tool === tool));
  hint(tool);
  if (PLACE_TOOLS.has(tool)) {
    const ok = await preparePlacing(tool, extra);
    if (!ok) { setTool("select"); return; }
  }
  applyMode();
  if (tool !== "select") { const keep = E.selection; E.selection = null; if (keep) { const it = itemById(keep); if (it) renderSelection(E.views.get(it.page)); } }
  if (tool === "edittext") for (const pv of E.views.values()) if (pv.visible) pageLines(pv).catch(() => null);
  renderSelectionAll();
  panels.renderProps();
}
E.setTool = setTool;

const GROUPS = {
  markup: ["highlight", "underline", "strike"],
  draw: ["pen", "marker"],
  shape: ["rect", "ellipse", "line", "arrow"],
  mark: ["check", "cross", "dot"],
};
const TOOL_META = {
  highlight: ["highlighter", "Vurgula · U"], underline: ["underline", "Altını çiz"], strike: ["strikethrough", "Üstünü çiz"],
  pen: ["pen-line", "Kalem · P"], marker: ["brush", "Fosforlu kalem"],
  rect: ["square", "Dikdörtgen · R"], ellipse: ["circle", "Elips · O"], line: ["minus", "Çizgi · L"], arrow: ["move-up-right", "Ok · A"],
  check: ["check", "Onay işareti · K"], cross: ["x", "Çarpı"], dot: ["circle-dot", "Nokta"],
};
function setGroupTool(group, tool) {
  lastToolInGroup[group] = tool;
  const btn = dom.tools.querySelector(`.tgroup[data-group="${group}"] .tool`);
  if (!btn) return;
  btn.dataset.tool = tool;
  btn.dataset.tip = TOOL_META[tool][1];
  btn.querySelector("use").setAttribute("href", `./assets/img/icons.svg#i-${TOOL_META[tool][0]}`);
}

function hint(tool) {
  const map = {
    text: "Metin eklemek istediğin yere tıkla.",
    edittext: "Değiştirmek istediğin metin satırına tıkla. Orijinal satır kapatılır, yerine yazdığın gelir.",
    highlight: "Metni seçerek vurgula ya da boş alanda sürükleyerek bölge işaretle.",
    underline: "Altını çizmek istediğin metni seç.",
    strike: "Üstünü çizmek istediğin metni seç.",
    pen: "Serbestçe çiz. Bitirince <kbd>Esc</kbd>.",
    marker: "Fosforlu kalemle üzerinden geç.",
    whiteout: "Gizlemek istediğin alanı sürükleyerek kapat.",
    redact: "Kalıcı silinecek alanı sürükleyerek seç. İndirirken içerik dosyadan çıkarılır.",
    sigfield: "Dijital imzanın görüneceği alanı sürükleyerek çiz. <kbd>Esc</kbd> iptal.",
    note: "Notu bırakmak istediğin yere tıkla.",
    stamp: "Damgayı yerleştirmek için tıkla.",
    check: "İşaret koymak için tıkla.", cross: "İşaret koymak için tıkla.", dot: "İşaret koymak için tıkla.",
    date: "Tarihi yerleştirmek için tıkla.",
    image: "Görseli yerleştirmek için tıkla.",
    signature: "İmzanı yerleştirmek için tıkla.",
    initials: "Parafını yerleştirmek için tıkla.",
  };
  dom.hint.hidden = !map[tool];
  dom.hint.innerHTML = map[tool] || "";
}

function groupMenu(group, anchor) {
  if (group === "stamp") { stampMenu(anchor); return; }
  if (group === "signature") { sigui.signatureMenu(anchor, (sig) => setTool(sig.kind === "initials" ? "initials" : "signature", sig)); return; }
  menu(anchor, GROUPS[group].map((t) => ({
    label: TOOL_META[t][1].split(" · ")[0], icon: TOOL_META[t][0], hint: TOOL_META[t][1].split(" · ")[1] || "", active: E.tool === t,
    onClick: () => setTool(t),
  })));
}

function stampMenu(anchor) {
  const o = opts("stamp");
  menu(anchor, [
    { head: "Damgalar" },
    ...STAMPS.map((s) => ({
      node: (() => {
        const b = h("button.menu__item", { type: "button", onclick: () => { o.preset = s.id; o.text = s.text; o.color = s.color; savePrefs(); closeMenu(); setTool("stamp"); } });
        b.append(h("span", { style: { display: "inline-block", padding: "2px 8px", border: `2px solid ${s.color}`, borderRadius: "5px", color: s.color, fontWeight: 700, fontSize: "11.5px", letterSpacing: ".02em" }, text: s.text }));
        return b;
      })(),
    })),
    "sep",
    { label: "Özel damga…", icon: "stamp", onClick: async () => {
      const text = await promptDialog({ title: "Özel damga", label: "Damga metni", value: o.preset === "custom" ? o.text : "", confirm: "Kullan" });
      if (!text) return;
      o.preset = "custom";
      o.text = text.toLocaleUpperCase("tr-TR");
      savePrefs();
      setTool("stamp");
    } },
  ]);
}

/* ============================== Page ops =============================== */
function targetPages() {
  if (E.pageSel.size) return E.state.pages.filter((p) => E.pageSel.has(p.id));
  return E.state.pages.filter((p) => p.id === E.current);
}

function mapPoint(x, y, delta, ow, oh) {
  // delta: +90 clockwise, -90 counter-clockwise, 180
  if (delta === 90) return [oh - y, x];
  if (delta === -90 || delta === 270) return [y, ow - x];
  return [ow - x, oh - y];
}

function rotateItemsOf(pageId, delta, ow, oh) {
  const mp = (x, y) => mapPoint(x, y, delta, ow, oh);
  const mapRect = (x, y, w, hh) => {
    const a = mp(x, y), b = mp(x + w, y + hh);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])];
  };
  for (const it of items()) {
    if (it.page !== pageId) continue;
    if (it.cover) { const [x, y, w, hh] = mapRect(it.cover.x, it.cover.y, it.cover.w, it.cover.h); Object.assign(it.cover, { x, y, w, h: hh }); }
    if (BOX_TYPES.has(it.type)) {
      const [cx, cy] = mp(it.x + it.w / 2, it.y + it.h / 2);
      it.x = cx - it.w / 2; it.y = cy - it.h / 2;
      it.rotation = norm((it.rotation || 0) + delta);
    } else if (it.type === "note") {
      const [cx, cy] = mp(it.x + 10, it.y + 10);
      it.x = cx - 10; it.y = cy - 10;
    } else if (it.type === "mark") {
      const [cx, cy] = mp(it.x + it.w / 2, it.y + it.h / 2);
      it.x = cx - it.w / 2; it.y = cy - it.h / 2;
    } else if (RECT_TYPES.has(it.type)) {
      const [x, y, w, hh] = mapRect(it.x, it.y, it.w, it.h);
      Object.assign(it, { x, y, w, h: hh });
    } else if (it.type === "highlight") {
      it.rects = it.rects.map((r) => mapRect(...r));
    } else if (it.type === "path") {
      it.points = it.points.map(([x, y]) => mp(x, y));
    } else if (it.type === "line") {
      [it.x1, it.y1] = mp(it.x1, it.y1);
      [it.x2, it.y2] = mp(it.x2, it.y2);
    }
  }
}

function rotatePages(delta) {
  const list = targetPages();
  if (!list.length) return;
  const before = snapshot();
  for (const p of list) {
    const g = pageGeom(p);
    rotateItemsOf(p.id, delta, g.w, g.h);
    p.rotate = norm((p.rotate || 0) + delta);
    lineCache.delete(p.id);
  }
  syncPages();
  buildThumbs();
  commit(before);
}

async function deletePages() {
  const list = targetPages();
  if (!list.length) return;
  if (list.length >= E.state.pages.length) { toast("Belgede en az bir sayfa kalmalı.", "warn"); return; }
  const n = items().filter((it) => list.some((p) => p.id === it.page)).length;
  if (list.length > 1 || n) {
    const ok = await confirmDialog({ title: list.length + " sayfa silinsin mi?", message: n ? `Bu sayfalardaki ${n} öğe de silinecek. Geri almak için Ctrl+Z kullanabilirsin.` : "Geri almak için Ctrl+Z kullanabilirsin.", confirm: "Sil", danger: true });
    if (!ok) return;
  }
  const before = snapshot();
  const ids = new Set(list.map((p) => p.id));
  E.state.pages = E.state.pages.filter((p) => !ids.has(p.id));
  E.state.items = E.state.items.filter((it) => !ids.has(it.page));
  E.pageSel.clear();
  syncPages();
  buildThumbs();
  commit(before);
}

function duplicatePages() {
  const list = targetPages();
  if (!list.length) return;
  const before = snapshot();
  for (const p of list) {
    const copy = { ...p, id: uid("p") };
    const at = E.state.pages.indexOf(p);
    E.state.pages.splice(at + 1, 0, copy);
    for (const it of items().filter((x) => x.page === p.id)) E.state.items.push({ ...cloneItem(it), id: uid("i"), page: copy.id });
  }
  syncPages();
  buildThumbs();
  commit(before);
}

function insertBlank() {
  const cur = E.state.pages.find((p) => p.id === E.current) || E.state.pages[E.state.pages.length - 1];
  const g = pageGeom(cur);
  const before = snapshot();
  const entry = { id: uid("p"), src: null, index: 0, rotate: 0, w: g.w, h: g.h };
  E.state.pages.splice(E.state.pages.indexOf(cur) + 1, 0, entry);
  syncPages();
  buildThumbs();
  commit(before);
  scrollToPage(entry.id);
}

async function insertPdf() {
  const files = await pickFiles(dom.filePdf, { accept: "application/pdf,.pdf", multiple: true });
  if (!files.length) return;
  const b = busy("PDF ekleniyor…");
  try {
    const before = snapshot();
    let at = E.state.pages.findIndex((p) => p.id === E.current) + 1;
    for (const file of files) {
      let bytes = new Uint8Array(await file.arrayBuffer());
      const info = await inspectPdf(bytes);
      if (!info.ok) { toast(file.name + ": " + info.error, "error"); continue; }
      if (info.encrypted) bytes = await rasterizePdf(bytes, undefined, (i, n) => b.set(`Şifreli PDF dönüştürülüyor ${i}/${n}`)).catch(() => null);
      if (!bytes) { toast(file.name + " açılamadı (parola korumalı olabilir).", "error"); continue; }
      const blob = await store.putBlob(bytes);
      const srcId = uid("s");
      E.state.sources[srcId] = blob;
      E.sources.set(srcId, { bytes, pdf: await openPdf(bytes), blob });
      const n = E.sources.get(srcId).pdf.numPages;
      const entries = Array.from({ length: n }, (_, i) => ({ id: uid("p"), src: srcId, index: i, rotate: 0 }));
      for (const e of entries) await ensurePdfPage(e);
      E.state.pages.splice(at, 0, ...entries);
      at += n;
    }
    syncPages();
    buildThumbs();
    commit(before);
    toast("Sayfalar eklendi.", "ok");
  } catch (err) {
    toast("PDF eklenemedi: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

async function extractPages({ split } = {}) {
  let groups;
  if (split) {
    const n = await promptDialog({ title: "Belgeyi böl", label: "Kaç sayfada bir bölünsün?", value: "1", type: "number", confirm: "Böl", hint: `Belge ${E.state.pages.length} sayfa. Her parça kitaplığına ayrı belge olarak eklenir.` });
    const k = parseInt(n, 10);
    if (!k || k < 1) return;
    groups = [];
    for (let i = 0; i < E.state.pages.length; i += k) groups.push(E.state.pages.slice(i, i + k));
  } else {
    const list = targetPages();
    if (!list.length) return;
    groups = [list];
  }
  const b = busy("Sayfalar ayıklanıyor…");
  try {
    let last = null;
    for (const [gi, group] of groups.entries()) {
      b.set(`Belge hazırlanıyor ${gi + 1}/${groups.length}`);
      const ids = new Set(group.map((p) => p.id));
      const sub = { ...E.state, pages: group, items: E.state.items.filter((it) => ids.has(it.page)), mainPageCount: -1 };
      const bytes = await W.buildPdf({ state: sub, loadSource: async (s) => E.sources.get(s).bytes.slice(), fontBytes, renderPage: renderForExport, options: {} });
      const nums = group.map((p) => E.pageIndex(p.id) + 1);
      const label = nums.length === 1 ? `s. ${nums[0]}` : `s. ${nums[0]}–${nums[nums.length - 1]}`;
      last = await createDoc(`${E.doc.name} (${label})`, bytes);
    }
    toast(groups.length > 1 ? `${groups.length} belge oluşturuldu.` : "Sayfalar yeni belge olarak kaydedildi.", "ok", last && groups.length === 1 ? { action: { label: "Aç", run: () => { location.hash = "#/belge/" + last.id; } } } : null);
  } catch (err) {
    toast("Ayıklanamadı: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

function pagesMenu(anchor) {
  const n = targetPages().length;
  menu(anchor, [
    { head: n > 1 ? `${n} sayfa seçili` : "Geçerli sayfa" },
    { label: "Sola döndür", icon: "rotate-ccw", onClick: () => rotatePages(-90) },
    { label: "Sağa döndür", icon: "rotate-cw", onClick: () => rotatePages(90) },
    { label: "Çoğalt", icon: "copy", onClick: duplicatePages },
    { label: "Yeni belge olarak ayıkla", icon: "file-output", onClick: () => extractPages() },
    { label: "Geçerli sayfayı PNG olarak indir", icon: "image-down", onClick: () => exportPng() },
    "sep",
    { label: "Boş sayfa ekle", icon: "file-plus", onClick: insertBlank },
    { label: "PDF'den sayfa ekle…", icon: "files", onClick: insertPdf },
    { label: "Belgeyi böl…", icon: "scissors", onClick: () => extractPages({ split: true }) },
    "sep",
    { label: "Sil", icon: "trash-2", danger: true, onClick: deletePages },
  ]);
}

/* ============================== Thumbnails ============================== */
function buildThumbs() {
  const targets = [dom.thumbs];
  if (!dom.organizer.hidden) targets.push(dom.gridThumbs);
  if (thumbIO) thumbIO.disconnect();
  thumbIO = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { drawThumb(en.target); thumbIO.unobserve(en.target); }
  }, { root: null, rootMargin: "200px" });
  for (const list of targets) {
    const grid = list === dom.gridThumbs;
    list.textContent = "";
    E.state.pages.forEach((entry, i) => {
      const g = pageGeom(entry);
      const width = grid ? 150 : 132;
      const scale = Math.min(width / g.w, (grid ? 200 : 170) / g.h);
      const li = h("li.thumb", { dataset: { pageId: entry.id }, draggable: "true" });
      const box = h("div.thumb__page", { style: { width: Math.round(g.w * scale) + "px", height: Math.round(g.h * scale) + "px" } });
      box.dataset.w = Math.round(g.w * scale);
      li.append(box, h("span.thumb__num", { text: i + 1 }), h("span.thumb__marks"));
      if (grid) {
        const tools = h("div.thumb__tools");
        const add = (ic, label, fn) => tools.append(h("button.ibtn.ibtn--sm", { type: "button", title: label, "aria-label": label, html: icon(ic), onclick: (e) => { e.stopPropagation(); E.pageSel = new Set([entry.id]); fn(); } }));
        add("rotate-ccw", "Sola döndür", () => rotatePages(-90));
        add("rotate-cw", "Sağa döndür", () => rotatePages(90));
        add("trash-2", "Sil", deletePages);
        li.append(tools);
      }
      li.classList.toggle("is-selected", E.pageSel.has(entry.id));
      li.classList.toggle("is-current", entry.id === E.current);
      list.append(li);
      thumbIO.observe(li);
      markThumb(entry.id);
    });
  }
}

async function drawThumb(li) {
  const entry = E.state.pages.find((p) => p.id === li.dataset.pageId);
  if (!entry) return;
  const box = li.querySelector(".thumb__page");
  const w = Number(box.dataset.w);
  const g = pageGeom(entry);
  const key = `${entry.src}:${entry.index}:${g.rot}:${w}`;
  let src = thumbCache.get(key);
  if (!src) {
    if (entry.src) {
      const c = await renderThumb(E.sources.get(entry.src).pdf, entry.index + 1, w * 2, entry.rotate || 0);
      src = c;
    } else {
      src = document.createElement("canvas");
      src.width = w * 2;
      src.height = Math.round((w * 2 * g.h) / g.w);
      const cx = src.getContext("2d");
      cx.fillStyle = "#fff";
      cx.fillRect(0, 0, src.width, src.height);
    }
    thumbCache.set(key, src);
  }
  const c = h("canvas");
  c.width = src.width;
  c.height = src.height;
  c.getContext("2d").drawImage(src, 0, 0);
  box.textContent = "";
  box.append(c);
}

function markThumb(pageId) {
  for (const list of [dom.thumbs, dom.gridThumbs]) {
    const li = list.querySelector(`.thumb[data-page-id="${pageId}"] .thumb__marks`);
    if (!li) continue;
    li.textContent = "";
    const its = items().filter((it) => it.page === pageId);
    if (its.some((it) => it.type === "image" && (it.kind === "signature" || it.kind === "initials"))) li.append(h("span.thumb__mark.thumb__mark--sig", { title: "İmza" }));
    if (its.some((it) => !(it.type === "image" && it.kind))) li.append(h("span.thumb__mark", { title: "Düzenleme" }));
  }
}

let lastThumbClick = null;
function onThumbClick(e) {
  const li = e.target.closest(".thumb");
  if (!li || e.target.closest(".thumb__tools")) return;
  const id = li.dataset.pageId;
  if (e.shiftKey && lastThumbClick) {
    const a = E.pageIndex(lastThumbClick), b = E.pageIndex(id);
    E.pageSel = new Set(E.state.pages.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.id));
  } else if (e.metaKey || e.ctrlKey) {
    if (E.pageSel.has(id)) E.pageSel.delete(id); else E.pageSel.add(id);
    lastThumbClick = id;
  } else {
    E.pageSel = new Set([id]);
    lastThumbClick = id;
    if (dom.organizer.hidden) scrollToPage(id);
  }
  $$(".thumb").forEach((t) => t.classList.toggle("is-selected", E.pageSel.has(t.dataset.pageId)));
}

function onThumbDblClick(e) {
  const li = e.target.closest(".thumb");
  if (!li || dom.organizer.hidden) return;
  toggleOrganizer(false);
  scrollToPage(li.dataset.pageId);
}

let dragIds = null;
function bindThumbDnD(list) {
  list.addEventListener("dragstart", (e) => {
    const li = e.target.closest(".thumb");
    if (!li) return;
    const id = li.dataset.pageId;
    dragIds = E.pageSel.has(id) ? E.state.pages.filter((p) => E.pageSel.has(p.id)).map((p) => p.id) : [id];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragIds.join(","));
    setTimeout(() => dragIds.forEach((d) => $$(`.thumb[data-page-id="${d}"]`).forEach((t) => t.classList.add("is-dragging"))), 0);
  });
  list.addEventListener("dragend", () => {
    dragIds = null;
    $$(".thumb").forEach((t) => t.classList.remove("is-dragging", "drop-before", "drop-after"));
  });
  list.addEventListener("dragover", (e) => {
    if (!dragIds) return;
    const li = e.target.closest(".thumb");
    if (!li) return;
    e.preventDefault();
    const r = li.getBoundingClientRect();
    const grid = list === dom.gridThumbs;
    const after = grid ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    $$(".thumb", list).forEach((t) => t.classList.remove("drop-before", "drop-after"));
    li.classList.add(after ? "drop-after" : "drop-before");
  });
  list.addEventListener("drop", (e) => {
    if (!dragIds) return;
    e.preventDefault();
    const li = e.target.closest(".thumb");
    if (!li) return;
    const after = li.classList.contains("drop-after");
    const targetId = li.dataset.pageId;
    if (dragIds.includes(targetId)) return;
    const before = snapshot();
    const moving = E.state.pages.filter((p) => dragIds.includes(p.id));
    const rest = E.state.pages.filter((p) => !dragIds.includes(p.id));
    let at = rest.findIndex((p) => p.id === targetId) + (after ? 1 : 0);
    rest.splice(at, 0, ...moving);
    E.state.pages = rest;
    syncPages();
    buildThumbs();
    commit(before);
  });
}

function toggleOrganizer(force) {
  const show = force == null ? dom.organizer.hidden : force;
  if (editing) finishEdit();
  dom.organizer.hidden = !show;
  dom.organizerBtn.classList.toggle("is-active", show);
  if (show) buildThumbs();
  else { dom.gridThumbs.textContent = ""; }
}

/* ================================ Forms ================================= */
async function renderForms(pv) {
  if (pv.formsDone || !pv.entry.src) return;
  pv.formsDone = true;
  let annots = [];
  try { annots = await pv.g.pp.getAnnotations({ intent: "display" }); } catch (e) { return; }
  const vp = pv.g.pp.getViewport({ scale: 1, rotation: pv.g.rot });
  for (const a of annots) {
    if (a.annotationType !== 20 || !a.fieldName || a.hidden) continue;
    if (a.fieldType === "Sig" || a.pushButton) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), hh = Math.abs(y2 - y1);
    const style = { left: P(x), top: P(y), width: P(w), height: P(hh) };
    const name = a.fieldName;
    const stored = Object.prototype.hasOwnProperty.call(E.state.forms, name) ? E.state.forms[name] : undefined;
    let el;
    let before = null;
    const focus = () => { before = snapshot(); };
    const changed = (value) => {
      E.state.forms[name] = value;
      commit(before || snapshot());
      before = snapshot();
      syncField(name, pv);
    };
    if (a.fieldType === "Tx") {
      const fs = a.defaultAppearanceData && a.defaultAppearanceData.fontSize ? a.defaultAppearanceData.fontSize : Math.min(12, Math.max(6, hh * 0.62));
      el = a.multiLine ? h("textarea.fw", { style }) : h("input.fw", { type: a.password ? "password" : "text", style });
      el.style.fontSize = P(fs);
      if (a.textAlignment === 1) el.style.textAlign = "center";
      if (a.textAlignment === 2) el.style.textAlign = "right";
      if (a.maxLen) el.maxLength = a.maxLen;
      el.value = stored != null ? stored : (a.fieldValue || "");
      el.addEventListener("focus", focus);
      el.addEventListener("change", () => changed(el.value));
    } else if (a.fieldType === "Btn" && a.checkBox) {
      el = h("button.fw.fw--check", { type: "button", style, "aria-label": name });
      const on = stored != null ? !!stored : !!(a.fieldValue && a.fieldValue !== "Off");
      el.classList.toggle("is-on", on);
      el.setAttribute("aria-pressed", on);
      el.addEventListener("click", () => { before = snapshot(); changed(!el.classList.contains("is-on")); });
    } else if (a.fieldType === "Btn" && a.radioButton) {
      el = h("button.fw.fw--check.fw--radio", { type: "button", style, "aria-label": name + " " + a.buttonValue, dataset: { value: a.buttonValue } });
      const cur = stored != null ? stored : a.fieldValue;
      el.classList.toggle("is-on", cur === a.buttonValue);
      el.addEventListener("click", () => { before = snapshot(); changed(a.buttonValue); });
    } else if (a.fieldType === "Ch") {
      el = h("select.fw", { style, multiple: !!a.multiSelect && !a.combo });
      el.style.fontSize = P(Math.min(12, Math.max(6, hh * 0.6)));
      const val = stored != null ? stored : a.fieldValue;
      const vals = Array.isArray(val) ? val : [val];
      if (a.combo) el.append(h("option", { value: "", text: "" }));
      for (const o of a.options || []) {
        const opt = h("option", { value: o.exportValue, text: o.displayValue });
        if (vals.includes(o.exportValue) || vals.includes(o.displayValue)) opt.selected = true;
        el.append(opt);
      }
      el.addEventListener("focus", focus);
      el.addEventListener("change", () => changed(el.multiple ? Array.from(el.selectedOptions).map((o) => o.value) : el.value));
    } else continue;
    el.dataset.field = name;
    if (a.readOnly) { el.disabled = true; }
    el.addEventListener("keydown", (e) => e.stopPropagation());
    pv.forms.append(el);
  }
}

function syncField(name, origin) {
  const v = E.state.forms[name];
  for (const pv of E.views.values()) {
    for (const el of $$(`[data-field="${CSS.escape(name)}"]`, pv.forms)) {
      if (el.classList.contains("fw--radio")) el.classList.toggle("is-on", el.dataset.value === v);
      else if (el.classList.contains("fw--check")) { el.classList.toggle("is-on", !!v); el.setAttribute("aria-pressed", !!v); }
      else if (pv !== origin || document.activeElement !== el) {
        if (el.tagName === "SELECT" && el.multiple) Array.from(el.options).forEach((o) => { o.selected = (v || []).includes(o.value); });
        else el.value = v == null ? "" : v;
      }
    }
  }
}

function refreshForms() {
  for (const pv of E.views.values()) {
    for (const el of $$("[data-field]", pv.forms)) {
      const name = el.dataset.field;
      if (Object.prototype.hasOwnProperty.call(E.state.forms, name)) syncField(name);
    }
  }
}

/* ================================ Find ================================== */
function openFind() {
  dom.findbar.hidden = false;
  dom.findInput.focus();
  dom.findInput.select();
}
function closeFind() {
  dom.findbar.hidden = true;
  find = { q: "", hits: [], index: -1 };
  $$(".find-hit").forEach((n) => n.remove());
  dom.findCount.textContent = "";
}
const runFind = debounce(async () => {
  const q = dom.findInput.value.trim();
  $$(".find-hit").forEach((n) => n.remove());
  find = { q, hits: [], index: -1 };
  if (!q) { dom.findCount.textContent = ""; return; }
  const needle = q.toLocaleLowerCase("tr-TR");
  for (const entry of E.state.pages) {
    const pv = E.views.get(entry.id);
    if (!pv) continue;
    const lines = await pageLines(pv);
    for (const ln of lines) {
      const hay = ln.text.toLocaleLowerCase("tr-TR");
      let at = hay.indexOf(needle);
      while (at >= 0) {
        const len = Math.max(1, hay.length);
        find.hits.push({ pageId: entry.id, x: ln.x + (ln.w * at) / len, y: ln.top, w: (ln.w * needle.length) / len, h: ln.h });
        at = hay.indexOf(needle, at + needle.length);
      }
    }
  }
  if (dom.findInput.value.trim() !== q) return;
  for (const hit of find.hits) {
    const pv = E.views.get(hit.pageId);
    hit.el = h("div.find-hit", { style: { left: P(hit.x), top: P(hit.y), width: P(hit.w), height: P(hit.h) } });
    pv.ui.append(hit.el);
  }
  dom.findCount.textContent = find.hits.length ? `0/${find.hits.length}` : "Sonuç yok";
  if (find.hits.length) stepFind(1);
}, 220);
function stepFind(dir) {
  if (!find.hits.length) return;
  if (find.index >= 0) find.hits[find.index].el.classList.remove("is-current");
  find.index = (find.index + dir + find.hits.length) % find.hits.length;
  const hit = find.hits[find.index];
  hit.el.classList.add("is-current");
  dom.findCount.textContent = `${find.index + 1}/${find.hits.length}`;
  scrollToPage(hit.pageId, hit.y);
}

/* =============================== Export ================================= */
async function renderForExport(entry, scale) {
  const canvas = document.createElement("canvas");
  if (!entry.src) {
    const g = pageGeom(entry);
    canvas.width = Math.round(g.w * scale);
    canvas.height = Math.round(g.h * scale);
    const c = canvas.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }
  const pp = await ensurePdfPage(entry);
  const vp = pp.getViewport({ scale, rotation: norm(pp.rotate + (entry.rotate || 0)) });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  await pp.render({ canvas, viewport: vp, annotationMode: lib.AnnotationMode.ENABLE, background: "#ffffff" }).promise;
  return canvas;
}

async function buildBytes({ flattenForms = false, audit = null, force = false } = {}) {
  await pdflib();
  if (editing) finishEdit();
  if (!force && !audit && !flattenForms && W.isPristine(E.state)) return E.sources.get("main").bytes.slice();
  return W.buildPdf({
    state: E.state,
    loadSource: async (s) => E.sources.get(s).bytes.slice(),
    fontBytes,
    renderPage: renderForExport,
    options: { flattenForms, audit },
  });
}
E.buildBytes = buildBytes;

async function download({ flattenForms } = {}) {
  const b = busy("PDF hazırlanıyor…");
  try {
    const bytes = await buildBytes({ flattenForms });
    downloadBytes(bytes, safeFileName(E.doc.name, "pdf"));
    if (items().some((it) => it.type === "redact")) toast("Karartılan alanlar dosyadan kalıcı olarak çıkarıldı.", "ok");
  } catch (err) {
    console.error(err);
    toast("PDF oluşturulamadı: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

async function printDoc() {
  const b = busy("Yazdırmaya hazırlanıyor…");
  try {
    const bytes = await buildBytes();
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const frame = h("iframe", { style: { position: "fixed", right: 0, bottom: 0, width: "1px", height: "1px", border: 0, opacity: 0 }, src: url });
    document.body.append(frame);
    frame.onload = () => {
      setTimeout(() => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { window.open(url, "_blank", "noopener"); }
      }, 250);
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60000);
    };
  } catch (err) {
    toast("Yazdırılamadı: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

async function exportPng() {
  const b = busy("Görüntü hazırlanıyor…");
  try {
    const idx = E.pageIndex(E.current);
    const bytes = await buildBytes({ force: true });
    const pdf = await openPdf(bytes);
    const page = await pdf.getPage(idx + 1);
    const vp = page.getViewport({ scale: 200 / 72 });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvas: c, viewport: vp, background: "#ffffff" }).promise;
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    downloadBytes(new Uint8Array(await blob.arrayBuffer()), safeFileName(`${E.doc.name} - sayfa ${idx + 1}`, "png"), "image/png");
    pdf.destroy();
  } catch (err) {
    toast("Görüntü oluşturulamadı: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

function downloadMenu(anchor) {
  menu(anchor, [
    { label: "PDF olarak indir", sub: "Tüm değişikliklerle", icon: "download", onClick: () => download() },
    { label: "Formları düzleştirerek indir", sub: "Alanlar düz metne dönüşür", icon: "layers", onClick: () => download({ flattenForms: true }) },
    { label: "Orijinal dosyayı indir", sub: "İlk yüklenen hali", icon: "file-down", onClick: async () => {
      const bytes = await store.getBlob(E.doc.versions[0].blob);
      downloadBytes(bytes, safeFileName(E.doc.name + " (orijinal)", "pdf"));
    } },
    { label: "Geçerli sayfayı PNG indir", icon: "image-down", onClick: exportPng },
    "sep",
    { label: "Yazdır", icon: "printer", hint: "Ctrl+P", onClick: printDoc },
  ], { align: "right" });
}

/* ========================= Signature field picker ======================= */
E.drawSigField = () => new Promise((resolve) => {
  setTool("sigfield").then(() => { sigFieldResolve = resolve; });
});

/* ============================ Verification ============================== */
async function verifyCurrent() {
  E.verification = null;
  const bytes = E.sources.get("main").bytes;
  if (!hasSignatures(bytes)) { panels.renderSignatures(); renderBanner(); return; }
  try {
    await Promise.all([pdflib(), forge()]);
    const known = [];
    try {
      const id = await store.getVault("identity");
      if (id) known.push((await describeIdentity(id)).fingerprint);
    } catch (e) { /* no identity */ }
    E.verification = await verifyPdf(bytes, known);
  } catch (err) {
    console.warn(err);
    E.verification = [];
  }
  panels.renderSignatures();
  renderBanner();
}

function renderBanner() {
  const v = E.verification;
  const el = dom.banner;
  if (!v || !v.length) { el.hidden = true; return; }
  const bad = v.filter((r) => !r.integrity || r.signatureValid === false);
  const changed = !W.isPristine(E.state);
  let cls = "banner--ok", ic = "shield-check";
  let text = `<strong>${v.length} dijital imza</strong> · imzalandıktan sonra belge değiştirilmemiş.`;
  if (bad.length) { cls = "banner--danger"; ic = "shield-x"; text = `<strong>${bad.length} imza geçersiz.</strong> Belge imzalandıktan sonra değiştirilmiş ya da imza bozuk.`; }
  else if (v.some((r) => r.laterChanges) && v[v.length - 1].laterChanges) { cls = "banner--warn"; ic = "shield-alert"; text = `<strong>${v.length} dijital imza</strong> geçerli, ancak son imzadan sonra belgeye eklemeler yapılmış.`; }
  if (changed && !bad.length) { cls = "banner--warn"; ic = "shield-alert"; text += " Yaptığın düzenlemeler kaydedildiğinde mevcut imzalar geçersiz olur."; }
  el.className = "banner " + cls;
  el.innerHTML = icon(ic) + `<span class="banner__text">${text}</span>`;
  el.append(h("button.btn.btn--sm", { type: "button", text: "İmza panelini aç", onclick: () => panels.showPanel("signatures") }));
  el.hidden = false;
}
E.renderBanner = renderBanner;

/* ================================ Keys ================================== */
function onKeyDown(e) {
  if (!E.open || $(".dialog[open]")) return;
  const mod = e.metaKey || e.ctrlKey;
  const typing = isTyping(document.activeElement);
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); flushEditor().then(() => toast("Kaydedildi.", "ok")); return; }
  if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); printDoc(); return; }
  if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); return; }
  if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomStep(1); return; }
  if (mod && e.key === "-") { e.preventDefault(); zoomStep(-1); return; }
  if (mod && e.key === "0") { e.preventDefault(); setZoom(PT_PX); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelection(); return; }
  if (mod && e.key.toLowerCase() === "c" && E.selection) { clipboard = cloneItem(itemById(E.selection)); return; }
  if (mod && e.key.toLowerCase() === "x" && E.selection) { clipboard = cloneItem(itemById(E.selection)); deleteSelection(); return; }
  if (mod && e.key.toLowerCase() === "v" && clipboard) {
    e.preventDefault();
    const copy = cloneItem(clipboard);
    copy.id = uid("i");
    copy.page = E.current;
    delete copy.cover; delete copy.origin;
    if (copy.page === clipboard.page) shiftItem(copy, 12, 12);
    clampToPage(copy);
    addItem(copy);
    return;
  }
  if (e.key === "Escape") {
    if (!dom.findbar.hidden) { closeFind(); return; }
    if (E.tool !== "select") { setTool("select"); return; }
    if (E.selection) { select(null); return; }
    if (!dom.organizer.hidden) { toggleOrganizer(false); return; }
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && E.selection) { e.preventDefault(); deleteSelection(); return; }
  if (E.selection && e.key.startsWith("Arrow")) {
    e.preventDefault();
    const it = itemById(E.selection);
    const step = e.shiftKey ? 10 : 1;
    const before = snapshot();
    shiftItem(it, e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
    E.renderPage(it.page);
    commit(before);
    return;
  }
  if (e.key === " " && !spaceDown) { spaceDown = true; applyMode(); e.preventDefault(); return; }
  if (e.key === "PageDown" || e.key === "PageUp" || e.key === "Home" || e.key === "End") {
    const i = E.pageIndex(E.current);
    const last = E.state.pages.length - 1;
    const n = e.key === "Home" ? 0 : e.key === "End" ? last : clamp(i + (e.key === "PageDown" ? 1 : -1), 0, last);
    e.preventDefault();
    scrollToPage(E.state.pages[n].id);
    return;
  }
  if (mod || e.altKey) return;
  const keys = { v: "select", h: "hand", t: "text", e: "edittext", u: "highlight", p: "pen", r: "rect", o: "ellipse", l: "line", a: "arrow", n: "note", i: "image", k: "check", d: "date", w: "whiteout", x: "redact", s: "signature" };
  const tool = keys[e.key.toLowerCase()];
  if (tool) { e.preventDefault(); setTool(tool); }
}
function onKeyUp(e) {
  if (e.key === " " && spaceDown) { spaceDown = false; applyMode(); }
}

/* ================================= Bind ================================= */
function bindOnce() {
  if (bound) return;
  bound = true;
  const root = $(".view--editor");
  Object.assign(dom, {
    root,
    stage: $("#stage"), pages: $("#pages"), thumbs: $("#thumbs"), gridThumbs: $("#grid-thumbs"), organizer: $("#organizer"),
    workspace: $("#workspace"), tools: $("#tools"), name: $("#doc-name"), status: $("#save-status"),
    undo: $('[data-action="undo"]', root), redo: $('[data-action="redo"]', root), zoomBtn: $("#zoom-btn"),
    pageInput: $("#page-input"), pageTotal: $("#page-total"), banner: $("#sig-banner"), hint: $("#hintbar"),
    findbar: $("#findbar"), findInput: $("#find-input"), findCount: $("#find-count"),
    organizerBtn: $('.tool[data-action="organizer"]', root),
    filePdf: $("#file-pdf"), fileImage: $("#file-image"),
  });
  loadPrefs();
  setupObserver();

  dom.pages.addEventListener("pointerdown", onPointerDown);
  dom.stage.addEventListener("pointerdown", (e) => {
    if (dom.pages.contains(e.target) || dom.organizer.contains(e.target)) return;
    if (mode() === "hand") startPan(e);
    else if (mode() === "select") select(null);
  });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  document.addEventListener("pointerup", () => setTimeout(onSelectionUp, 0));
  dom.pages.addEventListener("dblclick", (e) => {
    if (mode() !== "select") return;
    const el = e.target.closest("[data-id]");
    const it = el && itemById(el.dataset.id);
    if (it && it.type === "text") startEdit(it);
    if (it && it.type === "note") openNote(it);
  });
  dom.stage.addEventListener("scroll", onScroll, { passive: true });
  dom.stage.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(E.scale * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0022)), { x: e.clientX, y: e.clientY });
  }, { passive: false });
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", debounce(() => { if (E.open) renderSelectionAll(); }, 200));

  dom.tools.addEventListener("click", (e) => {
    const caret = e.target.closest(".tgroup__caret");
    if (caret) { groupMenu(caret.closest(".tgroup").dataset.group, caret); return; }
    const b = e.target.closest(".tool");
    if (!b) return;
    if (b.dataset.action === "organizer") { toggleOrganizer(); return; }
    const t = b.dataset.tool;
    if (t === "signature" && !E.signatures.length) { sigui.signatureMenu(b, (sig) => setTool(sig.kind === "initials" ? "initials" : "signature", sig)); return; }
    setTool(E.tool === t && t !== "select" ? "select" : t);
  });

  root.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (!a || !root.contains(a)) return;
    switch (a.dataset.action) {
      case "back": exit(); break;
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "zoom-in": zoomStep(1); break;
      case "zoom-out": zoomStep(-1); break;
      case "search": dom.findbar.hidden ? openFind() : closeFind(); break;
      case "toggle-right": dom.workspace.classList.toggle("no-right"); break;
      case "toggle-left": dom.workspace.classList.toggle("show-left"); break;
      case "download": download(); break;
      case "download-menu": downloadMenu(a); break;
      case "sign": sigui.openSignMenu(a); break;
      default: break;
    }
  });
  dom.zoomBtn.addEventListener("click", zoomMenu);
  dom.pageInput.addEventListener("change", () => {
    const n = clamp(parseInt(dom.pageInput.value, 10) || 1, 1, E.state.pages.length);
    scrollToPage(E.state.pages[n - 1].id);
  });
  dom.pageInput.addEventListener("keydown", (e) => e.stopPropagation());
  dom.name.addEventListener("change", async () => {
    const v = dom.name.value.trim();
    if (!v) { dom.name.value = E.doc.name; return; }
    E.doc.name = v;
    await store.putDoc(E.doc);
    document.title = v + " · Mühür";
  });
  dom.name.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") dom.name.blur(); });

  for (const list of [dom.thumbs, dom.gridThumbs]) {
    list.addEventListener("click", onThumbClick);
    list.addEventListener("dblclick", onThumbDblClick);
    list.addEventListener("contextmenu", (e) => {
      const li = e.target.closest(".thumb");
      if (!li) return;
      e.preventDefault();
      if (!E.pageSel.has(li.dataset.pageId)) { E.pageSel = new Set([li.dataset.pageId]); $$(".thumb").forEach((t) => t.classList.toggle("is-selected", E.pageSel.has(t.dataset.pageId))); }
      pagesMenu({ x: e.clientX, y: e.clientY });
    });
    bindThumbDnD(list);
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pages]");
    if (!b) return;
    const map = {
      "rotate-left": () => rotatePages(-90), "rotate-right": () => rotatePages(90), menu: () => pagesMenu(b),
      "insert-blank": insertBlank, "insert-pdf": insertPdf, duplicate: duplicatePages, extract: () => extractPages(),
      split: () => extractPages({ split: true }), delete: deletePages,
    };
    if (map[b.dataset.pages]) map[b.dataset.pages]();
  });

  dom.findInput.addEventListener("input", runFind);
  dom.findInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") stepFind(e.shiftKey ? -1 : 1);
    if (e.key === "Escape") closeFind();
  });
  dom.findbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-find]");
    if (!b) return;
    if (b.dataset.find === "close") closeFind();
    else stepFind(b.dataset.find === "next" ? 1 : -1);
  });

  panels.init();
}

/* ============================== Open / close ============================ */
async function loadDoc(docId) {
  const doc = await store.getDoc(docId);
  if (!doc) throw new Error("Belge bulunamadı.");
  const version = currentVersion(doc);
  let state = await store.getState(docId);
  if (state && state.base !== version.id) state = null;
  for (const s of E.sources.values()) { try { s.pdf.destroy(); } catch (e) { /* gone */ } }
  E.sources.clear();
  pdfPages.clear();
  textCache.clear();
  lineCache.clear();
  thumbCache.clear();
  const srcMap = state ? state.sources : { main: version.blob };
  for (const [srcId, blobId] of Object.entries(srcMap)) {
    const bytes = await store.getBlob(blobId);
    E.sources.set(srcId, { bytes, pdf: await openPdf(bytes), blob: blobId });
  }
  if (!state) {
    const main = E.sources.get("main").pdf;
    let meta = {};
    try {
      const md = await main.getMetadata();
      const info = md.info || {};
      meta = { title: info.Title || "", author: info.Author || "", subject: info.Subject || "", keywords: info.Keywords || "" };
    } catch (e) { /* no metadata */ }
    state = {
      v: 1, base: version.id, sources: { main: version.blob }, mainPageCount: main.numPages,
      pages: Array.from({ length: main.numPages }, (_, i) => ({ id: uid("p"), src: "main", index: i, rotate: 0 })),
      items: [], assets: {}, forms: {}, watermark: null, pageNumbers: null, meta, metaChanged: false,
    };
  }
  state.assets = state.assets || {};
  state.forms = state.forms || {};
  for (const p of state.pages) await ensurePdfPage(p);
  E.doc = doc;
  E.state = state;
  history = [];
  future = [];
  E.selection = null;
  E.pageSel = new Set();
  E.current = state.pages[0] && state.pages[0].id;
  E.signatures = await store.getVault("signatures", []);
  E.verification = null;
}

export async function openEditor(docId, { user, onClose }) {
  bindOnce();
  onExit = onClose;
  E.user = user;
  const b = busy("Belge açılıyor…");
  try {
    lib = await pdfjs();
    await pdflib();
    await loadDoc(docId);
    await loadFontsForItems();
  } finally {
    b.done();
  }
  E.open = true;
  dom.name.value = E.doc.name;
  document.title = E.doc.name + " · Mühür";
  setStatus("saved", "Bu cihaza kaydedildi");
  dom.undo.disabled = true;
  dom.redo.disabled = true;
  closeFind();
  dom.organizer.hidden = true;
  dom.organizerBtn.classList.remove("is-active");
  dom.pages.textContent = "";
  E.views.clear();
  await setTool("select");
  requestAnimationFrame(() => {
    E.scale = Math.min(fitWidthScale(), PT_PX * 1.5);
    syncPages();
    setZoom(E.scale);
    dom.stage.scrollTo({ top: 0, left: 0, behavior: "instant" });
    buildThumbs();
  });
  panels.refresh();
  panels.showPanel("props");
  verifyCurrent();
}

E.reloadVersion = async () => {
  const id = E.doc.id;
  E.open = false;
  await loadDoc(id);
  E.open = true;
  dom.pages.textContent = "";
  E.views.clear();
  syncPages();
  setZoom(E.scale);
  buildThumbs();
  dom.undo.disabled = true;
  dom.redo.disabled = true;
  panels.refresh();
  await verifyCurrent();
};
E.verifyCurrent = verifyCurrent;
E.refreshPanels = () => panels.refresh();

async function exit() {
  await closeEditor();
  if (onExit) onExit();
}

export async function closeEditor() {
  if (!E.open) return;
  await flushEditor();
  // drop images no object uses any more
  const used = new Set(items().filter((it) => it.asset).map((it) => it.asset));
  const before = Object.keys(E.state.assets).length;
  for (const k of Object.keys(E.state.assets)) if (!used.has(k)) delete E.state.assets[k];
  if (Object.keys(E.state.assets).length !== before) await store.putState(E.doc.id, E.state).catch(() => null);
  E.open = false;
  closeNote();
  closeFind();
  for (const pv of E.views.values()) pv.release();
  E.views.clear();
  dom.pages.textContent = "";
  dom.thumbs.textContent = "";
  for (const s of E.sources.values()) { try { s.pdf.destroy(); } catch (e) { /* gone */ } }
  E.sources.clear();
  pdfPages.clear();
  textCache.clear();
  lineCache.clear();
  thumbCache.clear();
  E.doc = null;
  E.state = null;
  document.title = "Mühür — PDF düzenleyici ve e-imza";
}

export function editorIsOpen() { return E.open; }
