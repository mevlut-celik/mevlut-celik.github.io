// Draw the boxes of the extracted (invisible) text over the page render.
import { setup, app, out, OUT } from "../harness.mjs";
import fs from "fs";
await setup();
const { openPdf, closePdf } = await app("js/libs.js");
const { renderPage, canvasToBytes } = await app("js/convert/canvas.js");
const bytes = new Uint8Array(fs.readFileSync(OUT + "/" + (process.argv[2] || "ocr-out.pdf")));
const pdf = await openPdf(bytes);
const page = Number(process.argv[3] || 0);
const scale = 1.4;
const canvas = await renderPage(pdf, page, scale);
const ctx = canvas.getContext("2d");
const pp = await pdf.getPage(page + 1);
const vp = pp.getViewport({ scale });
const tc = await pp.getTextContent();
ctx.strokeStyle = "rgba(255,0,0,0.8)"; ctx.lineWidth = 1;
for (const it of tc.items) {
  if (!it.str.trim()) continue;
  const m = [vp.transform[0] * it.transform[0] + vp.transform[2] * it.transform[1], vp.transform[1] * it.transform[0] + vp.transform[3] * it.transform[1],
    vp.transform[0] * it.transform[2] + vp.transform[2] * it.transform[3], vp.transform[1] * it.transform[2] + vp.transform[3] * it.transform[3],
    vp.transform[0] * it.transform[4] + vp.transform[2] * it.transform[5] + vp.transform[4], vp.transform[1] * it.transform[4] + vp.transform[3] * it.transform[5] + vp.transform[5]];
  const h = Math.hypot(m[2], m[3]);
  const w = it.width * scale;
  ctx.save(); ctx.translate(m[4], m[5]); ctx.rotate(Math.atan2(m[1], m[0]));
  ctx.strokeRect(0, -h * 0.8, w, h);
  ctx.restore();
}
out(`overlay-${page}.png`, await canvasToBytes(canvas));
closePdf(pdf);
console.log("ok", tc.items.length);
