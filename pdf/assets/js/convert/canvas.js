/* ==========================================================================
   Mühür — convert/canvas.js
   Canvas helpers that work in the page and in the Node test harness
   (where @napi-rs/canvas stands in for <canvas>), plus pdf.js page
   rendering with an option to leave the text out — the background a
   PowerPoint slide gets under its editable text boxes.
   ========================================================================== */

import { pdfjs } from "../libs.js";

const NODE = () => globalThis.__MUHUR_NODE__ || null;

export function createCanvas(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (NODE() && NODE().createCanvas) return NODE().createCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// -> Uint8Array of a PNG or JPEG
export async function canvasToBytes(canvas, type = "image/png", quality = 0.9) {
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise((res) => canvas.toBlob(res, type, quality));
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof canvas.encode === "function") {
    return new Uint8Array(await canvas.encode(type === "image/jpeg" ? "jpeg" : "png", Math.round(quality * 100)));
  }
  return new Uint8Array(canvas.toBuffer(type));
}

export function cropCanvas(src, x, y, w, h) {
  const out = createCanvas(w, h);
  out.getContext("2d").drawImage(src, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, out.width, out.height);
  return out;
}

const TEXT_OPS = ["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText"];

// Render one page of an open pdf.js document. `scale` is pixels per point.
// textless: skip every text-showing operator, so only graphics remain.
export async function renderPage(pdf, pageIndex, scale, { textless = false, annotations = true } = {}) {
  const lib = await pdfjs();
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const params = {
    canvas: NODE() ? null : canvas,
    canvasContext: NODE() ? canvas.getContext("2d") : undefined,
    viewport,
    intent: "print",
    background: "#ffffff",
    annotationMode: annotations ? lib.AnnotationMode.ENABLE : lib.AnnotationMode.DISABLE,
  };
  if (textless) {
    const skip = new Set(TEXT_OPS.map((k) => lib.OPS[k]).filter((v) => v != null));
    params.operationsFilter = (i, opList) => !skip.has(opList.fnArray[i]);
  }
  await page.render(params).promise;
  page.cleanup();
  return canvas;
}
