// OCR forced onto pages that already carry their text (node tests/ocr-present.mjs):
//  - a born-digital page sent through "Bu sayfa": every word read is
//    already there, so nothing is written, the input comes back as is and
//    no page counts as OCRed (the dialog then saves no new version and
//    leaves any signature intact)
//  - the same page next to a scan: the scan gets its layer, the
//    born-digital page keeps a single copy of each line
import assert from "node:assert/strict";
import { createRequire } from "module";
import path from "path";
import { setup, app, REPO } from "../harness.mjs";

await setup();
const require = createRequire(path.resolve(REPO, "../dev/harness.mjs"));
const napi = require("@napi-rs/canvas");
napi.GlobalFonts.registerFromPath(path.join(REPO, "fonts/LiberationSans-Regular.ttf"), "LibSans");
const { ocrPdf } = await app("js/ocr.js");
const { openPdf, closePdf, fontBytes } = await app("js/libs.js");
const { PDFDocument } = PDFLib;

const A4 = [595.28, 841.89];
const PX = 300 / 72;
const LINES = [
  ["Fatura numarası 12345 tarih 2026", 340],
  ["Ödeme yapılacak hesap: Ağustos ayı gelir", 380],
  ["Sayın ilgili, başvurunuz incelenmiş ve uygun bulunmuştur.", 420],
];

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failures++; console.log("FAIL", name, "\n     ", String(e.message).split("\n")[0]); }
}
async function pageTexts(bytes) {
  const pdf = await openPdf(bytes);
  const out = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const tc = await (await pdf.getPage(i + 1)).getTextContent();
    out.push(tc.items.map((it) => it.str).join(" ").replace(/\s+/g, " "));
  }
  closePdf(pdf);
  return out;
}
const count = (s, word) => s.split(word).length - 1;

async function bornDigital(doc) {
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await fontBytes("LiberationSans-Regular.ttf"), { subset: true });
  const p = doc.addPage(A4);
  for (const [s, y] of LINES) p.drawText(s, { x: 60, y: A4[1] - y, size: 14.4, font });
}
async function scan(doc) {
  const c = napi.createCanvas(Math.round(A4[0] * PX), Math.round(A4[1] * PX));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#000";
  ctx.font = `${14.4 * PX}px LibSans`;
  ctx.fillText("Taranmış sayfadaki satır da aranabilir olmalı", 60 * PX, 300 * PX);
  const img = await doc.embedPng(await c.encode("png"));
  doc.addPage(A4).drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
}

await check("born-digital page alone: unchanged, no page OCRed", async () => {
  const doc = await PDFDocument.create();
  await bornDigital(doc);
  const input = await doc.save();
  const res = await ocrPdf(input, { pages: [0] });
  assert.deepEqual(res.pages, []);
  assert.equal(res.words, 0);
  assert.ok(res.covered >= 15, `covered ${res.covered}`);
  assert.equal(res.bytes, input);
});

await check("born-digital page next to a scan: one copy of each line, scan searchable", async () => {
  const doc = await PDFDocument.create();
  await bornDigital(doc);
  await scan(doc);
  const res = await ocrPdf(await doc.save(), { pages: "all" });
  assert.deepEqual(res.pages, [0, 1]);
  const [born, scanned] = await pageTexts(res.bytes);
  for (const [s] of LINES) assert.equal(count(born, s), 1, `"${s}" x${count(born, s)}`);
  assert.match(scanned, /Taranmış sayfadaki satır/);
});

console.log(failures ? `\n${failures} failed` : "\nall ok");
process.exit(failures ? 1 : 0);
