// Signature wrapping: a signed "Pay 100 TL" page, then forged files whose
// ByteRange still hashes to the signed digest but whose /Contents gap holds a
// new content stream ("Pay 999999 TL") and a second copy of the signature
// dictionary. The verifier must reject every one of them, and must read the
// signature dictionary from the signed bytes, not from a later redefinition.
//   node tests/sign-wrap.mjs
import { setup, app, out } from "../harness.mjs";
import assert from "assert/strict";
await setup();
const S = await app("js/sign.js");
const P = globalThis.PDFLib;
const latin = (u8) => Buffer.from(u8).toString("latin1");
const fromLatin = (s) => new Uint8Array(Buffer.from(s, "latin1"));

// 1. a one-page PDF, signed
const d = await P.PDFDocument.create();
const font = await d.embedFont(P.StandardFonts.Helvetica);
d.addPage([595, 842]).drawText("Pay 100 TL", { x: 50, y: 700, size: 24, font });
const base = await d.save({ useObjectStreams: false });
const id = await S.createSelfSignedIdentity({ name: "Alice", email: "a@muhur.test" });
const signed = await S.signPdf(base, { identity: id, name: "Alice", reason: "Onaylıyorum", page: 0 });
out("wrap-signed.pdf", signed);
const [genuine] = await S.verifyPdf(signed);
assert.equal(genuine.integrity, true);
assert.equal(genuine.signatureValid, true);
assert.equal(genuine.coversWholeDocument, true);
assert.equal(genuine.reason, "Onaylıyorum");
console.log("genuine: ok");

// where things are
const txt = latin(signed);
const m = [...txt.matchAll(/(\d+) 0 obj\s*<< \/Type \/Sig[^]*?\/ByteRange \[(\d+) (\d+) (\d+) (\d+)/g)].pop();
const N = Number(m[1]);
const [, b, c, dd] = m.slice(2, 6).map(Number);
const hexWithDelims = txt.slice(b, c);
const doc = await P.PDFDocument.load(signed);
let cref = doc.getPages()[0].node.get(P.PDFName.of("Contents"));
if (cref instanceof P.PDFArray) cref = cref.get(0);
const stream = doc.context.lookup(cref);
let ops = latin(stream.getContents());
if (stream.dict.get(P.PDFName.of("Filter"))) ops = latin(globalThis.fflate.unzlibSync(stream.getContents()));
const realHex = Buffer.from("Pay 100 TL").toString("hex").toUpperCase();
const fakeHex = Buffer.from("Pay 999999 TL").toString("hex").toUpperCase();
assert.ok(ops.includes(realHex), "content stream holds the text as hex");
const forgedOps = ops.replace(realHex, fakeHex);
const forgedStream = `${cref.objectNumber} 0 obj\n<< /Length ${forgedOps.length} >>\nstream\n${forgedOps}\nendstream\nendobj\n`;
const sigHead = (br) => `${N} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached\n/ByteRange [${br.join(" ")}]\n/Contents `;

async function pageText(bytes) {
  const f = await P.PDFDocument.load(bytes);
  let r = f.getPages()[0].node.get(P.PDFName.of("Contents"));
  if (r instanceof P.PDFArray) r = r.get(0);
  const s = f.context.lookup(r);
  const raw = s.dict.get(P.PDFName.of("Filter")) ? globalThis.fflate.unzlibSync(s.getContents()) : s.getContents();
  return latin(raw).includes(fakeHex) ? "forged" : "original";
}

async function expectRejected(label, bytes) {
  out(`wrap-${label}.pdf`, bytes);
  // the forgery is real: pdf-lib (the editor) reads the forged page
  assert.equal(await pageText(bytes), "forged", label + ": the forgery should be what a parser shows");
  const v = await S.verifyPdf(bytes);
  assert.ok(v.length >= 1, label + ": a signature is reported");
  for (const r of v) {
    assert.equal(r.integrity, false, label + ": integrity");
    assert.equal(r.signatureValid, false, label + ": signatureValid");
    assert.match(r.error || "", /İmza yapısı geçersiz/, label + ": error");
  }
  console.log(`${label}: rejected (${v.map((r) => r.error).join(" | ")})`);
}

// 2. the gap grows: original hex, forged objects, a new signature dictionary
//    whose ByteRange ends at the end of the file; the original signed tail
//    closes that dictionary
{
  const build = (cp) => hexWithDelims + "\n>>\nendobj\n" + forgedStream + sigHead([0, b, cp, dd]) + hexWithDelims;
  let cp = b + build(b + 1e7).length;
  let gap = build(cp);
  for (let k = 0; k < 5 && b + gap.length !== cp; k++) { cp = b + gap.length; gap = build(cp); }
  assert.equal(b + gap.length, cp, "fixed point for the new ByteRange");
  const forged = new Uint8Array(Buffer.concat([Buffer.from(signed.subarray(0, b)), Buffer.from(gap, "latin1"), Buffer.from(signed.subarray(c))]));
  await expectRejected("grown-gap", forged);
}

// 3. same length: the injected objects replace part of the zero padding
//    inside /Contents, so the ByteRange (and every xref offset) is unchanged
{
  const inner = hexWithDelims.slice(1, -1);
  const used = inner.replace(/0+$/, "").length + 64;
  const payload = ">\n>>\nendobj\n" + forgedStream + sigHead([0, b, c, dd]) + "<" + inner.slice(0, used);
  assert.ok(used + payload.length < inner.length, "payload fits into the padding");
  const filled = inner.slice(0, used) + payload + "0".repeat(inner.length - used - payload.length);
  const forged = fromLatin(txt.slice(0, b + 1) + filled + txt.slice(c - 1));
  assert.equal(forged.length, signed.length);
  await expectRejected("same-length", forged);
}

// 4. the ByteRange must start at 0 and the gap must be <hex> exactly
{
  const shifted = fromLatin(txt.replace(`/ByteRange [0 ${b} ${c} ${dd}]`, `/ByteRange [0 ${b + 1} ${c} ${dd}]`.padEnd(`/ByteRange [0 ${b} ${c} ${dd}]`.length, " ")));
  const [r] = await S.verifyPdf(shifted);
  assert.equal(r.integrity, false);
  assert.match(r.error || "", /İmza yapısı geçersiz/);
  console.log("gap not on '<': rejected (" + r.error + ")");
}

// 5. a later update redefines the signature object (new /Reason, /M): the
//    signature stays valid but its dictionary is read from the signed bytes
{
  const sx = txt.lastIndexOf("startxref");
  const prev = Number(/startxref\s+(\d+)/.exec(txt.slice(sx))[1]);
  const size = Number([...txt.matchAll(/\/Size\s+(\d+)/g)].pop()[1]);
  const root = [...txt.matchAll(/\/Root\s+(\d+ \d+ R)/g)].pop()[1];
  const at = signed.length;
  const obj = `${N} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 ${b} ${c} ${dd}] /Contents <00> /Reason (Sahte neden) /M (D:20000101000000Z) >>\nendobj\n`;
  const xrefAt = at + obj.length;
  const upd = obj + `xref\n${N} 1\n${String(at).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${size} /Root ${root} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const redefined = new Uint8Array(Buffer.concat([Buffer.from(signed), Buffer.from(upd, "latin1")]));
  out("wrap-redefined.pdf", redefined);
  const [r] = await S.verifyPdf(redefined);
  assert.equal(r.integrity, true);
  assert.equal(r.signatureValid, true);
  assert.equal(r.laterChanges, true);
  assert.equal(r.reason, "Onaylıyorum", "reason from the signed dictionary");
  assert.ok(r.dictTime && r.dictTime.getFullYear() > 2000, "/M from the signed dictionary");
  console.log("redefined dictionary: signed /Reason and /M kept, later changes flagged");
}
console.log("sign-wrap: all passed");
