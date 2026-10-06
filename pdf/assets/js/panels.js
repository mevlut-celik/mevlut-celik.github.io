/* ==========================================================================
   Mühür — panels.js
   The inspector on the right: properties of the selected object (or of the
   active tool), the comment list, the signature panel and document-wide
   settings (metadata, watermark, page numbers, versions).
   ========================================================================== */

import { E, COLORS, HIGHLIGHTS, FILLS, DEFAULTS, STAMPS } from "./ed.js";
import { $, $$, h, icon, esc, swatchRow, toast, confirmDialog } from "./ui.js";
import { FONT_FAMILIES } from "./pdfwork.js";
import * as store from "./store.js";
import { formatBytes, formatDateTime, formatDate, downloadBytes, safeFileName } from "./util.js";
import * as sigui from "./sigui.js";

let current = "props";

export function init() {
  $(".side--right .tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-panel]");
    if (b) showPanel(b.dataset.panel);
  });
}

export function showPanel(name) {
  current = name;
  $("#workspace").classList.remove("no-right");
  $$(".side--right .tabs__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.panel === name));
  $$(".side--right [data-panel-body]").forEach((p) => { p.hidden = p.dataset.panelBody !== name; });
  render(name);
}

function render(name) {
  if (!E.state) return;
  if (name === "props") renderProps();
  if (name === "comments") renderComments();
  if (name === "signatures") renderSignatures();
  if (name === "document") renderDocument();
}

export function refresh() {
  if (!E.state) return;
  render(current);
  updateCounts();
}

function updateCounts() {
  const n = commentItems().length;
  const cc = $("#comment-count");
  cc.hidden = !n;
  cc.textContent = n;
  const sc = $("#sig-count");
  const v = E.verification || [];
  sc.hidden = !v.length;
  sc.textContent = v.length;
}

/* ------------------------------ controls -------------------------------- */
function group(title, ...children) {
  return h("div.pgroup", {}, title ? h("div.pgroup__title", { html: title }) : null, ...children);
}
function row(label, control) {
  return h("div.prow", {}, h("span", { text: label }), control);
}
function stack(label, control) {
  return h("div.prow.prow--stack", {}, h("span", { text: label }), control);
}

function rangeCtl(value, min, max, step, onLive, onCommit, fmt) {
  const input = h("input", { type: "range", min, max, step, value });
  const out = h("span.range__value", { text: fmt ? fmt(value) : value });
  input.addEventListener("pointerdown", () => onLive.start && onLive.start());
  input.addEventListener("focus", () => onLive.start && onLive.start());
  input.addEventListener("input", () => { out.textContent = fmt ? fmt(+input.value) : input.value; onLive(+input.value); });
  input.addEventListener("change", () => onCommit(+input.value));
  return h("div.range", {}, input, out);
}

function selectCtl(options, value, onChange) {
  const sel = h("select.select.select--sm");
  for (const [v, label] of options) sel.append(h("option", { value: v, text: label, selected: String(v) === String(value) }));
  sel.addEventListener("change", () => onChange(sel.value));
  sel.addEventListener("keydown", (e) => e.stopPropagation());
  return sel;
}

function toggles(list) {
  const wrap = h("div.toggle-row");
  for (const t of list) {
    wrap.append(h("button.toggle", {
      type: "button", class: "toggle" + (t.active ? " is-active" : ""), title: t.title || "", "aria-pressed": !!t.active,
      html: t.icon ? icon(t.icon) : esc(t.label), onclick: t.onClick,
    }));
  }
  return wrap;
}

function numberCtl(value, min, max, step, onChange) {
  const input = h("input.input.input--sm", { type: "number", min, max, step, value, style: { width: "84px" } });
  input.addEventListener("change", () => { const v = parseFloat(input.value); if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v))); });
  input.addEventListener("keydown", (e) => e.stopPropagation());
  return input;
}

function textCtl(value, onChange, opts) {
  const input = h(opts && opts.multiline ? "textarea.textarea" : "input.input.input--sm", { type: "text", value: value || "", placeholder: (opts && opts.placeholder) || "" });
  if (opts && opts.multiline) input.value = value || "";
  input.addEventListener("change", () => onChange(input.value));
  input.addEventListener("keydown", (e) => e.stopPropagation());
  return input;
}

/* ------------------------- object property edits ------------------------ */
function edit(it, fn) {
  const before = E.snapshot();
  fn(it);
  if (it.type === "text") E.measureText(it);
  E.renderPage(it.page);
  E.commit(before);
  renderProps();
}
function live(it) {
  let before = null;
  const f = (fn) => (v) => { if (!before) before = E.snapshot(); fn(it, v); if (it.type === "text") E.measureText(it); E.renderPage(it.page); };
  f.commit = () => { if (before) { E.commit(before); before = null; } };
  return f;
}

function toolEdit(tool, fn) {
  const o = E.toolOpts[tool] || (E.toolOpts[tool] = { ...(DEFAULTS[tool] || {}) });
  fn(o);
  E.savePrefs();
  renderProps();
}

/* =============================== Properties ============================= */
const TOOL_INFO = {
  select: ["mouse-pointer-2", "Seç", "Bir nesneye tıklayarak seç; sürükleyerek taşı, tutamaçlarla boyutlandır."],
  hand: ["hand", "Kaydır", "Sayfayı sürükleyerek gez. Boşluk tuşunu basılı tutarak da kaydırabilirsin."],
  text: ["type", "Metin ekle", "Sayfada istediğin yere tıkla ve yaz."],
  edittext: ["text-cursor-input", "Metni düzenle", "Belgedeki bir metin satırına tıkla; satır aynı yazı tipi, boyut ve renkle düzenlenebilir hale gelir."],
  highlight: ["highlighter", "Vurgula", "Metni seç ya da boş alanda sürükle."],
  underline: ["underline", "Altını çiz", "Metni seç."],
  strike: ["strikethrough", "Üstünü çiz", "Metni seç."],
  pen: ["pen-line", "Kalem", "Serbest çizim."],
  marker: ["brush", "Fosforlu kalem", "Yarı saydam, metnin üstünden geçen çizim."],
  rect: ["square", "Dikdörtgen", "Sürükleyerek çiz. Shift: kare."],
  ellipse: ["circle", "Elips", "Sürükleyerek çiz. Shift: daire."],
  line: ["minus", "Çizgi", "Sürükleyerek çiz. Shift: 45° adımlar."],
  arrow: ["move-up-right", "Ok", "Sürükleyerek çiz. Shift: 45° adımlar."],
  note: ["message-square-text", "Yapışkan not", "Not, PDF okuyucularda yorum olarak görünür."],
  image: ["image", "Görsel", "Yerleştirmek için tıkla."],
  stamp: ["stamp", "Damga", "Yerleştirmek için tıkla."],
  check: ["check", "Onay işareti", "Form kutularını işaretlemek için tıkla."],
  cross: ["x", "Çarpı", "İşaretlemek için tıkla."],
  dot: ["circle-dot", "Nokta", "İşaretlemek için tıkla."],
  date: ["calendar", "Tarih", "Bugünün tarihini yerleştirmek için tıkla."],
  whiteout: ["eraser", "Beyaz kutu", "Bir alanın üstünü kapatır. İçerik dosyada kalır; kalıcı silmek için Karartma'yı kullan."],
  redact: ["eye-off", "Karartma", "Seçilen alandaki her şey indirirken dosyadan kalıcı olarak silinir."],
  signature: ["signature", "İmza", "İmzanı yerleştirmek için tıkla."],
  initials: ["pen-tool", "Paraf", "Parafını yerleştirmek için tıkla."],
  sigfield: ["file-pen-line", "Dijital imza alanı", "İmzanın görüneceği alanı sürükleyerek çiz."],
};

function head(iconName, title, sub) {
  return h("div.phead", {}, h("span.phead__icon", { html: icon(iconName) }), h("div", {}, h("div.phead__title", { text: title }), sub ? h("div.phead__sub", { text: sub }) : null));
}

export function renderProps() {
  const body = $("#panel-props");
  if (!body || !E.state) return;
  if (current !== "props") return;
  body.textContent = "";
  const it = E.selection && E.item(E.selection);
  if (it) itemProps(body, it);
  else toolProps(body, E.tool);
}

function colorGroup(title, palette, value, onPick, opts) {
  return group(title, swatchRow(palette, value, onPick, opts));
}

function fontControls(target, apply) {
  return [
    row("Yazı tipi", selectCtl(Object.entries(FONT_FAMILIES).map(([k, f]) => [k, f.label]), target.font || "sans", (v) => apply((o) => { o.font = v; }))),
    row("Boyut", h("div.toggle-row", {},
      numberCtl(target.size || 12, 4, 200, 0.5, (v) => apply((o) => { o.size = v; })),
      toggles([
        { icon: "bold", title: "Kalın", active: target.bold, onClick: () => apply((o) => { o.bold = !o.bold; }) },
        { icon: "italic", title: "İtalik", active: target.italic, onClick: () => apply((o) => { o.italic = !o.italic; }) },
      ]))),
    row("Hizalama", toggles([
      { icon: "align-left", title: "Sola", active: (target.align || "left") === "left", onClick: () => apply((o) => { o.align = "left"; }) },
      { icon: "align-center", title: "Ortala", active: target.align === "center", onClick: () => apply((o) => { o.align = "center"; }) },
      { icon: "align-right", title: "Sağa", active: target.align === "right", onClick: () => apply((o) => { o.align = "right"; }) },
    ])),
  ];
}

function itemProps(body, it) {
  const labels = { text: ["type", "Metin"], image: ["image", it.kind === "signature" ? "İmza" : it.kind === "initials" ? "Paraf" : "Görsel"], stamp: ["stamp", "Damga"], note: ["message-square-text", "Not"], highlight: ["highlighter", "İşaretleme"], path: ["pen-line", "Çizim"], line: [it.head ? "move-up-right" : "minus", it.head ? "Ok" : "Çizgi"], rect: ["square", "Dikdörtgen"], ellipse: ["circle", "Elips"], mark: ["check", "İşaret"], whiteout: ["eraser", "Beyaz kutu"], redact: ["eye-off", "Karartma"] };
  const [ic, label] = labels[it.type] || ["square", "Nesne"];
  const pageNo = E.pageIndex(it.page) + 1;
  body.append(head(ic, label, `Sayfa ${pageNo}`));
  const L = live(it);
  const ed = (fn) => edit(it, fn);
  switch (it.type) {
    case "text": {
      if (it.origin === "edit") body.append(h("div.tip", { html: icon("info") + "<span>Orijinal satır örtüldü ve yerine bu metin yazıldı. Bu nesneyi silersen orijinal metin geri gelir.</span>" }), h("div", { style: { height: "12px" } }));
      body.append(group("Metin", ...fontControls(it, ed)));
      body.append(colorGroup("Renk", COLORS, it.color, (c) => ed((o) => { o.color = c || "#111111"; })));
      body.append(colorGroup("Arka plan", FILLS, it.bg, (c) => ed((o) => { o.bg = c; }), { allowNone: true }));
      if (it.cover) body.append(colorGroup("Örtü rengi", ["#ffffff", ...FILLS.slice(1)], it.cover.color, (c) => ed((o) => { o.cover.color = c || "#ffffff"; })));
      body.append(group("Kutu",
        row("Genişlik", toggles([
          { label: "Otomatik", active: it.autoW, onClick: () => ed((o) => { o.autoW = true; }) },
          { label: "Sabit (kaydır)", active: !it.autoW, onClick: () => ed((o) => { o.autoW = false; }) },
        ])),
        row("Opaklık", rangeCtl(it.opacity == null ? 1 : it.opacity, 0.1, 1, 0.05, L((o, v) => { o.opacity = v; }), L.commit, (v) => Math.round(v * 100) + "%")),
        row("Açı", numberCtl(Math.round(it.rotation || 0), -360, 360, 1, (v) => ed((o) => { o.rotation = ((v % 360) + 360) % 360; })))));
      break;
    }
    case "image":
      body.append(group("Görünüm",
        row("Opaklık", rangeCtl(it.opacity == null ? 1 : it.opacity, 0.1, 1, 0.05, L((o, v) => { o.opacity = v; }), L.commit, (v) => Math.round(v * 100) + "%")),
        row("Açı", h("div.toggle-row", {}, numberCtl(Math.round(it.rotation || 0), -360, 360, 1, (v) => ed((o) => { o.rotation = ((v % 360) + 360) % 360; })),
          toggles([{ icon: "rotate-cw", title: "90° döndür", onClick: () => ed((o) => { o.rotation = ((o.rotation || 0) + 90) % 360; }) }])))),
        h("div.tip", { html: icon("info") + "<span>Köşeden boyutlandırırken oran korunur; Shift ile serbest boyutlandır.</span>" }));
      break;
    case "stamp":
      body.append(group("Damga",
        stack("Metin", textCtl(it.text, (v) => ed((o) => { o.text = v.toLocaleUpperCase("tr-TR") || o.text; }))),
        stack("Alt satır", textCtl(it.sub, (v) => ed((o) => { o.sub = v; }), { placeholder: "Tarih, ad…" })),
        row("Opaklık", rangeCtl(it.opacity == null ? 0.9 : it.opacity, 0.2, 1, 0.05, L((o, v) => { o.opacity = v; }), L.commit, (v) => Math.round(v * 100) + "%")),
        row("Açı", numberCtl(Math.round(it.rotation || 0), -360, 360, 1, (v) => ed((o) => { o.rotation = ((v % 360) + 360) % 360; })))));
      body.append(colorGroup("Renk", ["#1f7a4a", "#c0352b", "#1d3fbf", "#4b5563", "#7c3aed", "#f57c00"], it.color, (c) => ed((o) => { o.color = c || "#1f7a4a"; })));
      break;
    case "note": {
      const ta = textCtl(it.text, (v) => ed((o) => { o.text = v; }), { multiline: true });
      body.append(group("Yorum", ta, h("div.fineprint", { text: `${it.author || ""} · ${it.date ? formatDateTime(it.date) : ""}` })));
      body.append(colorGroup("Renk", ["#f5c518", "#ff8a65", "#7ad18c", "#6fb7ff", "#c792ea"], it.color, (c) => ed((o) => { o.color = c || "#f5c518"; }), { custom: false }));
      break;
    }
    case "highlight":
      body.append(group("Tür", toggles([
        { icon: "highlighter", title: "Vurgu", active: it.style === "highlight", onClick: () => ed((o) => { o.style = "highlight"; if (!HIGHLIGHTS.includes(o.color)) o.color = HIGHLIGHTS[0]; }) },
        { icon: "underline", title: "Altı çizili", active: it.style === "underline", onClick: () => ed((o) => { o.style = "underline"; }) },
        { icon: "strikethrough", title: "Üstü çizili", active: it.style === "strike", onClick: () => ed((o) => { o.style = "strike"; }) },
      ])));
      body.append(colorGroup("Renk", it.style === "highlight" ? HIGHLIGHTS : COLORS, it.color, (c) => ed((o) => { o.color = c || HIGHLIGHTS[0]; })));
      if (it.text) body.append(group("Metin", h("div.citem__quote", { text: it.text })));
      break;
    case "path":
      body.append(colorGroup("Renk", it.blend === "multiply" ? HIGHLIGHTS : COLORS, it.color, (c) => ed((o) => { o.color = c || "#111111"; })));
      body.append(group("Çizgi",
        row("Kalınlık", rangeCtl(it.width, 0.5, 30, 0.5, L((o, v) => { o.width = v; }), L.commit, (v) => v + " pt")),
        row("Opaklık", rangeCtl(it.opacity == null ? 1 : it.opacity, 0.1, 1, 0.05, L((o, v) => { o.opacity = v; }), L.commit, (v) => Math.round(v * 100) + "%"))));
      break;
    case "line":
      body.append(colorGroup("Renk", COLORS, it.color, (c) => ed((o) => { o.color = c || "#111111"; })));
      body.append(group("Çizgi",
        row("Kalınlık", rangeCtl(it.width, 0.5, 20, 0.5, L((o, v) => { o.width = v; }), L.commit, (v) => v + " pt")),
        row("Stil", toggles([
          { label: "Düz", active: !it.dash, onClick: () => ed((o) => { o.dash = false; }) },
          { label: "Kesikli", active: !!it.dash, onClick: () => ed((o) => { o.dash = true; }) },
          { icon: "move-up-right", title: "Ok ucu", active: !!it.head, onClick: () => ed((o) => { o.head = o.head ? null : "end"; }) },
        ])),
        row("Opaklık", rangeCtl(it.opacity == null ? 1 : it.opacity, 0.1, 1, 0.05, L((o, v) => { o.opacity = v; }), L.commit, (v) => Math.round(v * 100) + "%"))));
      break;
    case "rect":
    case "ellipse":
      body.append(colorGroup("Kenar", COLORS, it.stroke, (c) => ed((o) => { o.stroke = c; }), { allowNone: true }));
      body.append(colorGroup("Dolgu", FILLS, it.fill, (c) => ed((o) => { o.fill = c; }), { allowNone: true }));
      body.append(group("Çizgi",
        row("Kalınlık", rangeCtl(it.width || 1, 0.5, 20, 0.5, L((o, v) => { o.width = v; }), L.commit, (v) => v + " pt")),
        row("Stil", toggles([
          { label: "Düz", active: !it.dash, onClick: () => ed((o) => { o.dash = false; }) },
          { label: "Kesikli", active: !!it.dash, onClick: () => ed((o) => { o.dash = true; }) },
        ])),
        row("Opaklık", rangeCtl(it.opacity == null ? 1 : it.opacity, 0.1, 1, 0.05, L((o, v) => { o.opacity = v; }), L.commit, (v) => Math.round(v * 100) + "%"))));
      break;
    case "mark":
      body.append(group("İşaret", toggles([
        { icon: "check", title: "Onay", active: it.glyph === "check", onClick: () => ed((o) => { o.glyph = "check"; }) },
        { icon: "x", title: "Çarpı", active: it.glyph === "cross", onClick: () => ed((o) => { o.glyph = "cross"; }) },
        { icon: "circle-dot", title: "Nokta", active: it.glyph === "dot", onClick: () => ed((o) => { o.glyph = "dot"; }) },
      ])));
      body.append(colorGroup("Renk", COLORS, it.color, (c) => ed((o) => { o.color = c || "#111111"; })));
      break;
    case "whiteout":
      body.append(colorGroup("Renk", ["#ffffff", "#f8f6f1", "#fffbe6", "#f1f5f9"], it.color, (c) => ed((o) => { o.color = c || "#ffffff"; })));
      body.append(h("div.tip.tip--warn", { html: icon("triangle-alert") + "<span>Beyaz kutu yalnızca üstünü örter; alttaki metin dosyada kalır ve kopyalanabilir. Kalıcı silmek için Karartma'yı kullan.</span>" }));
      break;
    case "redact":
      body.append(h("div.tip.tip--danger", { html: icon("eye-off") + "<span>Bu alan indirirken kalıcı olarak silinir: sayfa yüksek çözünürlüklü görüntüye dönüştürülür ve alanın altındaki metin, görsel ve bağlantılar dosyadan çıkarılır.</span>" }));
      break;
    default: break;
  }
  body.append(group("Düzen", h("div.pactions", {},
    h("button.btn.btn--sm", { type: "button", html: icon("arrow-up") + "Öne getir", onclick: () => reorder(it, 1) }),
    h("button.btn.btn--sm", { type: "button", html: icon("arrow-down") + "Arkaya gönder", onclick: () => reorder(it, -1) }),
    h("button.btn.btn--sm", { type: "button", html: icon("copy") + "Çoğalt", onclick: () => { const ev = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true }); document.dispatchEvent(ev); } }),
    h("button.btn.btn--sm.btn--danger-ghost", { type: "button", html: icon("trash-2") + "Sil", onclick: () => { const ev = new KeyboardEvent("keydown", { key: "Delete", bubbles: true }); document.dispatchEvent(ev); } }))));
}

function reorder(it, dir) {
  const before = E.snapshot();
  const list = E.state.items;
  const i = list.indexOf(it);
  list.splice(i, 1);
  if (dir > 0) list.push(it); else list.unshift(it);
  E.renderPage(it.page);
  E.commit(before);
}

function toolProps(body, tool) {
  const info = TOOL_INFO[tool] || TOOL_INFO.select;
  body.append(head(info[0], info[1], info[2]));
  const o = E.toolOpts[tool] || (E.toolOpts[tool] = { ...(DEFAULTS[tool] || {}) });
  const te = (fn) => toolEdit(tool, fn);
  switch (tool) {
    case "text":
    case "date":
      if (tool === "date") {
        body.append(group("Biçim", selectCtl([["dd.mm.yyyy", "06.10.2026"], ["d mmmm yyyy", "6 Ekim 2026"], ["dd/mm/yyyy", "06/10/2026"], ["yyyy-mm-dd", "2026-10-06"]], o.format || "dd.mm.yyyy", (v) => te((x) => { x.format = v; }))));
        body.append(group("Metin", row("Boyut", numberCtl(o.size || 12, 4, 200, 0.5, (v) => te((x) => { x.size = v; })))));
      } else {
        body.append(group("Metin", ...fontControls(o, te)));
        body.append(colorGroup("Arka plan", FILLS, o.bg, (c) => te((x) => { x.bg = c; }), { allowNone: true }));
      }
      body.append(colorGroup("Renk", COLORS, o.color, (c) => te((x) => { x.color = c || "#111111"; })));
      break;
    case "highlight":
      body.append(colorGroup("Renk", HIGHLIGHTS, o.color, (c) => te((x) => { x.color = c || HIGHLIGHTS[0]; })));
      break;
    case "underline":
    case "strike":
      body.append(colorGroup("Renk", COLORS, o.color, (c) => te((x) => { x.color = c || "#111111"; })));
      break;
    case "pen":
    case "marker":
      body.append(colorGroup("Renk", tool === "marker" ? HIGHLIGHTS : COLORS, o.color, (c) => te((x) => { x.color = c || "#111111"; })));
      body.append(group("Çizgi",
        row("Kalınlık", rangeCtl(o.width, 0.5, 30, 0.5, (v) => { o.width = v; E.savePrefs(); }, () => null, (v) => v + " pt")),
        row("Opaklık", rangeCtl(o.opacity == null ? 1 : o.opacity, 0.1, 1, 0.05, (v) => { o.opacity = v; E.savePrefs(); }, () => null, (v) => Math.round(v * 100) + "%"))));
      break;
    case "rect":
    case "ellipse":
      body.append(colorGroup("Kenar", COLORS, o.stroke, (c) => te((x) => { x.stroke = c; }), { allowNone: true }));
      body.append(colorGroup("Dolgu", FILLS, o.fill, (c) => te((x) => { x.fill = c; }), { allowNone: true }));
      body.append(group("Çizgi",
        row("Kalınlık", rangeCtl(o.width, 0.5, 20, 0.5, (v) => { o.width = v; E.savePrefs(); }, () => null, (v) => v + " pt")),
        row("Stil", toggles([{ label: "Düz", active: !o.dash, onClick: () => te((x) => { x.dash = false; }) }, { label: "Kesikli", active: !!o.dash, onClick: () => te((x) => { x.dash = true; }) }]))));
      break;
    case "line":
    case "arrow":
      body.append(colorGroup("Renk", COLORS, o.color, (c) => te((x) => { x.color = c || "#111111"; })));
      body.append(group("Çizgi",
        row("Kalınlık", rangeCtl(o.width, 0.5, 20, 0.5, (v) => { o.width = v; E.savePrefs(); }, () => null, (v) => v + " pt")),
        row("Stil", toggles([{ label: "Düz", active: !o.dash, onClick: () => te((x) => { x.dash = false; }) }, { label: "Kesikli", active: !!o.dash, onClick: () => te((x) => { x.dash = true; }) }]))));
      break;
    case "check":
    case "cross":
    case "dot":
      body.append(colorGroup("Renk", COLORS, o.color, (c) => te((x) => { x.color = c || "#111111"; })));
      body.append(group("Boyut", row("Boyut", numberCtl(o.size || 18, 6, 72, 1, (v) => te((x) => { x.size = v; })))));
      break;
    case "note":
      body.append(colorGroup("Renk", ["#f5c518", "#ff8a65", "#7ad18c", "#6fb7ff", "#c792ea"], o.color, (c) => te((x) => { x.color = c || "#f5c518"; }), { custom: false }));
      break;
    case "stamp": {
      body.append(group("Damga", selectCtl([...STAMPS.map((s) => [s.id, s.text]), ["custom", "Özel: " + (o.preset === "custom" ? o.text : "…")]], o.preset, (v) => te((x) => {
        x.preset = v;
        const s = STAMPS.find((k) => k.id === v);
        if (s) { x.text = s.text; x.color = s.color; }
      })),
      row("Alt satır", selectCtl([["date-name", "Tarih · Ad"], ["date", "Tarih"], ["name", "Ad"], ["none", "Yok"]], o.sub || "date-name", (v) => te((x) => { x.sub = v; })))));
      body.append(colorGroup("Renk", ["#1f7a4a", "#c0352b", "#1d3fbf", "#4b5563", "#7c3aed", "#f57c00"], o.color, (c) => te((x) => { x.color = c || "#1f7a4a"; })));
      body.append(h("button.btn.btn--sm", { type: "button", html: icon("stamp") + "Damgayı yeniden hazırla", onclick: () => E.setTool("stamp") }));
      break;
    }
    case "whiteout":
      body.append(colorGroup("Renk", ["#ffffff", "#f8f6f1", "#fffbe6", "#f1f5f9"], o.color, (c) => te((x) => { x.color = c || "#ffffff"; })));
      break;
    case "redact":
      body.append(h("div.tip.tip--danger", { html: icon("eye-off") + "<span>Karartılan sayfalar indirirken görüntüye dönüştürülür; alandaki içerik dosyadan tamamen çıkarılır. Sayfanın geri kalanındaki metin seçilemez hale gelir.</span>" }));
      break;
    case "signature":
    case "initials":
      body.append(group("İmzalarım", sigui.signatureTiles((sig) => E.setTool(sig.kind === "initials" ? "initials" : "signature", sig))));
      break;
    case "select":
    case "hand":
    default:
      body.append(docSummary());
      body.append(group("Kısayollar", shortcuts()));
  }
}

function docSummary() {
  const s = E.state;
  const n = s.items.length;
  return group("Belge",
    h("dl.kv", {},
      h("dt", { text: "Sayfa" }), h("dd", { text: s.pages.length }),
      h("dt", { text: "Nesne" }), h("dd", { text: n ? `${n} ekleme` : "Değişiklik yok" }),
      h("dt", { text: "Dosya" }), h("dd", { text: formatBytes(E.doc.size || 0) }),
      h("dt", { text: "Sürüm" }), h("dd", { text: E.doc.versions[E.doc.versions.length - 1].label })));
}

function shortcuts() {
  const list = [["V", "Seç"], ["H / Boşluk", "Kaydır"], ["T", "Metin ekle"], ["E", "Metni düzenle"], ["U", "Vurgula"], ["P", "Kalem"], ["R / O", "Dikdörtgen / elips"], ["L / A", "Çizgi / ok"], ["N", "Not"], ["S", "İmza"], ["X", "Karartma"], ["Ctrl+Z", "Geri al"], ["Ctrl+D", "Çoğalt"], ["Ctrl+F", "Ara"], ["Ctrl+P", "Yazdır"]];
  const dl = h("dl.kv");
  for (const [k, v] of list) dl.append(h("dt", { html: k.split(" / ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" ") }), h("dd", { text: v }));
  return dl;
}

/* =============================== Comments =============================== */
function commentItems() {
  if (!E.state) return [];
  return E.state.items.filter((it) => it.type === "note" || (it.type === "highlight" && it.text));
}

function renderComments() {
  const body = $("#panel-comments");
  body.textContent = "";
  const list = commentItems().slice().sort((a, b) => E.pageIndex(a.page) - E.pageIndex(b.page) || (a.y || (a.rects && a.rects[0][1]) || 0) - (b.y || (b.rects && b.rects[0][1]) || 0));
  if (!list.length) {
    body.append(h("div.empty", { html: icon("message-square-text", "icon--xl") + "<p>Henüz yorum yok.<br>Not aracıyla (N) yorum bırak ya da metin vurgula.</p>" }));
    return;
  }
  const wrap = h("div.clist");
  for (const it of list) {
    const isNote = it.type === "note";
    const card = h("div.citem", { dataset: { id: it.id }, class: "citem" + (E.selection === it.id ? " is-selected" : "") },
      h("div.citem__head", { html: `<span class="citem__dot" style="background:${esc(it.color)}"></span><span class="citem__who">${esc(isNote ? it.author || "Not" : { highlight: "Vurgu", underline: "Altı çizili", strike: "Üstü çizili" }[it.style])}</span><span>Sayfa ${E.pageIndex(it.page) + 1}</span>` }),
      isNote ? h("div.citem__body", { text: it.text || "(boş not)" }) : h("div.citem__quote", { text: it.text }));
    card.addEventListener("click", () => {
      const y = isNote ? it.y : it.rects[0][1];
      E.scrollToPage(it.page, y);
      E.select(it.id);
    });
    card.addEventListener("dblclick", () => { if (isNote) E.openNote(it.id); });
    wrap.append(card);
  }
  body.append(wrap);
}

export function syncComments() {
  $$("#panel-comments .citem").forEach((c) => c.classList.toggle("is-selected", c.dataset.id === E.selection));
}

/* ============================== Signatures ============================== */
export function renderSignatures() {
  updateCounts();
  const body = $("#panel-signatures");
  if (!body) return;
  body.textContent = "";
  const v = E.verification;
  if (v && v.length) {
    body.append(h("div.pgroup__title", { text: "Belgedeki imzalar", style: { marginBottom: "10px" } }));
    for (const r of v) body.append(sigui.verificationCard(r));
  } else {
    body.append(h("div.tip", { html: icon("shield") + "<span>Bu belgede dijital imza yok.</span>" }), h("div", { style: { height: "14px" } }));
  }
  body.append(group("Bu belgeyi imzala",
    h("p.fineprint", { text: "Görsel imza belgeye imzanın resmini ekler. Dijital imza ise belgeyi kriptografik olarak mühürler: sonradan yapılan her değişiklik PDF okuyucularda görünür." }),
    h("div.pactions", {},
      h("button.btn.btn--sm", { type: "button", html: icon("signature") + "Görsel imza ekle", onclick: () => E.setTool("signature") }),
      h("button.btn.btn--sm.btn--seal", { type: "button", html: icon("file-pen-line") + "Dijital olarak imzala", onclick: () => sigui.openDigitalSign() }))));
  body.append(group("Dijital kimlik", sigui.identitySummary()));
}

/* =============================== Document =============================== */
function renderDocument() {
  const body = $("#panel-document");
  body.textContent = "";
  const s = E.state;
  const meta = s.meta || (s.meta = {});
  const metaEdit = (key) => (v) => { const before = E.snapshot(); meta[key] = v; s.metaChanged = true; E.commit(before); };
  body.append(group("Özellikler",
    stack("Başlık", textCtl(meta.title, metaEdit("title"))),
    stack("Yazar", textCtl(meta.author, metaEdit("author"), { placeholder: E.user.name })),
    stack("Konu", textCtl(meta.subject, metaEdit("subject"))),
    stack("Anahtar kelimeler", textCtl(meta.keywords, metaEdit("keywords"), { placeholder: "virgülle ayır" }))));

  // watermark
  const wm = s.watermark;
  const wmEdit = (fn) => { const before = E.snapshot(); fn(); E.renderDeco(); E.commit(before); };
  const wmToggle = h("input", { type: "checkbox", checked: !!wm });
  wmToggle.addEventListener("change", () => wmEdit(() => { s.watermark = wmToggle.checked ? { text: "TASLAK", size: 72, color: "#c0352b", opacity: 0.16, angle: 45 } : null; }));
  const wmGroup = group(`Filigran <label class="check">${""}</label>`);
  wmGroup.querySelector(".check").append(wmToggle);
  if (wm) {
    wmGroup.append(
      stack("Metin", textCtl(wm.text, (v) => wmEdit(() => { wm.text = v; }))),
      row("Boyut", numberCtl(wm.size, 12, 240, 2, (v) => wmEdit(() => { wm.size = v; }))),
      row("Açı", numberCtl(wm.angle, -90, 90, 5, (v) => wmEdit(() => { wm.angle = v; }))),
      row("Opaklık", rangeCtl(wm.opacity, 0.04, 0.8, 0.02, (v) => { wm.opacity = v; E.renderDeco(); }, () => wmEdit(() => null), (v) => Math.round(v * 100) + "%")),
      swatchRow(["#c0352b", "#4b5563", "#1d3fbf", "#1f7a4a", "#111111"], wm.color, (c) => wmEdit(() => { wm.color = c || "#c0352b"; })));
  }
  body.append(wmGroup);

  // page numbers
  const pn = s.pageNumbers;
  const pnEdit = (fn) => { const before = E.snapshot(); fn(); E.renderDeco(); E.commit(before); };
  const pnToggle = h("input", { type: "checkbox", checked: !!pn });
  pnToggle.addEventListener("change", () => pnEdit(() => { s.pageNumbers = pnToggle.checked ? { format: "{n} / {t}", position: "bc", size: 10, start: 1, skipFirst: false, color: "#333333" } : null; }));
  const pnGroup = group(`Sayfa numaraları <label class="check"></label>`);
  pnGroup.querySelector(".check").append(pnToggle);
  if (pn) {
    pnGroup.append(
      row("Biçim", selectCtl([["{n}", "1"], ["{n} / {t}", "1 / 12"], ["Sayfa {n}", "Sayfa 1"], ["Sayfa {n} / {t}", "Sayfa 1 / 12"], ["- {n} -", "- 1 -"]], pn.format, (v) => pnEdit(() => { pn.format = v; }))),
      row("Konum", selectCtl([["bc", "Alt orta"], ["br", "Alt sağ"], ["bl", "Alt sol"], ["tc", "Üst orta"], ["tr", "Üst sağ"], ["tl", "Üst sol"]], pn.position, (v) => pnEdit(() => { pn.position = v; }))),
      row("Boyut", numberCtl(pn.size, 6, 36, 1, (v) => pnEdit(() => { pn.size = v; }))),
      row("İlk numara", numberCtl(pn.start || 1, 0, 9999, 1, (v) => pnEdit(() => { pn.start = v; }))),
      h("label.check", {}, (() => { const c = h("input", { type: "checkbox", checked: !!pn.skipFirst }); c.addEventListener("change", () => pnEdit(() => { pn.skipFirst = c.checked; })); return c; })(), h("span", { text: "Kapak sayfasında gösterme" })));
  }
  body.append(pnGroup);

  // versions
  const versions = h("div.versions");
  E.doc.versions.slice().reverse().forEach((ver, ri) => {
    const isCur = ri === 0;
    versions.append(h("div.version", { class: "version" + (isCur ? " is-current" : "") },
      h("span", { html: icon(ver.signed ? "badge-check" : "file-text") }),
      h("div.version__text", {}, h("span.version__label", { text: ver.label }), h("span.version__sub", { text: `${formatDateTime(ver.created)} · ${formatBytes(ver.size)}` })),
      h("button.ibtn.ibtn--sm", { type: "button", title: "İndir", "aria-label": "İndir", html: icon("download"), onclick: async () => {
        const bytes = await store.getBlob(ver.blob);
        downloadBytes(bytes, safeFileName(`${E.doc.name} (${ver.label})`, "pdf"));
      } }),
      isCur ? null : h("button.ibtn.ibtn--sm", { type: "button", title: "Bu sürüme dön", "aria-label": "Bu sürüme dön", html: icon("history"), onclick: () => restoreVersion(ver) })));
  });
  body.append(group("Sürümler", versions, h("p.fineprint", { text: "Dijital imza ve 'yeni sürüm olarak kaydet' yeni bir sürüm oluşturur. Eski sürümler silinmez." }),
    h("button.btn.btn--sm", { type: "button", html: icon("layers") + "Değişiklikleri yeni sürüm olarak kaydet", onclick: saveAsVersion })));

  body.append(group("Bilgi", h("dl.kv", {},
    h("dt", { text: "Oluşturma" }), h("dd", { text: formatDate(E.doc.created) }),
    h("dt", { text: "Değişiklik" }), h("dd", { text: formatDateTime(E.doc.modified) }),
    h("dt", { text: "Sayfa" }), h("dd", { text: E.state.pages.length }),
    h("dt", { text: "Boyut" }), h("dd", { text: formatBytes(E.doc.size || 0) }),
    h("dt", { text: "Saklama" }), h("dd", { text: "Bu cihazda, AES-256-GCM ile şifreli" }))));
}

async function saveAsVersion() {
  const ok = await confirmDialog({ title: "Yeni sürüm olarak kaydet", message: "Tüm eklemeler belgeye işlenir ve düzenlenebilir katman sıfırlanır. Önceki hal 'Sürümler' listesinde kalır.", confirm: "Kaydet" });
  if (!ok) return;
  const { addVersion } = await import("./docs.js");
  const b = (await import("./ui.js")).busy("Sürüm oluşturuluyor…");
  try {
    const bytes = await E.buildBytes({ force: true });
    await addVersion(E.doc, bytes, "Düzenlendi · " + formatDateTime(Date.now()));
    await store.deleteState(E.doc.id);
    await E.reloadVersion();
    toast("Yeni sürüm kaydedildi.", "ok");
  } catch (err) {
    toast("Sürüm oluşturulamadı: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

async function restoreVersion(ver) {
  const ok = await confirmDialog({ title: "Bu sürüme dönülsün mü?", message: `“${esc(ver.label)}” yeni bir sürüm olarak en üste eklenir; mevcut düzenlemeler bu sürüme taşınmaz.`, confirm: "Geri yükle" });
  if (!ok) return;
  const now = Date.now();
  E.doc.versions.push({ ...ver, id: "v_" + now.toString(36), label: "Geri yüklendi: " + ver.label, created: now });
  E.doc.size = ver.size;
  E.doc.signed = !!ver.signed;
  await store.putDoc(E.doc);
  await store.deleteState(E.doc.id);
  await E.reloadVersion();
  toast("Sürüm geri yüklendi.", "ok");
}
