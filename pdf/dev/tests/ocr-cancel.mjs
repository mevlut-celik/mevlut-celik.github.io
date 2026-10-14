// Cancelling a page the moment it is handed to the engine (node tests/ocr-cancel.mjs):
//  - recognize rejects with AbortError at once
//  - nothing is left behind as an unhandled rejection. tesseract.js posts
//    the page to its worker only after loading the image; if the worker
//    was dropped through tesseract's own terminate() in between, that post
//    hits null inside tesseract.js — an uncaught rejection, which ends a
//    Node process and is logged as an error in the browser.
//  - terminate() can be called again afterwards, and a new engine still
//    reads the page; recognize on a terminated engine rejects at once
import assert from "node:assert/strict";
import { setup, app, fixture } from "../harness.mjs";

await setup();
const { createOcr } = await app("js/ocr.js");
const { openPdf, closePdf } = await app("js/libs.js");
const { renderPage, canvasToBytes } = await app("js/convert/canvas.js");

const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(String((e && e.message) || e)));

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failures++; console.log("FAIL", name, "\n     ", String(e.message).split("\n")[0]); }
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const pdf = await openPdf(fixture("scanned.pdf"));
const canvas = await renderPage(pdf, 0, 150 / 72);
const png = await canvasToBytes(canvas, "image/png");
const w = canvas.width, h = canvas.height;
closePdf(pdf);

for (const when of ["synchronously", "after a microtask"]) {
  await check(`cancel ${when} after recognize starts`, async () => {
    const ac = new AbortController();
    const ocr = await createOcr({ signal: ac.signal });
    const before = unhandled.length;
    const t0 = Date.now();
    const p = ocr.recognize(png, w, h);
    if (when !== "synchronously") await Promise.resolve();
    ac.abort();
    await assert.rejects(p, (e) => e.name === "AbortError");
    assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
    await ocr.terminate();
    await ocr.terminate();
    await settle(300); // let tesseract's own image load finish and post
    assert.deepEqual(unhandled.slice(before), []);
  });
}

await check("recognize after terminate rejects instead of waiting forever", async () => {
  const ocr = await createOcr({});
  await ocr.terminate();
  let timer;
  const pendingTooLong = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("still pending after 3 s")), 3000); });
  try {
    await assert.rejects(Promise.race([ocr.recognize(png, w, h), pendingTooLong]), /OCR motoru kapatıldı/);
  } finally {
    clearTimeout(timer);
  }
});

await check("a new engine still reads the page", async () => {
  const before = unhandled.length;
  const ocr = await createOcr({});
  try {
    const page = await ocr.recognize(png, w, h);
    assert.match(page.text, /Satış Raporu/);
  } finally {
    await ocr.terminate();
  }
  await settle(100);
  assert.deepEqual(unhandled.slice(before), []);
});

console.log(failures ? `\n${failures} failed` : "\nall ok");
process.exit(failures ? 1 : 0);
