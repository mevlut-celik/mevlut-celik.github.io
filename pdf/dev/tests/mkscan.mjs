import { setup, FIXTURES } from "../harness.mjs"; import fs from "fs";
await setup(); const { PDFDocument, degrees } = PDFLib;
const doc = await PDFDocument.create();
for (const f of ["out/scan-1.jpg", "out/scan-2.jpg"]) { const img = await doc.embedJpg(fs.readFileSync(f)); const p = doc.addPage([595.28, 841.89]); p.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 }); }
fs.writeFileSync(FIXTURES + "/scanned.pdf", await doc.save()); console.log("scanned ok");
