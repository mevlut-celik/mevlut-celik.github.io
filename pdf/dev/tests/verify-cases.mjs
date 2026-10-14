// Verifier regressions: certificate paths (end-entity issuers, path length,
// expired CAs, anchors carried in the chain), document timestamps and
// adbe.pkcs7.sha1, RSA-PSS, malformed and mismatched signature values,
// validity at the claimed signing time, timestamp tokens, and signer lookup
// by subjectKeyIdentifier.
//   node tests/verify-cases.mjs
// A throwaway "Test Root" is pinned into ANCHORS before the first check.
import { setup, app, fixture } from "../harness.mjs";
import assert from "assert/strict";
import crypto from "crypto";
await setup();
const S = await app("js/sign.js");
const { ANCHORS } = await app("js/trust.js");
const f = globalThis.forge, A = f.asn1, pki = f.pki;
const C = A.Class.UNIVERSAL, T = A.Type, X = A.Class.CONTEXT_SPECIFIC;

/* ------------------------------- helpers -------------------------------- */
const bin = (u8) => Buffer.from(u8).toString("binary");
const u8 = (s) => new Uint8Array(Buffer.from(s, "binary"));
const toDer = (n) => u8(A.toDer(n).getBytes());
const oid = (o) => A.create(C, T.OID, false, A.oidToDer(o).getBytes());
const seq = (v) => A.create(C, T.SEQUENCE, true, v);
const set = (v) => A.create(C, T.SET, true, v);
const int = (n) => A.create(C, T.INTEGER, false, A.integerToDer(n).getBytes());
const oct = (b) => A.create(C, T.OCTETSTRING, false, bin(b));
const nul = () => A.create(C, T.NULL, false, "");
const hash = (alg, data) => new Uint8Array(crypto.createHash(alg).update(data).digest());
const O = {
  data: "1.2.840.113549.1.7.1", signedData: "1.2.840.113549.1.7.2", tstInfo: "1.2.840.113549.1.9.16.1.4",
  contentType: "1.2.840.113549.1.9.3", messageDigest: "1.2.840.113549.1.9.4", timeStampToken: "1.2.840.113549.1.9.16.2.14",
  sha256: "2.16.840.1.101.3.4.2.1", rsa: "1.2.840.113549.1.1.1", pss: "1.2.840.113549.1.1.10", mgf1: "1.2.840.113549.1.1.8",
};
const sha256Alg = () => seq([oid(O.sha256), nul()]);
const attr = (type, value) => seq([oid(type), set([value])]);
const DAY = 864e5;

const keyPair = () => pki.rsa.generateKeyPair(2048);
const nodeKey = (k) => crypto.createPrivateKey(pki.privateKeyToPem(k.privateKey));
function cert({ cn, issuer, keys, signKey, exts, serial, from = Date.now() - DAY, to = Date.now() + 365 * DAY }) {
  const c = pki.createCertificate();
  c.publicKey = keys.publicKey;
  c.serialNumber = serial;
  c.validity.notBefore = new Date(from);
  c.validity.notAfter = new Date(to);
  c.setSubject([{ name: "commonName", value: cn }]);
  c.setIssuer([{ name: "commonName", value: issuer || cn }]);
  c.setExtensions(exts);
  c.sign(signKey || keys.privateKey, f.md.sha256.create());
  return toDer(pki.certificateToAsn1(c));
}
const CA = [{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true }];
const LEAF = [{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true, nonRepudiation: true }, { name: "subjectKeyIdentifier" }];
const TSA = [{ name: "basicConstraints", cA: false }, { name: "keyUsage", digitalSignature: true }, { name: "extKeyUsage", critical: true, timeStamping: true }];

// a signer for signPdf from a forge key pair
const rsaSigner = (certDer, keys, chainDer = []) => ({
  certDer, chainDer, keyAlg: "RSA",
  async sign(data) { return new Uint8Array(crypto.sign("sha256", data, nodeKey(keys))); },
});

// The last signature's covered bytes, and a way to put another CMS into its gap.
function lastGap(pdf) {
  const txt = Buffer.from(pdf).toString("latin1");
  const m = [...txt.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].pop();
  const [, b, c, d] = m.slice(1, 5).map(Number);
  const covered = new Uint8Array(Buffer.concat([Buffer.from(pdf.subarray(0, b)), Buffer.from(pdf.subarray(c, c + d))]));
  const put = (cms) => {
    const hex = Buffer.from(cms).toString("hex");
    assert.ok(hex.length <= c - b - 2, "CMS fits the gap");
    const outPdf = Uint8Array.from(pdf);
    outPdf.set(Buffer.from(hex.padEnd(c - b - 2, "0"), "latin1"), b + 1);
    return outPdf;
  };
  return { covered, put };
}

// A SignedData built by hand. o: { certs (DER list), signerCert (DER), sid:
// "issuerSerial" | "ski", signedAttrs (nodes) | null, content (bytes signed
// when there are no signed attributes), eContentType, eContent, sigAlg (node),
// sign(bytes) -> signature, unsigned(signature) -> attribute nodes }
function buildCms(o) {
  const tbs = A.fromDer(bin(o.signerCert)).value[0].value;
  let sid;
  if (o.sid === "ski") sid = A.create(X, 0, false, bin(Buffer.from(o.ski, "hex")));
  else sid = seq([A.copy(tbs[3]), A.copy(tbs[1])]);
  const toSign = o.signedAttrs ? toDer(set(o.signedAttrs)) : o.content;
  const signature = o.sign(toSign);
  const si = [int(o.sid === "ski" ? 3 : 1), sid, sha256Alg()];
  if (o.signedAttrs) si.push(A.create(X, 0, true, o.signedAttrs));
  si.push(o.sigAlg || seq([oid(O.rsa), nul()]), oct(signature));
  if (o.unsigned) si.push(A.create(X, 1, true, o.unsigned(signature)));
  const eci = o.eContent
    ? seq([oid(o.eContentType || O.data), A.create(X, 0, true, [oct(o.eContent)])])
    : seq([oid(o.eContentType || O.data)]);
  const sd = seq([int(o.sid === "ski" ? 3 : 1), set([sha256Alg()]), eci,
    A.create(X, 0, true, o.certs.map((d) => A.fromDer(bin(d)))), set([seq(si)])]);
  return toDer(seq([oid(O.signedData), A.create(X, 0, true, [sd])]));
}
const detachedAttrs = (covered) => [attr(O.contentType, oid(O.data)), attr(O.messageDigest, oct(hash("sha256", covered)))];

// RFC 3161 TSTInfo and a token (ContentInfo) over `imprintOf`.
function tstInfo(imprintOf, genTime) {
  return toDer(seq([int(1), oid("1.2.3.4.1"), seq([sha256Alg(), oct(hash("sha256", imprintOf))]), int(42),
    A.create(C, T.GENERALIZEDTIME, false, A.dateToGeneralizedTime(genTime))]));
}
function token(imprintOf, tsaCert, tsaKeys, genTime = new Date()) {
  const tst = tstInfo(imprintOf, genTime);
  return buildCms({
    certs: [tsaCert], signerCert: tsaCert, eContentType: O.tstInfo, eContent: tst,
    signedAttrs: [attr(O.contentType, oid(O.tstInfo)), attr(O.messageDigest, oct(hash("sha256", tst)))],
    sign: (data) => new Uint8Array(crypto.sign("sha256", data, nodeKey(tsaKeys))),
  });
}

let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log("ok  " + label); };

/* ------------------------------ the test PKI ----------------------------- */
const rootKeys = keyPair();
const rootDer = cert({ cn: "Test Root", keys: rootKeys, exts: CA, serial: "01" });
ANCHORS.push({ name: "Test Root", root: true, sha384: crypto.createHash("sha384").update(rootDer).digest("hex"), der: Buffer.from(rootDer).toString("base64") });

const leafKeys = keyPair();
const leafDer = cert({ cn: "Attacker Citizen", issuer: "Test Root", keys: leafKeys, signKey: rootKeys.privateKey, exts: LEAF, serial: "02" });
const victimKeys = keyPair();
const victimDer = cert({ cn: "Victim Name", issuer: "Attacker Citizen", keys: victimKeys, signKey: leafKeys.privateKey, exts: LEAF, serial: "03" });

/* -------------------- 9: end-entity issuers, constraints ------------------ */
{
  const viaLeaf = await S.certificateChain(victimDer, [leafDer]);
  check("9: a cA:false certificate cannot issue (" + viaLeaf.reason + ")", () => {
    assert.equal(viaLeaf.trusted, false);
    assert.equal(viaLeaf.reason, "not-ca");
  });
  const leafChain = await S.certificateChain(leafDer);
  check("9: the leaf itself chains to the test root", () => assert.equal(leafChain.trusted, true));

  // the same forgery as a PDF signature
  const pdf = await S.signPdf(fixture("cv.pdf"), { signer: rsaSigner(victimDer, victimKeys, [leafDer]), name: "Victim Name", page: 0 });
  const [r] = await S.verifyPdf(pdf);
  check("9: forged 'Victim Name' signature is not trusted", () => {
    assert.equal(r.signatureValid, true);
    assert.equal(r.chain.trusted, false);
  });

  // pathLen 0 on an intermediate: a sub-CA under it is refused
  const midKeys = keyPair(), subKeys = keyPair(), endKeys = keyPair();
  const midDer = cert({ cn: "Mid CA", issuer: "Test Root", keys: midKeys, signKey: rootKeys.privateKey, serial: "10",
    exts: [{ name: "basicConstraints", cA: true, pathLenConstraint: 0 }, { name: "keyUsage", keyCertSign: true }] });
  const subDer = cert({ cn: "Sub CA", issuer: "Mid CA", keys: subKeys, signKey: midKeys.privateKey, exts: CA, serial: "11" });
  const endDer = cert({ cn: "End", issuer: "Sub CA", keys: endKeys, signKey: subKeys.privateKey, exts: LEAF, serial: "12" });
  const tooDeep = await S.certificateChain(endDer, [subDer, midDer]);
  check("9: pathLenConstraint is enforced", () => {
    assert.equal(tooDeep.trusted, false);
    assert.equal(tooDeep.reason, "path-length");
  });
  const direct = cert({ cn: "Direct", issuer: "Mid CA", keys: endKeys, signKey: midKeys.privateKey, exts: LEAF, serial: "13" });
  const directChain = await S.certificateChain(direct, [midDer]);
  check("9: pathLen 0 still issues end entities", () => assert.equal(directChain.trusted, true));

  // an issuing CA outside its validity at the signing time
  const oldKeys = keyPair();
  const oldCa = cert({ cn: "Old CA", issuer: "Test Root", keys: oldKeys, signKey: rootKeys.privateKey, exts: CA, serial: "14",
    from: Date.UTC(2020, 0, 1), to: Date.UTC(2021, 0, 1) });
  const oldLeaf = cert({ cn: "Old Leaf", issuer: "Old CA", keys: endKeys, signKey: oldKeys.privateKey, exts: LEAF, serial: "15",
    from: Date.UTC(2020, 0, 1), to: Date.UTC(2021, 0, 1) });
  const now = await S.certificateChain(oldLeaf, [oldCa]);
  const then = await S.certificateChain(oldLeaf, [oldCa], new Date(Date.UTC(2020, 5, 1)));
  check("9: issuing CA validity is checked at the signing time", () => {
    assert.equal(now.trusted, false);
    assert.equal(now.reason, "expired");
    assert.equal(then.trusted, true);
  });
}

/* ------------------- 10: anchors carried inside the chain ----------------- */
{
  const der = (name) => new Uint8Array(Buffer.from(ANCHORS.find((a) => a.name === name).der, "base64"));
  const inter = der("Kamu Elektronik Sertifika Hizmet Sağlayıcısı - Sürüm 7");
  const root = der("Kamu SM Kök Sertifika Hizmet Sağlayıcısı - Sürüm 7");
  const withRoot = await S.certificateChain(inter, [root]);
  const withBoth = await S.certificateChain(inter, [inter, root]);
  check("10: a chain carrying the pinned root is trusted", () => {
    assert.equal(withRoot.trusted, true);
    assert.equal(withBoth.trusted, true);
  });
  // as a PDF: leaf + its root inside the CMS (what the bridge embeds)
  const pdf = await S.signPdf(fixture("cv.pdf"), { signer: rsaSigner(leafDer, leafKeys, [rootDer]), name: "Attacker Citizen", page: 0 });
  const [r] = await S.verifyPdf(pdf);
  check("10: CMS [leaf, root copy] is trusted", () => assert.equal(r.chain.trusted, true));
}

/* --------------- 11: document timestamp and adbe.pkcs7.sha1 --------------- */
const tsaKeys = keyPair();
const tsaDer = cert({ cn: "Test TSA", issuer: "Test Root", keys: tsaKeys, signKey: rootKeys.privateKey, exts: TSA, serial: "20" });
{
  const id = await S.createSelfSignedIdentity({ name: "Zaman Testi" });
  const signed = await S.signPdf(fixture("cv.pdf"), { identity: id, name: "Zaman Testi", page: 0 });
  // append a /DocTimeStamp revision
  const latin = Buffer.from(signed).toString("latin1");
  const prev = Number(/startxref\s+(\d+)/.exec(latin.slice(latin.lastIndexOf("startxref")))[1]);
  const size = Number([...latin.matchAll(/\/Size\s+(\d+)/g)].pop()[1]);
  const root = [...latin.matchAll(/\/Root\s+(\d+ \d+ R)/g)].pop()[1];
  const HEX = 12000, place = "[0 0000000000 0000000000 0000000000]";
  let upd = `\n${size} 0 obj\n<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 /ByteRange ${place} /Contents <`;
  const objAt = signed.length + 1;
  const hexAt = signed.length + upd.length;
  upd += "0".repeat(HEX) + "> >>\nendobj\n";
  const xrefAt = signed.length + upd.length;
  upd += `xref\n${size} 1\n${String(objAt).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${size + 1} /Root ${root} /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const whole = Buffer.concat([Buffer.from(signed), Buffer.from(upd, "latin1")]);
  const b = hexAt - 1, c = hexAt + HEX + 1;
  whole.write(`[0 ${String(b).padStart(10, "0")} ${String(c).padStart(10, "0")} ${String(whole.length - c).padStart(10, "0")}]`, whole.indexOf(place, signed.length, "latin1"), "latin1");
  const stamped = new Uint8Array(whole);
  const { covered, put } = lastGap(stamped);
  const withTs = put(token(covered, tsaDer, tsaKeys));
  const v = await S.verifyPdf(withTs);
  check("11: document timestamp verifies and covers the earlier signature", () => {
    assert.equal(v.length, 2);
    assert.equal(v[0].integrity, true);
    assert.equal(v[1].documentTimestamp, true);
    assert.equal(v[1].integrity, true);
    assert.equal(v[1].signatureValid, true);
    assert.equal(v[1].imprintMatch, true);
    assert.equal(v[1].coversWholeDocument, true);
    assert.equal(v[1].chain.trusted, true);
    assert.ok(v[1].signingTime instanceof Date);
  });
  const early = Uint8Array.from(withTs); early[1500] ^= 1;
  const ve = await S.verifyPdf(early);
  check("11: a change in the first revision breaks both", () => assert.deepEqual(ve.map((r) => r.integrity), [false, false]));
  const late = Uint8Array.from(withTs); late[withTs.length - 30] ^= 1;
  const vl = await S.verifyPdf(late);
  check("11: a change only the timestamp covers breaks only the timestamp", () => assert.deepEqual(vl.map((r) => r.integrity), [true, false]));

  // adbe.pkcs7.sha1: the CMS encapsulates SHA-1(covered bytes)
  const subPdf = await S.signPdf(fixture("cv.pdf"), { signer: rsaSigner(leafDer, leafKeys), name: "Sha1", page: 0 });
  const txt = Buffer.from(subPdf).toString("latin1").replace("/SubFilter /ETSI.CAdES.detached", "/SubFilter /adbe.pkcs7.sha1    ");
  const sha1Pdf = new Uint8Array(Buffer.from(txt, "latin1"));
  const g = lastGap(sha1Pdf);
  const eContent = hash("sha1", g.covered);
  const cms = buildCms({
    certs: [leafDer], signerCert: leafDer, eContent,
    signedAttrs: [attr(O.contentType, oid(O.data)), attr(O.messageDigest, oct(hash("sha256", eContent)))],
    sign: (data) => new Uint8Array(crypto.sign("sha256", data, nodeKey(leafKeys))),
  });
  const [rs] = await S.verifyPdf(g.put(cms));
  check("11: adbe.pkcs7.sha1 verifies", () => {
    assert.equal(rs.subFilter, "adbe.pkcs7.sha1");
    assert.equal(rs.integrity, true);
    assert.equal(rs.signatureValid, true);
  });
}

/* ------------------------------- 12: RSA-PSS ------------------------------ */
{
  const pdf = await S.signPdf(fixture("cv.pdf"), { signer: rsaSigner(leafDer, leafKeys), name: "PSS", page: 0 });
  const g = lastGap(pdf);
  const pssAlg = (salt) => seq([oid(O.pss), seq([
    A.create(X, 0, true, [sha256Alg()]),
    A.create(X, 1, true, [seq([oid(O.mgf1), sha256Alg()])]),
    A.create(X, 2, true, [int(salt)]),
  ])]);
  const pssSign = (data) => new Uint8Array(crypto.sign("sha256", data, { key: nodeKey(leafKeys), padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }));
  const [ok] = await S.verifyPdf(g.put(buildCms({ certs: [leafDer], signerCert: leafDer, signedAttrs: detachedAttrs(g.covered), sigAlg: pssAlg(32), sign: pssSign })));
  check("12: RSA-PSS (SHA-256, MGF1-SHA-256, salt 32) verifies", () => {
    assert.equal(ok.integrity, true);
    assert.equal(ok.signatureValid, true);
  });
  const [wrongSalt] = await S.verifyPdf(g.put(buildCms({ certs: [leafDer], signerCert: leafDer, signedAttrs: detachedAttrs(g.covered), sigAlg: pssAlg(20), sign: pssSign })));
  check("12: RSA-PSS with the wrong salt length fails", () => assert.equal(wrongSalt.signatureValid, false));
}

/* ------------------ 13: malformed and mismatched values ------------------- */
{
  // a real EC P-384 certificate (a Kamu SM CA's, public only) and a junk value
  const ecDer = new Uint8Array(Buffer.from(ANCHORS.find((a) => !a.root).der, "base64"));
  const junk = { certDer: ecDer, chainDer: [], keyAlg: "ECDSA", hash: "SHA-384", async sign() { return new Uint8Array([1, 2, 3]); } };
  const [r] = await S.verifyPdf(await S.signPdf(fixture("cv.pdf"), { signer: junk, name: "Kurban", page: 0 }));
  check("13: a malformed ECDSA value is invalid, not unverifiable", () => {
    assert.equal(r.integrity, true);
    assert.equal(r.signatureValid, false);
    assert.equal(r.chain.trusted, false);   // and a CA's certificate is no signer
  });
  // an ECDSA algorithm under an RSA key
  const pdf = await S.signPdf(fixture("cv.pdf"), { signer: rsaSigner(leafDer, leafKeys), name: "Mix", page: 0 });
  const g = lastGap(pdf);
  const sign = (data) => new Uint8Array(crypto.sign("sha256", data, nodeKey(leafKeys)));
  const [mix] = await S.verifyPdf(g.put(buildCms({ certs: [leafDer], signerCert: leafDer, signedAttrs: detachedAttrs(g.covered), sigAlg: seq([oid("1.2.840.10045.4.3.2")]), sign })));
  check("13: an algorithm of the other key family is invalid", () => assert.equal(mix.signatureValid, false));
  // an algorithm WebCrypto lacks (sha224WithRSAEncryption) stays unverifiable
  const [odd] = await S.verifyPdf(g.put(buildCms({ certs: [leafDer], signerCert: leafDer, signedAttrs: detachedAttrs(g.covered), sigAlg: seq([oid("1.2.840.113549.1.1.14"), nul()]), sign })));
  check("13: an unsupported algorithm is null (unverified)", () => {
    assert.equal(odd.signatureValid, null);
    assert.ok(odd.verifyNote);
  });
}

/* --------------- 14: validity at the claimed signing time ---------------- */
{
  const keys = keyPair();
  const oldSelf = cert({ cn: "Eski Kimlik", keys, exts: LEAF, serial: "30", from: Date.UTC(2020, 0, 1), to: Date.UTC(2021, 0, 1) });
  const signer = rsaSigner(oldSelf, keys);
  const [then] = await S.verifyPdf(await S.signPdf(fixture("cv.pdf"), { signer, name: "Eski", page: 0, date: new Date(Date.UTC(2020, 5, 1)) }));
  const [after] = await S.verifyPdf(await S.signPdf(fixture("cv.pdf"), { signer, name: "Eski", page: 0, date: new Date(Date.UTC(2022, 5, 1)) }));
  check("14: valid at /M, expired today", () => {
    assert.equal(then.certValidAtSigning, true);
    assert.equal(then.certExpiredNow, true);
    assert.equal(after.certValidAtSigning, false);
  });
}

/* ----------------------- 15: unsigned timestamp tokens -------------------- */
{
  const pdf = await S.signPdf(fixture("cv.pdf"), { signer: rsaSigner(leafDer, leafKeys), name: "TS", page: 0 });
  const g = lastGap(pdf);
  const sign = (data) => new Uint8Array(crypto.sign("sha256", data, nodeKey(leafKeys)));
  const withToken = (make) => buildCms({ certs: [leafDer], signerCert: leafDer, signedAttrs: detachedAttrs(g.covered), sign,
    unsigned: (sig) => [seq([oid(O.timeStampToken), set([A.fromDer(bin(make(sig)))])])] });
  const junkAttr = buildCms({ certs: [leafDer], signerCert: leafDer, signedAttrs: detachedAttrs(g.covered), sign,
    unsigned: () => [seq([oid(O.timeStampToken), set([seq([])])])] });

  const [junk] = await S.verifyPdf(g.put(junkAttr));
  check("15: a junk token is not a trusted timestamp", () => {
    assert.equal(junk.hasTimestamp, true);
    assert.equal(junk.timestamp.trusted, false);
    assert.equal(junk.signatureValid, true);
  });
  const [good] = await S.verifyPdf(g.put(withToken((sig) => token(sig, tsaDer, tsaKeys))));
  check("15: a token over this signature from a pinned TSA is trusted", () => {
    assert.equal(good.timestamp.trusted, true);
    assert.equal(good.timestamp.imprintMatch, true);
    assert.ok(good.timestamp.genTime instanceof Date);
    assert.equal(good.timestamp.tsa, "Test TSA");
  });
  const [other] = await S.verifyPdf(g.put(withToken(() => token(new Uint8Array([9, 9, 9]), tsaDer, tsaKeys))));
  check("15: a token over something else does not match", () => {
    assert.equal(other.timestamp.imprintMatch, false);
    assert.equal(other.timestamp.trusted, false);
  });
  const notTsaDer = cert({ cn: "Not A TSA", issuer: "Test Root", keys: tsaKeys, signKey: rootKeys.privateKey, exts: LEAF, serial: "21" });
  const [noEku] = await S.verifyPdf(g.put(withToken((sig) => token(sig, notTsaDer, tsaKeys))));
  check("15: a token signed without the timeStamping EKU is not trusted", () => {
    assert.equal(noEku.timestamp.imprintMatch, true);
    assert.equal(noEku.timestamp.trusted, false);
    assert.equal(noEku.timestamp.chain.reason, "not-tsa");
  });
}

/* ------------------- 16: signer by subjectKeyIdentifier ------------------- */
{
  const pdf = await S.signPdf(fixture("cv.pdf"), { signer: rsaSigner(leafDer, leafKeys), name: "SKI", page: 0 });
  const g = lastGap(pdf);
  const sign = (data) => new Uint8Array(crypto.sign("sha256", data, nodeKey(leafKeys)));
  const ski = S.parseCertificate(A.fromDer(bin(leafDer))).skiHex;
  const [bySki] = await S.verifyPdf(g.put(buildCms({ certs: [rootDer, leafDer], signerCert: leafDer, sid: "ski", ski, signedAttrs: detachedAttrs(g.covered), sign })));
  check("16: SKI sid with the CA listed first picks the leaf", () => {
    assert.equal(bySki.certificate.name, "Attacker Citizen");
    assert.equal(bySki.signatureValid, true);
    assert.equal(bySki.chain.trusted, true);
  });
  const [caFirst] = await S.verifyPdf(g.put(buildCms({ certs: [rootDer, leafDer], signerCert: leafDer, signedAttrs: detachedAttrs(g.covered), sign })));
  check("16: issuerAndSerial with the CA listed first picks the leaf", () => assert.equal(caFirst.signatureValid, true));
  const [missing] = await S.verifyPdf(g.put(buildCms({ certs: [rootDer], signerCert: leafDer, signedAttrs: detachedAttrs(g.covered), sign })));
  check("16: no matching certificate is 'signer missing', not the CA's", () => {
    assert.equal(missing.signerMissing, true);
    assert.equal(missing.signatureValid, null);
    assert.equal(missing.certificate, undefined);
  });
}

console.log(`verify-cases: ${passed} checks passed`);
