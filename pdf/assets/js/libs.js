/* ==========================================================================
   Mühür — libs.js
   Third-party code is vendored under assets/vendor and loaded on first
   use, so the sign-in screen does not wait for 2 MB of PDF machinery.

   globalThis.__MUHUR_NODE__, when present, is the Node test harness: it
   supplies the libraries and file access a browser would fetch, so the
   converters can be exercised outside the page.
   ========================================================================== */

const vendor = (path) => new URL("../vendor/" + path, import.meta.url).href;
const NODE = () => globalThis.__MUHUR_NODE__ || null;

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
  if (NODE() && NODE().pdfjs) return Promise.resolve(NODE().pdfjs);
  if (!pdfjsPromise) {
    pdfjsPromise = import(vendor("pdfjs/pdf.min.js")).then((m) => {
      m.GlobalWorkerOptions.workerSrc = vendor("pdfjs/pdf.worker.min.js");
      return m;
    });
  }
  return pdfjsPromise;
}

export async function pdflib() {
  if (!(globalThis.PDFLib && globalThis.fontkit)) {
    await Promise.all([script(vendor("pdf-lib.min.js")), script(vendor("fontkit.umd.min.js"))]);
  }
  return globalThis.PDFLib;
}

export async function forge() {
  if (!globalThis.forge) await script(vendor("forge.min.js"));
  return globalThis.forge;
}

// fflate: zip / unzip for the Office formats (OOXML is a zip of XML parts).
export async function fflate() {
  if (!globalThis.fflate) await script(vendor("fflate.min.js"));
  return globalThis.fflate;
}

// tesseract.js: OCR. The core is picked once — the SIMD build where the
// browser validates a SIMD module, the plain one otherwise.
export async function tesseract() {
  if (!globalThis.Tesseract) await script(vendor("tesseract/tesseract.min.js"));
  return globalThis.Tesseract;
}

function simdSupported() {
  try {
    // (module (func (result v128) i32.const 0 i8x16.splat))
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch (e) {
    return false;
  }
}

export function tesseractPaths() {
  if (NODE() && NODE().tesseractPaths) return NODE().tesseractPaths;
  return {
    workerPath: vendor("tesseract/worker.min.js"),
    corePath: vendor("tesseract/core/" + (simdSupported() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js")),
    langPath: vendor("tesseract/lang"),
    gzip: true,
  };
}

// Open bytes with pdf.js. The bytes are copied: pdf.js hands its buffer
// to the worker and the caller keeps using theirs.
export async function openPdf(bytes, password) {
  const lib = await pdfjs();
  const node = NODE();
  const task = lib.getDocument({
    data: bytes.slice(),
    password,
    cMapUrl: node ? node.cMapUrl : vendor("pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: node ? node.standardFontDataUrl : vendor("pdfjs/standard_fonts/"),
    wasmUrl: node ? node.wasmUrl : vendor("pdfjs/wasm/"),
    iccUrl: node ? node.iccUrl : vendor("pdfjs/iccs/"),
    enableXfa: false,
    isEvalSupported: false,
    fontExtraProperties: true,
  });
  return task.promise;
}

const fontBytesCache = new Map();
export function fontBytes(file) {
  if (!fontBytesCache.has(file)) {
    const load = NODE() && NODE().readFont
      ? Promise.resolve(NODE().readFont(file))
      : fetch(new URL("../fonts/" + file, import.meta.url)).then((r) => {
        if (!r.ok) throw new Error("Font yüklenemedi: " + file);
        return r.arrayBuffer();
      });
    fontBytesCache.set(file, load.then((b) => new Uint8Array(b)));
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
