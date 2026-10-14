// Stand-in for assets/js/ocr.js for ocr-triage.html: pageNeedsOcr takes
// ctl.triageMs per page and fails like pdf.js does once its document has
// been destroyed (the editor closed meanwhile), or with ctl.fail.
export const LANGS = { "tur+eng": "Türkçe + İngilizce", tur: "Türkçe", eng: "İngilizce" };
export const ctl = { triageMs: 200, needs: () => true, fail: null, runs: 0, triaged: [] };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function scannedPages() { return []; }
export async function pageNeedsOcr(pdf, index) {
  ctl.triaged.push(index);
  await wait(ctl.triageMs);
  if (pdf.destroyed) throw new Error("Transport destroyed");
  if (ctl.fail) throw new Error(ctl.fail);
  return ctl.needs(index);
}
export async function ocrPdf(bytes, { pages, signal } = {}) {
  ctl.runs++;
  if (signal && signal.aborted) { const e = new Error("OCR iptal edildi."); e.name = "AbortError"; throw e; }
  return { pages: Array.isArray(pages) ? pages : [], words: 1, bytes: new Uint8Array([37, 80, 68, 70]) };
}
