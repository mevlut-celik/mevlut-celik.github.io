// Sign twice (incremental), verify with our verifier; writes PDFs and certs
// for an external validator (pyHanko) to check as well.
import { setup, app, fixture, out } from "../harness.mjs";
import fs from "fs";
await setup();
const S = await app("js/sign.js");
const base = fixture("cv.pdf");
const a = await S.createSelfSignedIdentity({ name: "Mevlüt Çelik", email: "a@muhur.test", organization: "Mühür" });
const b = await S.createSelfSignedIdentity({ name: "İkinci Şahıs", email: "b@muhur.test" });
const font = fs.readFileSync(new URL("../../assets/fonts/LiberationSans-Regular.ttf", import.meta.url));
const s1 = await S.signPdf(base, { identity: a, name: "Mevlüt Çelik", reason: "Onaylıyorum", location: "Ankara", page: 0, rect: [380, 40, 560, 100],
  appearance: { lines: ["Dijital olarak imzalayan:", "Mevlüt Çelik", "Neden: Onaylıyorum"], fontBytes: font } });
const s2 = await S.signPdf(s1, { identity: b, name: "İkinci Şahıs", reason: "İnceledim", page: 1 });
out("cades-1.pdf", s1); out("cades-2.pdf", s2);
out("cert-a.pem", new TextEncoder().encode(a.certPem)); out("cert-b.pem", new TextEncoder().encode(b.certPem));
const v = await S.verifyPdf(s2);
console.log(v.map((r) => ({ who: r.certificate && r.certificate.name, sub: r.subFilter, integ: r.integrity, sig: r.signatureValid, ess: r.essCertMatch, whole: r.coversWholeDocument, err: r.error })));
const t = Uint8Array.from(s2); t[2000] ^= 1;
console.log("tampered", (await S.verifyPdf(t)).map((r) => [r.integrity, r.signatureValid]));
