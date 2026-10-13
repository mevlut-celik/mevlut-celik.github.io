/* ==========================================================================
   Mühür — ocrui.js
   The editor's OCR: the dialog (language, which pages, quality), progress
   with cancel, and the banner shown when an opened document looks
   scanned. The recognised text is written into the document as an
   invisible layer (ocr.js) and saved as a new version, so the page looks
   the same but can be searched, selected, copied and edited.
   ========================================================================== */

import { E } from "./ed.js";
import * as store from "./store.js";
import { $, h, icon, toast, dialog, confirmDialog } from "./ui.js";
import { pdflib } from "./libs.js";
import { isPristine } from "./pdfwork.js";
import { addVersion } from "./docs.js";
import { ocrPdf, scannedPages, LANGS } from "./ocr.js";

const PREF = "muhur.ocr";

function prefs() {
  try { return { langs: "tur+eng", dpi: 300, ...JSON.parse(localStorage.getItem(PREF) || "{}") }; } catch (e) { return { langs: "tur+eng", dpi: 300 }; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF, JSON.stringify({ langs: p.langs, dpi: p.dpi })); } catch (e) { /* storage blocked */ }
}

function segment(options, value, onPick) {
  const seg = h("div.segment.segment--sm", { role: "radiogroup" });
  for (const [v, label] of options) {
    seg.append(h("button.segment__btn", {
      type: "button", role: "radio", class: "segment__btn" + (String(v) === String(value) ? " is-active" : ""),
      "aria-checked": String(v) === String(value), text: label,
      onclick: (e) => {
        for (const b of seg.children) { b.classList.toggle("is-active", b === e.currentTarget); b.setAttribute("aria-checked", b === e.currentTarget); }
        onPick(v);
      },
    }));
  }
  return seg;
}

/* --------------------------------- Dialog -------------------------------- */
export async function openOcrDialog(preset) {
  if (!E.open) return;
  const p = prefs();
  const sel = E.state.pages.filter((pg) => E.pageSel.has(pg.id));
  const curIndex = E.pageIndex(E.current);
  const scope = { mode: preset || (sel.length > 1 ? "selected" : "auto") };
  const signed = (E.verification || []).length;
  const edited = !isPristine(E.state);

  const scopes = [["auto", "Taranmış sayfalar"], ["all", "Tüm sayfalar"], ["current", `Bu sayfa (${curIndex + 1})`]];
  if (sel.length > 1) scopes.push(["selected", `Seçili ${sel.length} sayfa`]);

  const bar = h("span.progress__bar");
  const label = h("span.progress__label", { text: "Hazırlanıyor…" });
  const progress = h("div.progress", { hidden: true }, h("span.progress__track", {}, bar), label);
  const form = h("div.form",
    {},
    h("div.field", {}, h("span.field__label", { text: "Belgenin dili" }), segment(Object.entries(LANGS), p.langs, (v) => { p.langs = v; })),
    h("div.field", {}, h("span.field__label", { text: "Hangi sayfalar" }), segment(scopes, scope.mode, (v) => { scope.mode = v; })),
    h("div.field", {}, h("span.field__label", { text: "Kalite" }), segment([[200, "Hızlı · 200 dpi"], [300, "Dengeli · 300 dpi"]], p.dpi, (v) => { p.dpi = Number(v); }),
      h("span.field__hint", { text: "Küçük yazılı ya da soluk taramalarda 300 dpi daha iyi sonuç verir; sayfa başına birkaç saniye sürer." })),
  );
  const notes = h("div", { style: { display: "grid", gap: "8px" } },
    h("div.tip", { html: icon("info") + "<span>OCR sayfanın görünümünü değiştirmez: tanınan metin, sayfanın üstüne görünmez ama seçilebilir bir katman olarak yazılır. Sonuç yeni bir sürüm olarak kaydedilir; tanıma tamamen bu cihazda yapılır.</span>" }));
  if (edited) notes.append(h("div.tip", { html: icon("layers") + "<span>Belgedeki düzenlemeler de bu sürüme işlenir.</span>" }));
  if (signed) notes.append(h("div.tip.tip--danger", { html: icon("shield-x") + `<span>Belgede ${signed} dijital imza var. OCR dosyayı değiştirdiği için bu imzalar geçersiz olur.</span>` }));
  const body = h("div", { style: { display: "grid", gap: "16px" } }, form, notes, progress);

  let controller = null;
  let running = false;
  const d = dialog({
    title: "Metni tanı (OCR)",
    sub: "Taranmış ya da fotoğrafı çekilmiş sayfaları aranabilir ve seçilebilir metne çevirir.",
    body,
    size: "md",
    dismissable: true,
    actions: [
      { label: "Vazgeç", id: "cancel", onClick: ({ close }) => {
        if (running && controller) { controller.abort(); label.textContent = "İptal ediliyor…"; return false; }
        close(null);
        return false;
      } },
      { label: "Metni tanı", kind: "primary", icon: "scan-text", id: "start", onClick: async ({ close, el }) => {
        if (running) return false;
        if (signed && !(await confirmDialog({ title: "İmzalar geçersiz olacak", message: "OCR uygulanınca belgedeki dijital imzalar geçersiz olur. Devam edilsin mi?", confirm: "Devam et", danger: true }))) return false;
        running = true;
        savePrefs(p);
        controller = new AbortController();
        form.style.opacity = "0.5";
        form.style.pointerEvents = "none";
        progress.hidden = false;
        el.querySelector('[data-action="start"]').disabled = true;
        el.querySelector('[data-action="cancel"]').textContent = "İptal";
        try {
          const result = await run({ ...p, mode: scope.mode, selected: sel, current: curIndex, signal: controller.signal, onProgress: (done, total, text) => {
            bar.style.width = (total ? Math.min(100, (done / total) * 100) : 0).toFixed(1) + "%";
            label.textContent = text || "";
          } });
          close(result);
        } catch (err) {
          running = false;
          form.style.opacity = "";
          form.style.pointerEvents = "";
          progress.hidden = true;
          el.querySelector('[data-action="start"]').disabled = false;
          el.querySelector('[data-action="cancel"]').textContent = "Vazgeç";
          if (err && err.name === "AbortError") { toast("OCR iptal edildi.", "warn"); close(null); return false; }
          console.error(err);
          toast("OCR tamamlanamadı: " + (err.message || err), "error");
        }
        return false;
      } },
    ],
  });
  const result = await d.result;
  // closed with Esc or the × while recognising: stop the run as well
  if (result == null && running && controller) controller.abort();
  if (result) finish(result);
}

async function run({ langs, dpi, mode, selected, current, signal, onProgress }) {
  await pdflib();
  const bytes = isPristine(E.state) ? E.sources.get("main").bytes.slice() : await E.buildBytes({ force: true });
  let pages = mode;
  if (mode === "current") pages = [current];
  if (mode === "selected") pages = selected.map((pg) => E.pageIndex(pg.id)).sort((a, b) => a - b);
  const res = await ocrPdf(bytes, { pages, langs, dpi, signal, onProgress });
  if (!res.pages.length) return { empty: true };
  onProgress(1, 1, "Yeni sürüm kaydediliyor");
  await addVersion(E.doc, res.bytes, `OCR uygulandı · ${res.pages.length} sayfa`);
  await store.deleteState(E.doc.id);
  E.doc.ocr = { at: Date.now(), pages: res.pages.length, words: res.words };
  await store.putDoc(E.doc);
  await E.reloadVersion();
  return res;
}

function finish(res) {
  hideBanner();
  if (res.empty) {
    toast("Taranmış sayfa bulunamadı: sayfalar zaten seçilebilir metin içeriyor. Yine de tanımak için 'Tüm sayfalar'ı seç.", "info", { timeout: 7000 });
    return;
  }
  if (!res.words) {
    toast(`${res.pages.length} sayfada okunabilir metin bulunamadı.`, "warn");
    return;
  }
  toast(`${res.pages.length} sayfada ${res.words.toLocaleString("tr-TR")} kelime tanındı. Artık metni arayabilir, seçebilir ve düzenleyebilirsin.`, "ok", { timeout: 7000 });
}

/* --------------------------------- Banner -------------------------------- */
function hideBanner() {
  const b = $("#ocr-banner");
  if (b) b.hidden = true;
}

// Called when a document opens: look at the first pages and offer OCR
// when they are images without text.
export async function checkScanned() {
  hideBanner();
  const doc = E.doc;
  if (!doc || doc.ocrHintOff) return;
  const src = E.sources.get("main");
  if (!src) return;
  let pages;
  try { pages = await scannedPages(src.pdf, 3); } catch (e) { return; }
  if (!pages.length || E.doc !== doc) return;
  const el = $("#ocr-banner");
  el.className = "banner banner--info";
  el.innerHTML = icon("scan-text") + `<span class="banner__text"><strong>Bu belge taranmış görünüyor.</strong> Metni seçilebilir ve aranabilir yapmak için OCR uygula.</span>`;
  el.append(
    h("button.btn.btn--sm.btn--primary", { type: "button", html: icon("scan-text") + "OCR uygula", onclick: () => openOcrDialog("auto") }),
    h("button.ibtn.ibtn--sm", { type: "button", "aria-label": "Kapat", title: "Bu belge için gösterme", html: icon("x"), onclick: async () => {
      hideBanner();
      doc.ocrHintOff = true;
      await store.putDoc(doc).catch(() => null);
    } }));
  el.hidden = false;
}

