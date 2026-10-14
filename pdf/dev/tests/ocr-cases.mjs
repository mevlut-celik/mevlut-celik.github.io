// OCR on synthetic scans (text drawn with the Liberation fonts at 300 dpi,
// embedded as full-page images) and on the scanned fixture:
//   node tests/ocr-cases.mjs
//  1. large bold headings and white-on-dark header bars are read
//  2. the invisible font size matches the printed size (with and without
//     descenders, digits only, a skewed line)
//  3. a vertical margin note becomes one rotated, spaced run on the note
//  4. CropBox larger / reversed / bleed, UserUnit 2 and /Rotate 90 pages get
//     their layer on the words (same display boxes as the plain page);
//     out/overlay-rotate.png shows the boxes on the rotated page
//  5. running OCR again replaces Mühür's layer; words that are already real
//     text are not written twice; words under a watermark still are
//  6. the scanned fixture still gives the ruled table rows, >= 90 words on
//     page 1, and the sizes its source (fixtures/report.pdf) was set in
import assert from "node:assert/strict";
import { createRequire } from "module";
import path from "path";
import { setup, app, fixture, out, REPO } from "../harness.mjs";

await setup();
const require = createRequire(path.resolve(REPO, "../dev/harness.mjs"));
const napi = require("@napi-rs/canvas");
napi.GlobalFonts.registerFromPath(path.join(REPO, "fonts/LiberationSans-Regular.ttf"), "LibSans");
napi.GlobalFonts.registerFromPath(path.join(REPO, "fonts/LiberationSans-Bold.ttf"), "LibSansBold");
const { ocrPdf } = await app("js/ocr.js");
const { openPdf, closePdf, fontBytes } = await app("js/libs.js");
const { renderPage, canvasToBytes } = await app("js/convert/canvas.js");
const { PDFDocument, PDFName, PDFNumber, degrees, rgb } = PDFLib;

/* ------------------------------ Drawing ---------------------------------- */
const PX = 300 / 72;
const A4 = [595.28, 841.89];
function page() {
  const c = napi.createCanvas(Math.round(A4[0] * PX), Math.round(A4[1] * PX));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx };
}
// baseline starts at (x, y) points from the top left; angle clockwise
function text(ctx, s, x, y, size, { bold = false, color = "#000", angle = 0 } = {}) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${size * PX}px ${bold ? "LibSansBold" : "LibSans"}`;
  ctx.translate(x * PX, y * PX);
  if (angle) ctx.rotate((angle * Math.PI) / 180);
  ctx.fillText(s, 0, 0);
  ctx.restore();
}
function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x * PX, y * PX, w * PX, h * PX);
}
async function scanPage(doc, canvas, size = A4) {
  const img = await doc.embedPng(await canvas.encode("png"));
  const p = doc.addPage(size);
  return { p, img };
}

const LINES = [
  ["Fatura numarası 12345 tarih 2026", 340],
  ["Ödeme yapılacak hesap: Ağustos ayı gelir", 380],
  ["Bu satır sayfanın neredeyse tamamını kaplayan uzun bir satırdır", 420],
];
function headingsPage() {
  const { c, ctx } = page();
  text(ctx, "SERTİFİKA", 60, 120, 77, { bold: true });
  text(ctx, "TEKLİF", 60, 210, 60, { bold: true });
  rect(ctx, 60, 240, 475, 28, "#1f2a5a");
  text(ctx, "MÜŞTERİ BİLGİLERİ", 70, 260, 16, { bold: true, color: "#fff" });
  rect(ctx, 60, 280, 475, 13, "#1f2a5a");
  text(ctx, "FATURA ADRESİ VE VERGİ NO", 70, 290.5, 9, { bold: true, color: "#fff" });
  for (const [s, y] of LINES) text(ctx, s, 60, y, 14.4);
  text(ctx, "Eğik satır kayıtları bir buçuk derece döndürülmüş metin", 60, 470, 14.4, { angle: -1.5 });
  text(ctx, "1.250.000   640.200   512.000", 60, 520, 14.4);
  return c;
}
const NOTE = "Bu belge elektronik imza ile imzalanmıştır doğrulama kodu ABCDEF";
function letterPage({ note = false } = {}) {
  const { c, ctx } = page();
  for (let i = 0; i < 8; i++) text(ctx, "Sayın ilgili, başvurunuz incelenmiş ve uygun bulunmuştur.", 60, 120 + i * 20, 11);
  for (const [s, y] of LINES) text(ctx, s, 60, y, 14.4);
  if (note) text(ctx, NOTE, 565, 800, 6.5, { angle: -90 });
  return c;
}

/* ------------------------------ Reading ---------------------------------- */
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
// text items of every page in display points (y down, view box origin)
async function items(bytes) {
  const pdf = await openPdf(bytes);
  const pages = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const pg = await pdf.getPage(i + 1);
    const vp = pg.getViewport({ scale: 1 / (pg.userUnit || 1) });
    const tc = await pg.getTextContent();
    pages.push(tc.items.filter((it) => it.str.trim()).map((it) => {
      const m = mul(vp.transform, it.transform);
      return { str: it.str, x: m[4], y: m[5], size: Math.hypot(m[2], m[3]), dir: (Math.atan2(m[1], m[0]) * 180) / Math.PI };
    }));
  }
  closePdf(pdf);
  return pages;
}
const joined = (list) => list.map((it) => it.str).join(" ").replace(/\s+/g, " ");
const count = (s, word) => s.split(word).length - 1;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

let failures = 0;
function check(name, fn) {
  try { fn(); console.log("ok  ", name); } catch (e) { failures++; console.log("FAIL", name, "\n     ", e.message.split("\n")[0]); }
}

/* -------------------- 1-3: headings, sizes, margin note ------------------- */
{
  const doc = await PDFDocument.create();
  for (const c of [headingsPage(), letterPage({ note: true })]) {
    const { p, img } = await scanPage(doc, c);
    p.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  const res = await ocrPdf(await doc.save(), { pages: "all" });
  out("cases-ocr.pdf", res.bytes);
  const [p1, p2] = await items(res.bytes);
  const t1 = joined(p1);
  check("bold headings are read", () => { assert.match(t1, /SERTİFİKA/); assert.match(t1, /TEKLİF/); });
  check("white-on-dark bars are read", () => { assert.match(t1, /MÜŞTERİ BİLGİLERİ/); assert.match(t1, /FATURA ADRESİ VE VERGİ NO/); });
  check("heading size", () => {
    const it = p1.find((i) => i.str.includes("SERTİFİKA"));
    assert.ok(it && near(it.size, 77, 77 * 0.1), `SERTİFİKA at ${it && it.size.toFixed(1)} pt`);
  });
  for (const [label, y] of [["no descenders", 340], ["descenders", 380], ["full width", 420], ["skewed 1.5°", 470], ["digits only", 520]]) {
    check(`14.4 pt line size (${label})`, () => {
      const line = p1.filter((i) => near(i.y, y, 8) && i.x < 120);
      assert.ok(line.length, "line not found");
      for (const it of line) assert.ok(near(it.size, 14.4, 14.4 * 0.12), `${it.str}: ${it.size.toFixed(2)} pt`);
    });
  }
  check("vertical note is one rotated, spaced run on the note", () => {
    const up = p2.filter((i) => near(i.dir, -90, 3));
    const s = joined(up);
    assert.match(s, /elektronik imza ile/);
    assert.match(s, /ABCDEF/);
    for (const it of up) {
      assert.ok(near(it.x, 565, 4), `x ${it.x.toFixed(1)}`);
      assert.ok(near(it.size, 6.5, 1.5), `size ${it.size.toFixed(2)}`);
      assert.ok(it.y > 500 && it.y <= 802, `y ${it.y.toFixed(1)}`);
    }
    assert.ok(!p2.some((i) => i.size > 40), "no oversized run");
  });
}

/* ----------------------- 4: page geometry variants ----------------------- */
{
  const letter = letterPage();
  const doc = await PDFDocument.create();
  const variants = ["plain", "CropBox larger", "CropBox reversed", "CropBox bleed", "UserUnit 2", "Rotate 90"];
  for (const v of variants) {
    if (v === "Rotate 90") {
      // stored sideways (landscape user space), shown upright by /Rotate 90
      const { p, img } = await scanPage(doc, letter, [A4[1], A4[0]]);
      p.drawImage(img, { x: A4[1], y: 0, width: A4[0], height: A4[1], rotate: degrees(90) });
      p.setRotation(degrees(90));
      continue;
    }
    const { p, img } = await scanPage(doc, letter);
    p.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
    if (v === "CropBox larger") p.node.set(PDFName.of("CropBox"), doc.context.obj([0, 0, 612, 1008]));
    if (v === "CropBox reversed") p.node.set(PDFName.of("CropBox"), doc.context.obj([A4[0], A4[1], 0, 0]));
    if (v === "CropBox bleed") p.node.set(PDFName.of("CropBox"), doc.context.obj([-20, -30, A4[0], A4[1]]));
    if (v === "UserUnit 2") p.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
  }
  const res = await ocrPdf(await doc.save(), { pages: "all", dpi: 200 });
  out("cases-geometry.pdf", res.bytes);
  const all = await items(res.bytes);
  const words = ["Fatura", "Ödeme", "Ağustos", "neredeyse", "başvurunuz"];
  const at = (list, w) => list.find((i) => i.str.includes(w));
  for (const w of words) assert.ok(at(all[0], w), `plain page lacks ${w}`);
  variants.forEach((v, k) => {
    if (!k) return;
    check(`layer on the words: ${v}`, () => {
      for (const w of words) {
        const a = at(all[0], w), b = at(all[k], w);
        assert.ok(b, `${w} missing`);
        assert.ok(near(a.x, b.x, 2) && near(a.y, b.y, 2) && near(a.size, b.size, 1), `${w} at ${b.x.toFixed(1)},${b.y.toFixed(1)} (plain ${a.x.toFixed(1)},${a.y.toFixed(1)})`);
      }
    });
  });
  // the boxes over the rotated page, as tests/ocr-overlay.mjs draws them
  const pdf = await openPdf(res.bytes);
  const k = variants.indexOf("Rotate 90");
  const canvas = await renderPage(pdf, k, 1.4);
  const ctx = canvas.getContext("2d");
  const pp = await pdf.getPage(k + 1);
  const vp = pp.getViewport({ scale: 1.4 });
  ctx.strokeStyle = "rgba(255,0,0,0.8)";
  for (const it of (await pp.getTextContent()).items) {
    if (!it.str.trim()) continue;
    const m = mul(vp.transform, it.transform);
    const h = Math.hypot(m[2], m[3]);
    ctx.save(); ctx.translate(m[4], m[5]); ctx.rotate(Math.atan2(m[1], m[0])); ctx.strokeRect(0, -h * 0.8, it.width * 1.4, h); ctx.restore();
  }
  out("overlay-rotate.png", await canvasToBytes(canvas));
  closePdf(pdf);
}

/* ------------------- 5: re-run, existing text, watermark ----------------- */
{
  const first = await ocrPdf((await PDFDocument.create().then(async (doc) => {
    const { p, img } = await scanPage(doc, letterPage());
    p.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
    return doc.save();
  })), { pages: "all", langs: "eng" });
  const again = await ocrPdf(first.bytes, { pages: "all", langs: "tur+eng" });
  const [p] = await items(again.bytes);
  check("second OCR run replaces the first layer", () => {
    assert.equal(again.replaced, 1);
    assert.equal(count(joined(p), "Fatura numarası"), 1, joined(p).slice(0, 200));
  });

  // born-digital lines on top, a picture of text below
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(await fontBytes("LiberationSans-Regular.ttf"), { subset: true });
  const { c, ctx } = page();
  text(ctx, "Görsel içindeki yazı da aranabilir olmalı", 60, 600, 14.4);
  const { p: born, img } = await scanPage(doc, c);
  born.drawImage(img, { x: 0, y: 0, width: A4[0], height: A4[1] });
  for (const [s, y] of LINES) born.drawText(s, { x: 60, y: A4[1] - y, size: 14.4, font });
  // a scan with a diagonal watermark and a page number drawn as real text
  const { p: marked, img: img2 } = await scanPage(doc, letterPage());
  marked.drawImage(img2, { x: 0, y: 0, width: A4[0], height: A4[1] });
  marked.drawText("KİŞİSEL VERİ GİZLİDİR", { x: 120, y: 200, size: 54, font, rotate: degrees(45), color: rgb(0.6, 0.6, 0.6), opacity: 0.35 });
  marked.drawText("Sayfa 2", { x: 280, y: 30, size: 10, font });
  const res = await ocrPdf(await doc.save(), { pages: "all" });
  out("cases-existing.pdf", res.bytes);
  const [b, m] = (await items(res.bytes)).map(joined);
  check("real text is not written twice", () => {
    for (const [s] of LINES) assert.equal(count(b, s.split(" ")[0]), 1, `${s.split(" ")[0]} in: ${b}`);
    assert.ok(res.covered >= 12, `covered ${res.covered}`);
  });
  check("text inside a picture on a born-digital page is added", () => assert.match(b, /Görsel içindeki yazı/));
  check("words under a watermark are still written", () => {
    for (const [s] of LINES) assert.ok(m.includes(s), `missing "${s}"`);
    assert.ok(count(m, "başvurunuz") >= 7, `başvurunuz x${count(m, "başvurunuz")}`);
    assert.equal(count(m, "Sayfa 2"), 1);
  });
}

/* --------------------------- 6: scanned fixture -------------------------- */
{
  const res = await ocrPdf(fixture("scanned.pdf"), { pages: "auto" });
  const t = res.text[0];
  check("fixture: ruled table rows", () => {
    for (const row of [/stanbul\s+1\.250\.000/, /Ankara\s+640\.200/, /zmir\s+512\.000/, /Toplam\s+2\.402\.200/]) assert.match(t, row);
  });
  check("fixture: >= 90 words on page 1", () => {
    const n = t.split(/\s+/).filter(Boolean).length;
    assert.ok(n >= 90, `${n} words`);
  });
  // the scan is a render of fixtures/report.pdf: sizes as set there
  const [p1] = await items(res.bytes);
  check("fixture: sizes match the source document", () => {
    for (const [re, size] of [[/Raporu/, 22], [/^Bu rapor/, 11], [/Bölgeler/, 15], [/^1\.250\.000/, 10.5], [/^Ankara/, 10.5], [/^Toplam/, 10.5], [/^Şekil/, 9]]) {
      const it = p1.find((i) => re.test(i.str.trim()));
      assert.ok(it, `${re} missing`);
      assert.ok(near(it.size, size, size * 0.1), `${it.str.trim()}: ${it.size.toFixed(2)} pt, source ${size} pt`);
    }
  });
}

console.log(failures ? `\n${failures} failed` : "\nall ok");
process.exit(failures ? 1 : 0);
