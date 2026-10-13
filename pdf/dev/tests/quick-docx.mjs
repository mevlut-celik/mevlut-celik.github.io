import { setup, app, out } from "../harness.mjs"; import fs from "fs";
await setup();
const M = await app("js/convert/model.js"); const { flowToDocx } = await app("js/convert/to-docx.js");
const flow = M.flowDocument([M.heading(1, "Başlık ğüşıöç"), M.paragraph([M.run("Kalın ", { bold: true }), M.run("kırmızı", { color: "#c0352b", size: 14 })]),
  M.paragraph("Madde", { list: { ordered: false, level: 0 } }),
  { type: "table", rows: [{ cells: [{ blocks: [M.paragraph("A")] }, { blocks: [M.paragraph("B")] }] }], border: { width: 0.5, color: "#000000" } },
  { type: "image", data: new Uint8Array(fs.readFileSync("fixtures/logo.png")), mime: "image/png", width: 120, height: 60 }]);
out("quick.docx", await flowToDocx(flow)); console.log("written");
