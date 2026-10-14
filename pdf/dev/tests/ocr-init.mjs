// OCR engine start-up must always settle (node tests/ocr-init.mjs):
//  - missing language data rejects createOcr / ocrPdf instead of hanging
//  - aborting while the engine starts or while a page is read rejects
//    with AbortError at once
// tesseract.js 7 leaves createWorker pending forever when the language
// files cannot be loaded. In the browser ocr.js terminates that worker
// (tests/ocr-init.html checks it); Node's worker_threads cannot be
// reached the same way, hence the process.exit at the end.
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { setup, app, fixture } from "../harness.mjs";

await setup();
const { createOcr, ocrPdf } = await app("js/ocr.js");
const paths = globalThis.__MUHUR_NODE__.tesseractPaths;

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failures++; console.log("FAIL", name, "\n     ", String(e.message).split("\n")[0]); }
}
// rejects within `ms`, or fails the check
async function settles(promise, ms) {
  let timer;
  const t0 = Date.now();
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`still pending after ${ms} ms`)), ms); });
  try {
    await Promise.race([promise, timeout]);
  } catch (e) {
    if (/still pending/.test(e.message)) throw e;
    return { error: e, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
  throw new Error("resolved, expected a rejection");
}

const empty = fs.mkdtempSync(path.join(os.tmpdir(), "muhur-ocr-"));
const badPaths = { ...paths, langPath: path.join(empty, "missing"), cachePath: empty, cacheMethod: "none" };

await check("createOcr rejects when the language data is missing", async () => {
  globalThis.__MUHUR_NODE__.tesseractPaths = badPaths;
  const { error } = await settles(createOcr({ langs: "tur+eng" }), 20000);
  assert.ok(error instanceof Error);
  assert.match(error.message, /OCR motoru başlatılamadı/);
});

await check("ocrPdf rejects (not hangs) when the language data is missing", async () => {
  globalThis.__MUHUR_NODE__.tesseractPaths = badPaths;
  const { error } = await settles(ocrPdf(fixture("scanned.pdf"), { pages: [0] }), 20000);
  assert.match(error.message, /OCR motoru başlatılamadı/);
});

await check("abort while the engine starts", async () => {
  globalThis.__MUHUR_NODE__.tesseractPaths = { ...paths, cacheMethod: "none" };
  const ac = new AbortController();
  // cancel on the first start-up progress message: the engine is loading
  const p = createOcr({ signal: ac.signal, onProgress: () => ac.abort() });
  const { error, ms } = await settles(p, 5000);
  assert.equal(error.name, "AbortError");
  assert.ok(ms < 2000, `${ms} ms`);
});

await check("abort before start", async () => {
  globalThis.__MUHUR_NODE__.tesseractPaths = paths;
  const ac = new AbortController();
  ac.abort();
  const { error } = await settles(createOcr({ signal: ac.signal }), 2000);
  assert.equal(error.name, "AbortError");
});

await check("abort while a page is read", async () => {
  globalThis.__MUHUR_NODE__.tesseractPaths = paths;
  const ac = new AbortController();
  const p = ocrPdf(fixture("scanned.pdf"), {
    pages: [0], signal: ac.signal,
    onProgress: (d, t, label) => { if (/Metin tanınıyor/.test(label)) ac.abort(); },
  });
  const { error, ms } = await settles(p, 20000);
  assert.equal(error.name, "AbortError");
  console.log("      (stopped after", ms, "ms)");
});

fs.rmSync(empty, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nall ok");
process.exit(failures ? 1 : 0);
