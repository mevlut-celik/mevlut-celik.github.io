/* ==========================================================================
   Mühür — libs.js
   Third-party code is vendored under assets/vendor and loaded on first
   use, so the sign-in screen does not wait for 2 MB of PDF machinery.
   ========================================================================== */

const vendor = (path) => new URL("../vendor/" + path, import.meta.url).href;

const scripts = new Map();
function script(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = resolve;
      el.onerror = () => { scripts.delete(src); reject(new Error("Kütüphane yüklenemedi: " + src.split("/").pop())); };
      document.head.append(el);
    }));
  }
  return scripts.get(src);
}

let pdfjsPromise = null;
export function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(vendor("pdfjs/pdf.min.js")).then((m) => {
      m.GlobalWorkerOptions.workerSrc = vendor("pdfjs/pdf.worker.min.js");
      return m;
    });
  }
  return pdfjsPromise;
}

export async function pdflib() {
  await Promise.all([script(vendor("pdf-lib.min.js")), script(vendor("fontkit.umd.min.js"))]);
  return globalThis.PDFLib;
}

export async function forge() {
  await script(vendor("forge.min.js"));
  return globalThis.forge;
}

// Open bytes with pdf.js. The bytes are copied: pdf.js hands its buffer
// to the worker and the caller keeps using theirs.
export async function openPdf(bytes, password) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: vendor("pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: vendor("pdfjs/standard_fonts/"),
    wasmUrl: vendor("pdfjs/wasm/"),
    iccUrl: vendor("pdfjs/iccs/"),
    enableXfa: false,
    isEvalSupported: false,
    fontExtraProperties: true,
  });
  return task.promise;
}

const fontBytesCache = new Map();
export function fontBytes(file) {
  if (!fontBytesCache.has(file)) {
    fontBytesCache.set(file, fetch(new URL("../fonts/" + file, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error("Font yüklenemedi: " + file);
      return r.arrayBuffer();
    }).then((b) => new Uint8Array(b)));
  }
  return fontBytesCache.get(file).then((b) => b.slice());
}

// pdf.js 6 destroys a document through its loading task.
export function closePdf(pdf) {
  try {
    if (pdf && pdf.loadingTask) pdf.loadingTask.destroy();
    else if (pdf && pdf.destroy) pdf.destroy();
  } catch (e) { /* already gone */ }
}
