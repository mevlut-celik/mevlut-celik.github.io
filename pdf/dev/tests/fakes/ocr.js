// Stand-in for assets/js/ocr.js. ocrPdf checks the signal between pages
// and before saving, then "saves" without looking at it (as the real one).
export const LANGS = { "tur+eng": "Türkçe + İngilizce", tur: "Türkçe", eng: "İngilizce" };
export const ctl = { pageMs: 300, saveMs: 1500, runs: 0 };
export async function scannedPages() { return []; }
export async function pageNeedsOcr() { return true; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(signal) {
  if (signal && signal.aborted) { const e = new Error("OCR iptal edildi."); e.name = "AbortError"; throw e; }
}
export async function ocrPdf(bytes, { signal, onProgress } = {}) {
  ctl.runs++;
  for (let i = 0; i < 2; i++) {
    check(signal);
    onProgress(i, 2, `Metin tanınıyor · sayfa ${i + 1}`);
    await wait(ctl.pageMs);
  }
  check(signal);
  onProgress(2, 2, "PDF kaydediliyor");
  await wait(ctl.saveMs);
  return { pages: [0, 1], words: 42, bytes: new Uint8Array([37, 80, 68, 70]) };
}
