/* ==========================================================================
   Mühür — docs.js
   Documents as the library sees them: a card (name, thumbnail, counts),
   a list of versions (each an encrypted blob) and an edit state for the
   current version. Import, versions, thumbnails and duplicates live here.
   ========================================================================== */

import * as store from "./store.js";
import { openPdf, pdflib } from "./libs.js";
import { uid, baseName } from "./util.js";
import { hasSignatures } from "./sign.js";

export async function renderThumb(pdf, pageNumber, width, rotate) {
  const page = await pdf.getPage(pageNumber || 1);
  const vp1 = page.getViewport({ scale: 1, rotation: ((page.rotate + (rotate || 0)) % 360 + 360) % 360 });
  const scale = (width || 240) / vp1.width;
  const vp = page.getViewport({ scale, rotation: vp1.rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvas, viewport: vp, background: "#ffffff" }).promise;
  return canvas;
}

export async function thumbFromBytes(bytes) {
  const pdf = await openPdf(bytes);
  try {
    const canvas = await renderThumb(pdf, 1, 260);
    return { thumb: canvas.toDataURL("image/jpeg", 0.78), pages: pdf.numPages };
  } finally {
    pdf.destroy();
  }
}

export async function createDoc(name, bytes, extra) {
  const { thumb, pages } = await thumbFromBytes(bytes);
  const blob = await store.putBlob(bytes);
  const now = Date.now();
  const doc = {
    id: uid("d"),
    name: baseName(name),
    created: now,
    modified: now,
    size: bytes.length,
    pages,
    thumb,
    signed: hasSignatures(bytes),
    versions: [{ id: uid("v"), blob, label: (extra && extra.label) || "Orijinal", created: now, size: bytes.length, signed: hasSignatures(bytes) }],
    ...(extra && extra.meta),
  };
  await store.putDoc(doc);
  return doc;
}

export function currentVersion(doc) {
  return doc.versions[doc.versions.length - 1];
}

export async function currentBytes(doc) {
  return store.getBlob(currentVersion(doc).blob);
}

export async function addVersion(doc, bytes, label, { signed } = {}) {
  const blob = await store.putBlob(bytes);
  const now = Date.now();
  doc.versions.push({ id: uid("v"), blob, label, created: now, size: bytes.length, signed: !!signed });
  doc.size = bytes.length;
  doc.modified = now;
  doc.signed = !!signed || hasSignatures(bytes);
  try {
    const t = await thumbFromBytes(bytes);
    doc.thumb = t.thumb;
    doc.pages = t.pages;
  } catch (e) { /* keep the old thumbnail */ }
  await store.putDoc(doc);
  return doc;
}

export async function duplicateDoc(doc) {
  const bytes = await currentBytes(doc);
  const copy = await createDoc(doc.name + " (kopya)", bytes);
  const state = await store.getState(doc.id);
  if (state) {
    // sources other than the main file are re-stored for the copy
    const sources = { main: copy.versions[0].blob };
    for (const [k, b] of Object.entries(state.sources || {})) {
      if (k === "main") continue;
      sources[k] = await store.putBlob(await store.getBlob(b));
    }
    await store.putState(copy.id, { ...state, sources, base: copy.versions[0].id });
  }
  return copy;
}

// Inspect a dropped file: is it a PDF, does it open, is it encrypted?
export async function inspectPdf(bytes) {
  const P = await pdflib();
  let encrypted = false;
  try {
    const d = await P.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    encrypted = d.isEncrypted;
  } catch (e) {
    return { ok: false, error: "Dosya geçerli bir PDF değil ya da bozuk." };
  }
  return { ok: true, encrypted };
}

// Encrypted PDFs cannot be rewritten by pdf-lib. With the password (or
// none, for permission-only locks) pdf.js still renders them, so the
// editable copy is made of page images at print resolution.
export async function rasterizePdf(bytes, password, onProgress) {
  const P = await pdflib();
  const pdf = await openPdf(bytes, password);
  try {
    const out = await P.PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(i, pdf.numPages);
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, viewport: vp, background: "#ffffff" }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
      const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const p = out.addPage([vp1.width, vp1.height]);
      p.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
      page.cleanup();
    }
    out.setProducer("Mühür PDF (pdf-lib)");
    return out.save({ useObjectStreams: false });
  } finally {
    pdf.destroy();
  }
}
