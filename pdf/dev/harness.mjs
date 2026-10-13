// Node harness for Mühür converters (run "npm install" in pdf/dev first).
//   import { setup, app, fixture, out } from "<scratch>/conv/harness.mjs";
//   await setup();
//   const { flowToPdf } = await app("js/convert/layout.js");
// Provides the globals the browser build reads: PDFLib, fontkit, forge,
// fflate, Tesseract, DOMParser/XMLSerializer, and __MUHUR_NODE__ hooks
// (pdf.js legacy build, file-system fonts, @napi-rs/canvas).
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export const REPO = path.resolve(here, "../assets");
export const FIXTURES = path.join(here, "fixtures");
export const OUT = path.join(here, "out");
fs.mkdirSync(OUT, { recursive: true });

let ready = false;
export async function setup() {
  if (ready) return;
  ready = true;
  globalThis.PDFLib = require("pdf-lib");
  globalThis.fontkit = require("@pdf-lib/fontkit");
  globalThis.forge = require("node-forge");
  globalThis.fflate = require("fflate");
  const xmldom = require("@xmldom/xmldom");
  globalThis.DOMParser = xmldom.DOMParser;
  globalThis.XMLSerializer = xmldom.XMLSerializer;
  const napi = require("@napi-rs/canvas");
  const pdfjs = await import(pathToFileURL(path.join(here, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
  const nm = path.join(here, "node_modules");
  globalThis.__MUHUR_NODE__ = {
    pdfjs,
    cMapUrl: path.join(nm, "pdfjs-dist/cmaps/") ,
    standardFontDataUrl: path.join(nm, "pdfjs-dist/standard_fonts/"),
    wasmUrl: path.join(nm, "pdfjs-dist/wasm/"),
    iccUrl: path.join(nm, "pdfjs-dist/iccs/"),
    readFont: (file) => fs.readFileSync(path.join(REPO, "fonts", file)),
    createCanvas: (w, h) => napi.createCanvas(w, h),
    tesseractPaths: { langPath: path.join(REPO, "vendor/tesseract/lang"), gzip: true, cachePath: path.join(here, ".tesscache") },
  };
  globalThis.Tesseract = require("tesseract.js");
  globalThis.Image = napi.Image;
}

// Import a module from pdf/assets (e.g. "js/convert/layout.js").
export function app(rel) {
  return import(pathToFileURL(path.join(REPO, rel)).href);
}

export const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
export const out = (name, bytes) => { const p = path.join(OUT, name); fs.writeFileSync(p, bytes); return p; };
