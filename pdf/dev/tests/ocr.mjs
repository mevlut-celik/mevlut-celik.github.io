// OCR the scanned fixture and check the text layer comes back out of pdf.js.
import { setup, app, fixture, out } from "../harness.mjs";
await setup();
const { ocrPdf, scannedPages } = await app("js/ocr.js");
const { openPdf, closePdf } = await app("js/libs.js");
const src = fixture(process.argv[2] || "scanned.pdf");
const pdf0 = await openPdf(src);
console.log("pages", pdf0.numPages, "scanned:", await scannedPages(pdf0));
closePdf(pdf0);
const t0 = Date.now();
const res = await ocrPdf(src, { pages: "auto", dpi: Number(process.argv[3] || 300), onProgress: (d, t, l) => { if (Math.round(d * 10) % 3 === 0) process.stdout.write(`\r${d.toFixed(2)}/${t} ${l}                    `); } });
console.log("\nocr", Date.now() - t0, "ms; pages", res.pages, "words", res.words);
out("ocr-out.pdf", res.bytes);
const pdf = await openPdf(res.bytes);
for (let i = 0; i < pdf.numPages; i++) {
  const page = await pdf.getPage(i + 1);
  const tc = await page.getTextContent();
  const text = tc.items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join("");
  console.log(`--- page ${i + 1} (${tc.items.length} items)\n` + text.slice(0, 400));
}
closePdf(pdf);
