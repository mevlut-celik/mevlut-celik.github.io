// The web client's own card path (kart.js) against a bridge in test mode on :21730.
// Make a test key, then start the bridge with it:
//   keytool -genkeypair -alias imza -keyalg EC -groupname secp384r1 -sigalg SHA384withECDSA \
//     -storetype PKCS12 -keystore p384.p12 -storepass 246810 -keypass 246810 -dname "CN=P384 Deneme, C=TR"
//   java -jar ../kopru/MuhurImzaKoprusu.jar --p12 p384.p12
//   node tests/kart-sign.mjs 246810 kart-p384
import { setup, app, fixture, out } from "../harness.mjs";
await setup();
const S = await app("js/sign.js");
const kart = await app("js/kart.js");
const pin = process.argv[2] || "246810";
const name = process.argv[3] || "kart";
console.log("status", await kart.status());
const certs = await kart.certificates(pin);
const c = certs[0];
console.log("cert", c.info.name, c.keyAlg, c.info.curve, c.info.qualified, c.info.subject.serialNumber);
const signer = kart.cardSigner(c, pin);
console.log("hash", signer.hash);
const signed = await S.signPdf(fixture("cv.pdf"), { signer, name: c.info.name, reason: "Onaylıyorum", page: 0 });
out(name + ".pdf", signed);
const v = await S.verifyPdf(signed);
console.log(v.map((r) => ({ who: r.certificate.name, dig: r.digestAlgorithm, integ: r.integrity, sig: r.signatureValid, ess: r.essCertMatch, whole: r.coversWholeDocument, err: r.error })));
try { await kart.certificates("111111"); } catch (e) { console.log("wrong pin ->", e.code, e.message); }
