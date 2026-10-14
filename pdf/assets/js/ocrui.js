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
import { $, h, icon, toast, dialog, confirmDialog, busy } from "./ui.js";
import { pdflib } from "./libs.js";
import { isPristine } from "./pdfwork.js";
import { addVersion } from "./docs.js";
import { ocrPdf, scannedPages, pageNeedsOcr, LANGS } from "./ocr.js";

const PREF = "muhur.ocr";

function prefs() {
  try { return { langs: "tur+eng", dpi: 300, ...JSON.parse(localStorage.getItem(PREF) || "{}") }; } catch (e) { return { langs: "tur+eng", dpi: 300 }; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF, JSON.stringify({ langs: p.langs, dpi: p.dpi })); } catch (e) { /* storage blocked */ }
}

// A row of choices exposed as a radio group: aria-checked must be the
// strings "true"/"false" (h() drops false and writes true as "").
function segment(name, options, value, onPick) {
  const seg = h("div.segment.segment--sm", { role: "radiogroup", "aria-label": name });
  for (const [v, label] of options) {
    const on = String(v) === String(value);
    seg.append(h("button.segment__btn", {
      type: "button", role: "radio", class: "segment__btn" + (on ? " is-active" : ""),
      "aria-checked": String(on), text: label,
      onclick: (e) => {
        for (const b of seg.children) { b.classList.toggle("is-active", b === e.currentTarget); b.setAttribute("aria-checked", String(b === e.currentTarget)); }
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
  const track = h("span.progress__track", { role: "progressbar", "aria-label": "OCR ilerlemesi", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, bar);
  // phase changes ("sayfa 3", "PDF kaydediliyor") are read out; the bar is not
  const label = h("span.progress__label", { role: "status", text: "Hazırlanıyor…" });
  const progress = h("div.progress", { hidden: true }, track, label);
  const setLabel = (text) => { if (label.textContent !== text) label.textContent = text; };
  const form = h("div.form",
    {},
    h("div.field", {}, h("span.field__label", { text: "Belgenin dili" }), segment("Belgenin dili", Object.entries(LANGS), p.langs, (v) => { p.langs = v; })),
    h("div.field", {}, h("span.field__label", { text: "Hangi sayfalar" }), segment("Hangi sayfalar", scopes, scope.mode, (v) => { scope.mode = v; })),
    h("div.field", {}, h("span.field__label", { text: "Kalite" }), segment("Kalite", [[200, "Hızlı · 200 dpi"], [300, "Dengeli · 300 dpi"]], p.dpi, (v) => { p.dpi = Number(v); }),
      h("span.field__hint", { text: "Küçük yazılı ya da soluk taramalarda 300 dpi daha iyi sonuç verir; sayfa başına birkaç saniye sürer." })),
  );
  const notes = h("div", { style: { display: "grid", gap: "8px" } },
    h("div.tip", { html: icon("info") + "<span>OCR sayfanın görünümünü değiştirmez: tanınan metin, sayfanın üstüne görünmez ama seçilebilir bir katman olarak yazılır. Sonuç yeni bir sürüm olarak kaydedilir; tanıma tamamen bu cihazda yapılır.</span>" }));
  if (edited) notes.append(h("div.tip", { html: icon("layers") + "<span>Belgedeki düzenlemeler de bu sürüme işlenir.</span>" }));
  if (signed) notes.append(h("div.tip.tip--danger", { html: icon("shield-x") + `<span>Belgede ${signed} dijital imza var. OCR dosyayı değiştirdiği için bu imzalar geçersiz olur.</span>` }));
  const body = h("div", { style: { display: "grid", gap: "16px" } }, form, notes, progress);

  // Until the result is written, cancel (İptal, Esc, × or a click outside)
  // stops the run and nothing is saved. Writing the new version is the
  // commit point: from there the save is not interrupted, the dialog stays
  // open until it is done, and the editor is held busy if it was closed anyway.
  let controller = null;
  let running = false;
  let committing = false;
  let hold = null;
  const d = dialog({
    title: "Metni tanı (OCR)",
    sub: "Taranmış ya da fotoğrafı çekilmiş sayfaları aranabilir ve seçilebilir metne çevirir.",
    body,
    size: "md",
    dismissable: true,
    actions: [
      { label: "Vazgeç", id: "cancel", onClick: ({ close }) => {
        if (running && controller) {
          if (!committing) { controller.abort(); setLabel("İptal ediliyor…"); }
          return false;
        }
        close(null);
        return false;
      } },
      { label: "Metni tanı", kind: "primary", icon: "scan-text", id: "start", onClick: async ({ close, el }) => {
        if (running) return false;
        if (signed && !(await confirmDialog({ title: "İmzalar geçersiz olacak", message: "OCR uygulanınca belgedeki dijital imzalar geçersiz olur. Devam edilsin mi?", confirm: "Devam et", danger: true }))) return false;
        running = true;
        savePrefs(p);
        controller = new AbortController();
        const { signal } = controller;
        form.style.opacity = "0.5";
        form.style.pointerEvents = "none";
        progress.hidden = false;
        el.querySelector('[data-action="start"]').disabled = true;
        el.querySelector('[data-action="cancel"]').textContent = "İptal";
        const onCommit = () => {
          committing = true;
          el.querySelector('[data-action="cancel"]').disabled = true;
          const x = el.querySelector(".dialog__close");
          if (x) x.disabled = true;
        };
        try {
          const result = await run({ ...p, mode: scope.mode, selected: sel, current: curIndex, signal, onCommit, onProgress: (done, total, text) => {
            // after a cancel, keep "İptal ediliyor…" until the run stops
            if (signal.aborted && !committing) return;
            const pct = total ? Math.min(100, (done / total) * 100) : 0;
            bar.style.width = pct.toFixed(1) + "%";
            track.setAttribute("aria-valuenow", String(Math.round(pct)));
            setLabel(text || "");
          } });
          running = false;
          close(true);
          finish(result);
        } catch (err) {
          running = false;
          form.style.opacity = "";
          form.style.pointerEvents = "";
          progress.hidden = true;
          el.querySelector('[data-action="start"]').disabled = false;
          el.querySelector('[data-action="cancel"]').textContent = "Vazgeç";
          if (err && err.name === "AbortError") { toast("OCR iptal edildi.", "warn"); close(null); return false; }
          console.error(err);
          if (committing) close(null);
          toast("OCR tamamlanamadı: " + (err.message || err), "error");
        } finally {
          committing = false;
          if (hold) { hold.done(); hold = null; }
        }
        return false;
      } },
    ],
  });
  // While the version is written, Esc and a click on the backdrop are held
  // back (capture phase, ahead of the dialog's own handlers). If the browser
  // closes the dialog regardless (Chrome lets a repeated Esc through), the
  // page is covered until the save is done, so no edit is made on a
  // document that is about to be reloaded.
  const guard = (e) => {
    if (!committing || e.target !== d.el) return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("cancel", guard, true);
  window.addEventListener("click", guard, true);
  d.el.addEventListener("close", () => {
    if (committing && running && !hold) hold = busy("Yeni sürüm kaydediliyor…");
  });
  const result = await d.result;
  window.removeEventListener("cancel", guard, true);
  window.removeEventListener("click", guard, true);
  // closed with Esc, the × or a click outside while recognising: stop the run as well
  if (result == null && running && controller && !committing) controller.abort();
}

function abortError() {
  const e = new Error("OCR iptal edildi.");
  e.name = "AbortError";
  return e;
}

async function run({ langs, dpi, mode, selected, current, signal, onProgress, onCommit }) {
  await pdflib();
  // the document this run belongs to; the editor may close or move on
  const doc = E.doc;
  const bytes = isPristine(E.state) ? E.sources.get("main").bytes.slice() : await E.buildBytes({ force: true });
  let pages = mode;
  if (mode === "current") pages = [current];
  if (mode === "selected") pages = selected.map((pg) => E.pageIndex(pg.id)).sort((a, b) => a - b);
  // "Taranmış sayfalar" on an edited document: judge each page by its source
  // (as the banner does), not by the built bytes, where a watermark, page
  // numbers or a text box would count as the page's own text. The built
  // bytes are still what gets recognised, so the edits are kept.
  // A cancel, or the editor closing (Back, lock, sign-out) or opening
  // another document, ends the run as a cancel.
  const gone = () => signal.aborted || !E.open || E.doc !== doc;
  if (mode === "auto" && !isPristine(E.state)) {
    pages = [];
    const list = E.state.pages;
    for (let i = 0; i < list.length; i++) {
      // a closed editor drops its sources and destroys their pdf.js
      // documents: later pages would look blank ("no scanned pages")
      if (gone()) throw abortError();
      onProgress(0, 1, `Sayfalar inceleniyor ${i + 1}/${list.length}`);
      const src = list[i].src && E.sources.get(list[i].src);   // a blank page has no source
      let scanned = false;
      try {
        scanned = !!(src && src.pdf && await pageNeedsOcr(src.pdf, list[i].index));
      } catch (err) {
        // the document was destroyed while this page was read
        if (gone()) throw abortError();
        throw err;
      }
      if (scanned) pages.push(i);
    }
    if (gone()) throw abortError();
    if (!pages.length) return { empty: true };
  }
  const res = await ocrPdf(bytes, { pages, langs, dpi, signal, onProgress });
  // ocrPdf checks the signal only between pages and before saving the PDF:
  // a cancel during the save, or a document that is gone, ends here
  if (gone()) throw abortError();
  if (!res.pages.length) return { empty: true };
  onCommit();
  onProgress(1, 1, "Yeni sürüm kaydediliyor");
  await addVersion(doc, res.bytes, `OCR uygulandı · ${res.pages.length} sayfa`);
  await store.deleteState(doc.id);
  doc.ocr = { at: Date.now(), pages: res.pages.length, words: res.words };
  await store.putDoc(doc);
  if (E.open && E.doc === doc) await E.reloadVersion();
  return res;
}

function finish(res) {
  hideBanner();
  if (res.empty) {
    toast("Taranmış sayfa bulunamadı: sayfalar zaten seçilebilir metin içeriyor. Önceki bir OCR'ı başka bir dille yenilemek için 'Tüm sayfalar'ı seç; Mühür'ün eski OCR katmanı değiştirilir.", "info", { timeout: 8000 });
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

