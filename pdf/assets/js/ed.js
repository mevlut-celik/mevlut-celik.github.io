/* ==========================================================================
   Mühür — ed.js
   The editor's shared context. editor.js owns and fills it; the panels
   and signing UI read it and call the functions editor.js attaches here.
   Keeping it in its own module avoids circular imports between them.
   ========================================================================== */

export const E = {
  open: false,
  user: null,
  doc: null,            // library card of the open document
  state: null,          // editable layer (pages, items, forms, assets, ...)
  sources: new Map(),   // srcId -> { bytes, pdf }
  views: new Map(),     // pageId -> PageView
  scale: 1,             // CSS px per point
  tool: "select",
  toolOpts: {},
  selection: null,      // item id
  pageSel: new Set(),   // selected page ids (thumbnails)
  current: null,        // page id in view
  signatures: [],       // saved signature images (vault)
  verification: null,   // results of verifyPdf on the current version
  identity: null,       // digital identity (vault), loaded on demand

  // attached by editor.js
  commit: null,         // commit(beforeSnapshot)
  snapshot: null,       // () => string
  renderPage: null,     // (pageId) => void   re-render objects of a page
  renderAll: null,      // () => void
  select: null,         // (itemId|null) => void
  setTool: null,        // (tool, opts) => void
  item: null,           // (id) => item
  pageIndex: null,      // (pageId) => index
  scrollToPage: null,   // (pageId, y?) => void
  buildBytes: null,     // (options) => Promise<Uint8Array>
  reloadVersion: null,  // () => Promise
  refreshPanels: null,  // () => void
  measureText: null,    // (item) => void   recompute text box size
  drawSigField: null,   // () => Promise<{pageId, rect}|null>
};

export const COLORS = ["#111111", "#4b5563", "#1d3fbf", "#2747d6", "#c0352b", "#1f7a4a", "#f57c00", "#7c3aed"];
export const HIGHLIGHTS = ["#ffe34d", "#9ef0a6", "#8fd3ff", "#ffb3d1", "#ffc078"];
export const FILLS = ["#ffffff", "#fff4b8", "#dbe7ff", "#ffe1de", "#dff3e6", "#111111"];

export const DEFAULTS = {
  text:      { font: "sans", size: 12, color: "#111111", bold: false, italic: false, align: "left", bg: null },
  pen:       { color: "#1d3fbf", width: 2, opacity: 1 },
  marker:    { color: "#ffe34d", width: 14, opacity: 1 },
  rect:      { stroke: "#c0352b", fill: null, width: 2, opacity: 1, dash: false },
  ellipse:   { stroke: "#c0352b", fill: null, width: 2, opacity: 1, dash: false },
  line:      { color: "#c0352b", width: 2, opacity: 1, dash: false },
  arrow:     { color: "#c0352b", width: 2, opacity: 1, dash: false },
  highlight: { color: "#ffe34d" },
  underline: { color: "#1f7a4a" },
  strike:    { color: "#c0352b" },
  note:      { color: "#f5c518" },
  stamp:     { preset: "approved", text: "ONAYLANDI", color: "#1f7a4a", sub: "date-name" },
  check:     { color: "#111111", size: 18 },
  cross:     { color: "#c0352b", size: 18 },
  dot:       { color: "#111111", size: 12 },
  date:      { format: "dd.mm.yyyy", size: 12, color: "#111111", font: "sans" },
  whiteout:  { color: "#ffffff" },
  redact:    {},
};

export const STAMPS = [
  { id: "approved",  text: "ONAYLANDI",   color: "#1f7a4a" },
  { id: "rejected",  text: "REDDEDİLDİ",  color: "#c0352b" },
  { id: "draft",     text: "TASLAK",      color: "#4b5563" },
  { id: "confidential", text: "GİZLİ",    color: "#c0352b" },
  { id: "final",     text: "NİHAİ",       color: "#1d3fbf" },
  { id: "reviewed",  text: "İNCELENDİ",   color: "#1d3fbf" },
  { id: "copy",      text: "ASLI GİBİDİR", color: "#7c3aed" },
  { id: "paid",      text: "ÖDENDİ",      color: "#1f7a4a" },
  { id: "urgent",    text: "ACİL",        color: "#f57c00" },
];
