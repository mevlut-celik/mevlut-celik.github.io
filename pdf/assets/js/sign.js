/* ==========================================================================
   Mühür — sign.js
   Cryptographic signatures, the part a picture of a signature cannot give:

   1. Identity  — a self-signed X.509 certificate made in the browser, or the
                  user's own .p12/.pfx (RSA). Keys never leave the device.
   2. Signing   — PAdES baseline (SubFilter ETSI.CAdES.detached): a CMS
                  SignedData built here, with contentType, messageDigest
                  and ESS signing-certificate-v2 as signed attributes and
                  the signing time in the signature dictionary's /M. The
                  signature value comes from a "signer": the browser's own
                  key (self-signed or .p12), or an e-signature card behind
                  the local bridge (kopru/), which signs the attributes
                  after the user's PIN. Written as an incremental update
                  so earlier signatures in the file stay valid; classic
                  xref tables and xref streams are both continued in kind.
   3. Verifying — every /ByteRange in a file is checked: the gap it leaves
                  must be the /Contents hex string and nothing else, and the
                  signature dictionary is read from the signed bytes; then
                  the digest of the covered bytes against the signed
                  messageDigest (or a document timestamp's imprint), the
                  signature over the signed attributes with WebCrypto (RSA
                  PKCS#1 v1.5, RSA-PSS and ECDSA), whether the signature
                  covers the whole file, the certificate path to a pinned
                  root (CA flags, key usage, path length, validity) and any
                  timestamp token.

   pdf-lib and forge are loaded as classic scripts and read from globalThis,
   so this module also runs under Node for the test-suite.
   ========================================================================== */

import {
  enc, toBytes, concatBytes, bytesToBinary, binaryToBytes, bytesToHex, digest,
  indexOfAscii, lastIndexOfAscii, pdfDate, parsePdfDate,
} from "./util.js";
import { ANCHORS } from "./trust.js";

const lib = () => globalThis.PDFLib;
const forge = () => globalThis.forge;

export const SIGNATURE_BYTES = 16384;          // room reserved for the CMS blob
const BYTE_RANGE_PLACEHOLDER = "[0 /********** /********** /**********]";

/* ============================== Identity ================================ */

// RSA-2048 from WebCrypto (fast, native), wrapped into a forge certificate.
export async function createSelfSignedIdentity({ name, email, organization }) {
  const f = forge();
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const privateKey = f.pki.privateKeyFromAsn1(f.asn1.fromDer(bytesToBinary(pkcs8)));
  const publicKey = f.pki.setRsaPublicKey(privateKey.n, privateKey.e);

  const cert = f.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = "01" + bytesToHex(crypto.getRandomValues(new Uint8Array(15)));
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60 * 1000);
  cert.validity.notAfter = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());
  const attrs = [{ name: "commonName", value: name || email, valueTagClass: f.asn1.Type.UTF8 }];
  if (organization) attrs.push({ name: "organizationName", value: organization, valueTagClass: f.asn1.Type.UTF8 });
  if (email) attrs.push({ name: "emailAddress", value: email });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
    { name: "subjectKeyIdentifier" },
  ].concat(email ? [{ name: "subjectAltName", altNames: [{ type: 1, value: email }] }] : []));
  cert.sign(privateKey, f.md.sha256.create());

  return {
    source: "self",
    certPem: f.pki.certificateToPem(cert),
    keyPem: f.pki.privateKeyInfoToPem(f.pki.wrapRsaPrivateKey(f.pki.privateKeyToAsn1(privateKey))),
    chainPem: [],
    created: now.toISOString(),
  };
}

export function importP12(buffer, password) {
  const f = forge();
  let p12;
  try {
    const asn1 = f.asn1.fromDer(bytesToBinary(toBytes(buffer)));
    p12 = f.pkcs12.pkcs12FromAsn1(asn1, false, password || "");
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/mac|password|Invalid|decrypt/i.test(msg)) throw new Error("Sertifika dosyası açılamadı: parola yanlış olabilir.");
    if (/OID is not RSA|Unsupported|not supported/i.test(msg)) throw new Error("Bu sertifika türü desteklenmiyor. Yalnızca RSA anahtarlı .p12/.pfx dosyaları içe aktarılabilir.");
    throw new Error("Sertifika dosyası okunamadı (" + msg + ").");
  }
  const keyBags = []
    .concat(p12.getBags({ bagType: f.pki.oids.pkcs8ShroudedKeyBag })[f.pki.oids.pkcs8ShroudedKeyBag] || [])
    .concat(p12.getBags({ bagType: f.pki.oids.keyBag })[f.pki.oids.keyBag] || []);
  const certBags = p12.getBags({ bagType: f.pki.oids.certBag })[f.pki.oids.certBag] || [];
  const key = keyBags.map((b) => b.key).find(Boolean);
  if (!key) throw new Error("Dosyada özel anahtar bulunamadı (ya da anahtar RSA değil).");
  const certs = certBags.map((b) => b.cert).filter(Boolean);
  if (!certs.length) throw new Error("Dosyada sertifika bulunamadı.");
  const own = certs.find((c) => c.publicKey && c.publicKey.n && c.publicKey.n.equals(key.n)) || certs[0];
  return {
    source: "p12",
    certPem: f.pki.certificateToPem(own),
    keyPem: f.pki.privateKeyInfoToPem(f.pki.wrapRsaPrivateKey(f.pki.privateKeyToAsn1(key))),
    chainPem: certs.filter((c) => c !== own).map((c) => f.pki.certificateToPem(c)),
    created: new Date().toISOString(),
  };
}

export function identityCertDer(identity) {
  return binaryToBytes(forge().pem.decode(identity.certPem)[0].body);
}

export async function describeIdentity(identity) {
  const der = identityCertDer(identity);
  const info = parseCertificate(forge().asn1.fromDer(bytesToBinary(der)));
  info.fingerprint = bytesToHex(await digest("SHA-256", der), ":");
  info.source = identity.source;
  return info;
}

/* =============================== Signing ================================ */

// Signs `input` (a complete PDF) and returns the signed bytes. The original
// bytes are kept verbatim; everything new is appended after them.
//
// opts: { identity | signer, name, reason, location, contact, date,
//         page (0-based), rect [x1 y1 x2 y2] in PDF user space or null,
//         appearance: { imagePng, lines: [], fontBytes } }
// signer: { certDer, chainDer: [], keyAlg: "RSA" | "ECDSA",
//           sign(signedAttributesDer) -> Promise<signature bytes> }
export async function signPdf(input, opts) {
  const P = lib();
  const original = toBytes(input);
  const doc = await P.PDFDocument.load(original, { updateMetadata: false });
  if (doc.isEncrypted) throw new Error("Şifreli PDF'ler imzalanamaz.");
  const ctx = doc.context;
  // pdf-lib forgets the numbers of object streams and xref streams it has
  // unpacked, so new numbers start after the file's own /Size, never inside it.
  const prevXref = findStartXref(original);
  ctx.largestObjectNumber = Math.max(ctx.largestObjectNumber, readTrailerSize(original, prevXref) - 1);
  const baseMax = ctx.largestObjectNumber;
  const touched = new Map();
  const touch = (ref) => touched.set(ref.objectNumber + "/" + ref.generationNumber, ref);
  const catalogRef = ctx.trailerInfo.Root;

  const pages = doc.getPages();
  const page = pages[Math.max(0, Math.min(opts.page || 0, pages.length - 1))];
  const rect = opts.rect || [0, 0, 0, 0];
  const date = opts.date || new Date();

  // --- signature dictionary: written by hand, its number reserved now
  const sigRef = ctx.nextRef();

  // --- visible appearance (optional)
  let apRef = null;
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];
  if (w > 1 && h > 1 && opts.appearance) {
    apRef = await buildAppearance(doc, w, h, opts.appearance);
  }

  // --- widget + field
  const fieldName = uniqueFieldName(doc);
  const widget = ctx.obj({
    Type: "Annot", Subtype: "Widget", FT: "Sig", F: 132,
    Rect: rect, V: sigRef, T: P.PDFHexString.fromText(fieldName), P: page.ref,
  });
  if (apRef) widget.set(P.PDFName.of("AP"), ctx.obj({ N: apRef }));
  const widgetRef = ctx.register(widget);

  const annotsRaw = page.node.get(P.PDFName.of("Annots"));
  if (annotsRaw instanceof P.PDFRef) {
    ctx.lookup(annotsRaw, P.PDFArray).push(widgetRef);
    touch(annotsRaw);
  } else if (annotsRaw instanceof P.PDFArray) {
    annotsRaw.push(widgetRef);
    touch(page.ref);
  } else {
    page.node.set(P.PDFName.of("Annots"), ctx.obj([widgetRef]));
    touch(page.ref);
  }

  const catalog = doc.catalog;
  const afRaw = catalog.get(P.PDFName.of("AcroForm"));
  let acroForm;
  if (afRaw instanceof P.PDFRef) {
    acroForm = ctx.lookup(afRaw, P.PDFDict);
    touch(afRaw);
  } else if (afRaw instanceof P.PDFDict) {
    acroForm = afRaw;
    touch(catalogRef);
  } else {
    acroForm = ctx.obj({ Fields: [] });
    catalog.set(P.PDFName.of("AcroForm"), ctx.register(acroForm));
    touch(catalogRef);
  }
  const fieldsRaw = acroForm.get(P.PDFName.of("Fields"));
  if (fieldsRaw instanceof P.PDFRef) {
    ctx.lookup(fieldsRaw, P.PDFArray).push(widgetRef);
    touch(fieldsRaw);
  } else if (fieldsRaw instanceof P.PDFArray) {
    fieldsRaw.push(widgetRef);
  } else {
    acroForm.set(P.PDFName.of("Fields"), ctx.obj([widgetRef]));
  }
  acroForm.set(P.PDFName.of("SigFlags"), P.PDFNumber.of(3));

  // --- collect what gets written: new objects, then the ones we changed
  const writes = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (ref.objectNumber > baseMax && ref !== sigRef) writes.push([ref, serializeObject(ref, obj)]);
  }
  for (const ref of touched.values()) {
    if (ref.objectNumber > baseMax) continue;
    writes.push([ref, serializeObject(ref, ctx.lookup(ref))]);
  }

  const hexText = (s) => P.PDFHexString.fromText(String(s)).toString();
  const sigHead = `${sigRef.objectNumber} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached\n/ByteRange `;
  const sigContentsKey = `\n/Contents `;
  const contentsHex = "<" + "0".repeat(SIGNATURE_BYTES * 2) + ">";
  let sigTail = `\n/M (${pdfDate(date)})`;
  if (opts.name) sigTail += `\n/Name ${hexText(opts.name)}`;
  if (opts.reason) sigTail += `\n/Reason ${hexText(opts.reason)}`;
  if (opts.location) sigTail += `\n/Location ${hexText(opts.location)}`;
  if (opts.contact) sigTail += `\n/ContactInfo ${hexText(opts.contact)}`;
  sigTail += `\n/Prop_Build << /Filter << /Name /Adobe.PPKLite >> /App << /Name /Muhur >> >>\n>>\nendobj\n`;
  const sigText = sigHead + BYTE_RANGE_PLACEHOLDER + sigContentsKey + contentsHex + sigTail;
  const byteRangeAt = sigHead.length;
  const contentsAt = sigHead.length + BYTE_RANGE_PLACEHOLDER.length + sigContentsKey.length;

  // --- assemble the update
  const parts = [original];
  let pos = original.length;
  const last = original[original.length - 1];
  if (last !== 0x0a && last !== 0x0d) { parts.push(enc.encode("\n")); pos += 1; }
  const offsets = [];
  for (const [ref, bytes] of writes) {
    offsets.push([ref.objectNumber, ref.generationNumber, pos]);
    parts.push(bytes);
    pos += bytes.length;
  }
  const sigOffset = pos;
  offsets.push([sigRef.objectNumber, 0, pos]);
  parts.push(enc.encode(sigText));
  pos += sigText.length;

  const trailer = trailerFields(doc, catalogRef);
  if (usesXrefStream(original, prevXref)) {
    const xrefNum = ctx.largestObjectNumber + 1;
    offsets.push([xrefNum, 0, pos]);
    parts.push(xrefStreamSection(offsets, xrefNum + 1, trailer, prevXref, xrefNum));
  } else {
    parts.push(xrefTableSection(offsets, ctx.largestObjectNumber + 1, trailer, prevXref, pos));
  }
  const out = concatBytes(parts);

  // --- byte range, then the CMS signature over it
  const contentsStart = sigOffset + contentsAt;
  const contentsEnd = contentsStart + contentsHex.length;
  const ranges = [0, contentsStart, contentsEnd, out.length - contentsEnd];
  const rangeText = `[${ranges.join(" ")}]`.padEnd(BYTE_RANGE_PLACEHOLDER.length, " ");
  out.set(enc.encode(rangeText), sigOffset + byteRangeAt);

  const signed = concatBytes([out.subarray(0, contentsStart), out.subarray(contentsEnd)]);
  const cms = await createCms(signed, opts.signer || localSigner(opts.identity));
  if (cms.length * 2 > SIGNATURE_BYTES * 2) throw new Error("İmza verisi ayrılan alana sığmadı.");
  out.set(enc.encode(bytesToHex(cms)), contentsStart + 1);
  return out;
}

/* --------------------------------- CMS ---------------------------------- */
const OIDS = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  rsaEncryption: "1.2.840.113549.1.1.1",
};
// digest -> [digest algorithm OID, ecdsa-with-<digest> OID]. EC keys take
// the digest that matches the curve (P-384 -> SHA-384), RSA uses SHA-256.
const DIGESTS = {
  "SHA-256": ["2.16.840.1.101.3.4.2.1", "1.2.840.10045.4.3.2"],
  "SHA-384": ["2.16.840.1.101.3.4.2.2", "1.2.840.10045.4.3.3"],
  "SHA-512": ["2.16.840.1.101.3.4.2.3", "1.2.840.10045.4.3.4"],
};

function der(node) { return binaryToBytes(forge().asn1.toDer(node).getBytes()); }
function asn1Of(bytes) { return forge().asn1.fromDer(bytesToBinary(bytes)); }

// Issuer name and serial number of a certificate, as its own ASN.1 nodes.
function issuerAndSerial(certDer) {
  const A = forge().asn1;
  const tbs = asn1Of(certDer).value[0].value;
  const i = tbs[0].tagClass === A.Class.CONTEXT_SPECIFIC ? 1 : 0;
  return { serial: tbs[i], issuer: tbs[i + 2] };
}

// The signed attributes as a DER SET OF, sorted the way DER requires.
// PAdES baseline: no signing-time attribute (the time is /M), and the
// signer's certificate pinned by its SHA-256 hash (ESS signing-certificate-v2).
async function signedAttributes(contentDigest, certDer) {
  const f = forge();
  const A = f.asn1;
  const C = A.Class.UNIVERSAL, T = A.Type;
  const oid = (o) => A.create(C, T.OID, false, A.oidToDer(o).getBytes());
  const octets = (bytes) => A.create(C, T.OCTETSTRING, false, bytesToBinary(bytes));
  const attr = (type, value) => A.create(C, T.SEQUENCE, true, [oid(type), A.create(C, T.SET, true, [value])]);
  const { issuer, serial } = issuerAndSerial(certDer);
  const certHash = await digest("SHA-256", certDer);
  const essCertIdV2 = A.create(C, T.SEQUENCE, true, [
    octets(certHash), // hashAlgorithm omitted: SHA-256 is the default
    A.create(C, T.SEQUENCE, true, [
      A.create(C, T.SEQUENCE, true, [A.create(A.Class.CONTEXT_SPECIFIC, 4, true, [issuer])]),
      serial,
    ]),
  ]);
  const attrs = [
    attr(OIDS.contentType, oid(OIDS.data)),
    attr(OIDS.messageDigest, octets(contentDigest)),
    attr(OIDS.signingCertificateV2, A.create(C, T.SEQUENCE, true, [A.create(C, T.SEQUENCE, true, [essCertIdV2])])),
  ];
  const encoded = attrs.map((a) => ({ node: a, bytes: der(a) }));
  encoded.sort((x, y) => {
    for (let k = 0; k < Math.min(x.bytes.length, y.bytes.length); k++) if (x.bytes[k] !== y.bytes[k]) return x.bytes[k] - y.bytes[k];
    return x.bytes.length - y.bytes.length;
  });
  return encoded.map((e) => e.node);
}

async function createCms(signedBytes, signer) {
  const f = forge();
  const A = f.asn1;
  const C = A.Class.UNIVERSAL, T = A.Type;
  const oid = (o) => A.create(C, T.OID, false, A.oidToDer(o).getBytes());
  const nul = () => A.create(C, T.NULL, false, "");
  const int = (n) => A.create(C, T.INTEGER, false, A.integerToDer(n).getBytes());
  const hash = signer.hash || "SHA-256";
  if (!DIGESTS[hash]) throw new Error("Desteklenmeyen özet algoritması: " + hash);
  const digestAlg = () => A.create(C, T.SEQUENCE, true, [oid(DIGESTS[hash][0]), nul()]);

  const contentDigest = await digest(hash, signedBytes);
  const attrs = await signedAttributes(contentDigest, signer.certDer);
  // the signature covers the attributes encoded as a SET (tag 0x31); the
  // SignerInfo carries the same content under [0] IMPLICIT
  const toSign = der(A.create(C, T.SET, true, attrs));
  const signature = await signer.sign(toSign);
  const sigAlg = signer.keyAlg === "ECDSA"
    ? A.create(C, T.SEQUENCE, true, [oid(DIGESTS[hash][1])])
    : A.create(C, T.SEQUENCE, true, [oid(OIDS.rsaEncryption), nul()]);
  const { issuer, serial } = issuerAndSerial(signer.certDer);
  const signerInfo = A.create(C, T.SEQUENCE, true, [
    int(1),
    A.create(C, T.SEQUENCE, true, [issuer, serial]),
    digestAlg(),
    A.create(A.Class.CONTEXT_SPECIFIC, 0, true, attrs),
    sigAlg,
    A.create(C, T.OCTETSTRING, false, bytesToBinary(signature)),
  ]);
  const certs = [signer.certDer].concat(signer.chainDer || []).map((d) => asn1Of(d));
  const signedData = A.create(C, T.SEQUENCE, true, [
    int(1),
    A.create(C, T.SET, true, [digestAlg()]),
    A.create(C, T.SEQUENCE, true, [oid(OIDS.data)]),
    A.create(A.Class.CONTEXT_SPECIFIC, 0, true, certs),
    A.create(C, T.SET, true, [signerInfo]),
  ]);
  return der(A.create(C, T.SEQUENCE, true, [
    oid(OIDS.signedData),
    A.create(A.Class.CONTEXT_SPECIFIC, 0, true, [signedData]),
  ]));
}

// The signer for an identity kept in this browser (self-signed or .p12).
export function localSigner(identity) {
  const f = forge();
  const key = f.pki.privateKeyFromPem(identity.keyPem);
  const pemToDer = (pem) => binaryToBytes(f.pem.decode(pem)[0].body);
  return {
    certDer: pemToDer(identity.certPem),
    chainDer: (identity.chainPem || []).map(pemToDer),
    keyAlg: "RSA",
    async sign(data) {
      const md = f.md.sha256.create();
      md.update(bytesToBinary(data));
      return binaryToBytes(key.sign(md));
    },
  };
}

async function buildAppearance(doc, w, h, appearance) {
  const P = lib();
  const ctx = doc.context;
  const ops = [];
  const resources = {};
  const lines = (appearance.lines || []).filter(Boolean);
  const hasText = lines.length && appearance.fontBytes;
  const imageBox = hasText ? { x: 0, y: 0, w: w * 0.48, h } : { x: 0, y: 0, w, h };

  if (appearance.imagePng) {
    const img = await doc.embedPng(appearance.imagePng);
    await img.embed();
    const pad = Math.min(w, h) * 0.06;
    const bw = imageBox.w - pad * 2;
    const bh = imageBox.h - pad * 2;
    const s = Math.min(bw / img.width, bh / img.height);
    const iw = img.width * s;
    const ih = img.height * s;
    resources.XObject = { Im1: img.ref };
    ops.push(P.pushGraphicsState(),
      P.concatTransformationMatrix(iw, 0, 0, ih, imageBox.x + pad + (bw - iw) / 2, imageBox.y + pad + (bh - ih) / 2),
      P.drawObject("Im1"), P.popGraphicsState());
  }

  if (hasText) {
    doc.registerFontkit(globalThis.fontkit);
    const font = await doc.embedFont(appearance.fontBytes, { subset: true });
    const tx = appearance.imagePng ? w * 0.5 : Math.min(w, h) * 0.06;
    const avail = w - tx - Math.min(w, h) * 0.05;
    let size = Math.min(h / (lines.length * 1.3 + 0.6), 11);
    for (const line of lines) {
      const lw = font.widthOfTextAtSize(line, size);
      if (lw > avail) size = Math.min(size, size * avail / lw);
    }
    size = Math.max(size, 4);
    const lead = size * 1.3;
    let y = h / 2 + (lines.length * lead) / 2 - size;
    ops.push(P.beginText(), P.setFillingRgbColor(0.12, 0.13, 0.16));
    lines.forEach((line, i) => {
      ops.push(P.setFontAndSize("F1", i === 0 ? size * 1.05 : size), P.setTextMatrix(1, 0, 0, 1, tx, y), P.showText(font.encodeText(line)));
      y -= lead;
    });
    ops.push(P.endText());
    await font.embed();
    resources.Font = { F1: font.ref };
  }

  const stream = ctx.formXObject(ops, { BBox: [0, 0, w, h], Resources: resources });
  return ctx.register(stream);
}

function uniqueFieldName(doc) {
  const P = lib();
  const taken = new Set();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof P.PDFDict) {
      const t = obj.get(P.PDFName.of("T"));
      if (t && t.decodeText) taken.add(t.decodeText());
    }
  }
  let n = 1;
  while (taken.has("Imza" + n)) n++;
  return "Imza" + n;
}

function serializeObject(ref, obj) {
  const head = enc.encode(`${ref.objectNumber} ${ref.generationNumber} obj\n`);
  const body = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(body, 0);
  return concatBytes([head, body, enc.encode("\nendobj\n")]);
}

function findStartXref(bytes) {
  const at = lastIndexOfAscii(bytes, "startxref");
  if (at < 0) throw new Error("PDF yapısı okunamadı (startxref yok).");
  const tail = new TextDecoder("latin1").decode(bytes.subarray(at + 9, at + 40));
  const m = /\s*(\d+)/.exec(tail);
  if (!m) throw new Error("PDF yapısı okunamadı (startxref).");
  return Number(m[1]);
}

// /Size of the newest trailer (classic) or xref stream dictionary.
function readTrailerSize(bytes, offset) {
  const latin1 = (a, b) => new TextDecoder("latin1").decode(bytes.subarray(a, Math.min(bytes.length, b)));
  let from = offset;
  if (!usesXrefStream(bytes, offset)) {
    const t = indexOfAscii(bytes, "trailer", offset);
    if (t < 0) return 0;
    from = t;
  }
  const m = /\/Size\s+(\d+)/.exec(latin1(from, from + 4096));
  return m ? Number(m[1]) : 0;
}

function usesXrefStream(bytes, offset) {
  let i = offset;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++;
  return !(bytes[i] === 0x78 && bytes[i + 1] === 0x72 && bytes[i + 2] === 0x65 && bytes[i + 3] === 0x66); // "xref"
}

function trailerFields(doc, catalogRef) {
  const P = lib();
  const info = doc.context.trailerInfo;
  let id = info.ID;
  let idText;
  if (id instanceof P.PDFArray && id.size() >= 1) {
    const first = id.get(0).toString();
    idText = `[${first} <${bytesToHex(crypto.getRandomValues(new Uint8Array(16)))}>]`;
  } else {
    const fresh = `<${bytesToHex(crypto.getRandomValues(new Uint8Array(16)))}>`;
    idText = `[${fresh} ${fresh}]`;
  }
  let text = `/Root ${catalogRef.toString()}`;
  if (info.Info instanceof P.PDFRef) text += ` /Info ${info.Info.toString()}`;
  return text + ` /ID ${idText}`;
}

function groupEntries(offsets) {
  const sorted = offsets.slice().sort((a, b) => a[0] - b[0]);
  const groups = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && g.start + g.rows.length === e[0]) g.rows.push(e);
    else groups.push({ start: e[0], rows: [e] });
  }
  return groups;
}

function xrefTableSection(offsets, size, trailer, prev, at) {
  let s = "xref\n";
  for (const g of groupEntries(offsets)) {
    s += `${g.start} ${g.rows.length}\n`;
    for (const [, gen, off] of g.rows) s += `${String(off).padStart(10, "0")} ${String(gen).padStart(5, "0")} n \n`;
  }
  s += `trailer\n<< /Size ${size} ${trailer} /Prev ${prev} >>\nstartxref\n${at}\n%%EOF\n`;
  return enc.encode(s);
}

function xrefStreamSection(offsets, size, trailer, prev, xrefNum) {
  const groups = groupEntries(offsets);
  const rows = [];
  for (const g of groups) for (const [, gen, off] of g.rows) {
    rows.push(1, (off >>> 24) & 255, (off >>> 16) & 255, (off >>> 8) & 255, off & 255, (gen >>> 8) & 255, gen & 255);
  }
  const data = new Uint8Array(rows);
  const index = groups.map((g) => `${g.start} ${g.rows.length}`).join(" ");
  const xrefAt = offsets.find((o) => o[0] === xrefNum)[2];
  const head = enc.encode(`${xrefNum} 0 obj\n<< /Type /XRef /Size ${size} /Index [${index}] /W [1 4 2] ${trailer} /Prev ${prev} /Length ${data.length} >>\nstream\n`);
  const tail = enc.encode(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`);
  return concatBytes([head, data, tail]);
}

/* ============================= Verification ============================= */

const OID = {
  signedData: "1.2.840.113549.1.7.2",
  tstInfo: "1.2.840.113549.1.9.16.1.4",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificate: "1.2.840.113549.1.9.16.2.12",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  timeStampToken: "1.2.840.113549.1.9.16.2.14",
  rsaEncryption: "1.2.840.113549.1.1.1",
  rsaPss: "1.2.840.113549.1.1.10",
  ecPublicKey: "1.2.840.10045.2.1",
  qcStatements: "1.3.6.1.5.5.7.1.3",
  subjectKeyIdentifier: "2.5.29.14",
  keyUsage: "2.5.29.15",
  basicConstraints: "2.5.29.19",
  extKeyUsage: "2.5.29.37",
  timeStamping: "1.3.6.1.5.5.7.3.8",
};
const HASH_BY_OID = {
  "1.3.14.3.2.26": "SHA-1",
  "2.16.840.1.101.3.4.2.1": "SHA-256",
  "2.16.840.1.101.3.4.2.2": "SHA-384",
  "2.16.840.1.101.3.4.2.3": "SHA-512",
  "1.2.840.113549.1.1.5": "SHA-1",
  "1.2.840.113549.1.1.11": "SHA-256",
  "1.2.840.113549.1.1.12": "SHA-384",
  "1.2.840.113549.1.1.13": "SHA-512",
  "1.2.840.10045.4.1": "SHA-1",
  "1.2.840.10045.4.3.2": "SHA-256",
  "1.2.840.10045.4.3.3": "SHA-384",
  "1.2.840.10045.4.3.4": "SHA-512",
};
// Signature algorithms WebCrypto can check, each with the digest it names
// (null: plain rsaEncryption / ecPublicKey, which leave it to the
// SignerInfo's digestAlgorithm). RSA-PSS carries its own parameters.
const RSA_PKCS1_SIG = new Map([
  ["1.2.840.113549.1.1.1", null],
  ["1.2.840.113549.1.1.5", "SHA-1"],
  ["1.2.840.113549.1.1.11", "SHA-256"],
  ["1.2.840.113549.1.1.12", "SHA-384"],
  ["1.2.840.113549.1.1.13", "SHA-512"],
]);
const ECDSA_SIG = new Map([
  ["1.2.840.10045.2.1", null],
  ["1.2.840.10045.4.1", "SHA-1"],
  ["1.2.840.10045.4.3.2", "SHA-256"],
  ["1.2.840.10045.4.3.3", "SHA-384"],
  ["1.2.840.10045.4.3.4", "SHA-512"],
]);
const CURVES = { "1.2.840.10045.3.1.7": ["P-256", 32], "1.3.132.0.34": ["P-384", 48], "1.3.132.0.35": ["P-521", 66] };
const NAME_OIDS = {
  "2.5.4.3": "CN", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C", "2.5.4.7": "L",
  "2.5.4.5": "serialNumber", "1.2.840.113549.1.9.1": "email", "2.5.4.42": "givenName", "2.5.4.4": "surname",
};
const MAX_CHAIN = 6;                           // issuers above the signer
const MAX_CHAIN_CHECKS = 64;                   // signature checks per path search

export function hasSignatures(bytes) {
  return indexOfAscii(toBytes(bytes), "/ByteRange") >= 0;
}

// Every signature in the file, oldest first. Besides the fields the panel
// has always read, a result can carry:
//   documentTimestamp  true for a /DocTimeStamp (ETSI.RFC3161): a TSA's
//                      token over the covered bytes, not a person's signature
//   imprintMatch       document timestamps: the token's messageImprint is the
//                      hash of the covered bytes
//   timestamp          an unsigned timeStampToken on a signature, checked:
//                      { trusted, imprintMatch, signatureValid, genTime, tsa,
//                        chain, error }; hasTimestamp only says one is there
//   signerMissing      the CMS does not hold the certificate its SignerInfo
//                      names, so nothing could be verified
//   certExpiredNow     the signer's certificate is outside its validity today
//   verifyNote         why signatureValid is null
// integrity compares the covered bytes with a digest that whoever built the
// CMS chose, so it vouches for the content only when signatureValid is true.
// integrity null means the CMS commits to something this code cannot relate
// to the covered bytes: unverifiable, never "tampered".
export async function verifyPdf(input, knownFingerprints) {
  const P = lib();
  const bytes = toBytes(input);
  if (!hasSignatures(bytes)) return [];
  const doc = await P.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const ctx = doc.context;
  const pageRefs = doc.getPages().map((p) => p.ref);

  // signature dictionaries and the widgets that point at them
  const sigs = [];
  const widgets = new Map();
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof P.PDFDict)) continue;
    if (obj.get(P.PDFName.of("ByteRange")) && obj.get(P.PDFName.of("Contents"))) sigs.push([ref, obj]);
    const v = obj.get(P.PDFName.of("V"));
    if (v instanceof P.PDFRef && obj.get(P.PDFName.of("FT")) === P.PDFName.of("Sig")) widgets.set(v.toString(), [ref, obj]);
    if (v instanceof P.PDFDict && v.get(P.PDFName.of("ByteRange"))) sigs.push([null, v, obj]);
  }

  const results = [];
  for (const [ref, newest, inlineWidget] of sigs) {
    const r = { fieldName: null, page: null, rect: null };
    try {
      const w = inlineWidget ? [null, inlineWidget] : widgets.get(ref ? ref.toString() : "");
      if (w) {
        const wd = w[1];
        const t = wd.get(P.PDFName.of("T"));
        r.fieldName = t && t.decodeText ? t.decodeText() : null;
        const pRef = wd.get(P.PDFName.of("P"));
        const idx = pRef ? pageRefs.findIndex((pr) => pr.toString() === pRef.toString()) : -1;
        r.page = idx >= 0 ? idx : findWidgetPage(doc, w[0]);
        const rect = wd.lookup(P.PDFName.of("Rect"));
        if (rect instanceof P.PDFArray) r.rect = rect.asArray().map((n) => n.asNumber ? n.asNumber() : 0);
      }

      // The CMS comes from the gap itself and the dictionary from the signed
      // bytes around it, never from pdf-lib's copy of the object: that is
      // the newest definition of its number, which unsigned bytes can supply.
      const br = newest.lookup(P.PDFName.of("ByteRange"), P.PDFArray).asArray().map((n) => n.asNumber());
      const cms = signedGap(bytes, br);
      const dict = signedDictionary(bytes, br, ref, newest, ctx);
      const text = (key) => {
        const v = dict.lookup(P.PDFName.of(key));
        return v && v.decodeText ? v.decodeText() : null;
      };
      r.reason = text("Reason");
      r.location = text("Location");
      r.contact = text("ContactInfo");
      r.nameEntry = text("Name");
      const m = dict.lookup(P.PDFName.of("M"));
      r.dictTime = m && m.decodeText ? parsePdfDate(m.decodeText()) : null;
      const subFilter = dict.lookup(P.PDFName.of("SubFilter"));
      r.subFilter = subFilter ? subFilter.asString().replace(/^\//, "") : "";

      const signed = concatBytes([bytes.subarray(0, br[1]), bytes.subarray(br[2], br[2] + br[3])]);
      const coveredEnd = br[2] + br[3];
      r.revisionEnd = coveredEnd;
      r.coversWholeDocument = isOnlyWhitespace(bytes, coveredEnd);
      Object.assign(r, await verifyCms(cms, signed, { subFilter: r.subFilter, claimedTime: r.dictTime }));
      if (r.certificate) {
        r.known = !!(knownFingerprints && knownFingerprints.includes(r.certificate.fingerprint));
      }
    } catch (err) {
      r.error = String(err && err.message || err);
      r.integrity = false;
      r.signatureValid = false;
    }
    r.signingTime = r.cmsTime || r.dictTime || null;
    checkValidity(r);
    results.push(r);
  }
  results.sort((a, b) => (a.revisionEnd || 0) - (b.revisionEnd || 0));
  results.forEach((r, i) => { r.order = i + 1; r.laterChanges = !r.coversWholeDocument; });
  return results;
}

// Certificate validity at the claimed signing time (CMS signing-time, a
// document timestamp's genTime or the dictionary's /M — all inside what was
// signed), and separately today. A certificate that has expired since, with
// no timestamp to prove when the signature was made, is a different
// statement from one that was already invalid when it signed.
function checkValidity(r) {
  const c = r.certificate;
  if (!c || !c.notBefore || !c.notAfter) return;
  if (r.signingTime) r.certValidAtSigning = r.signingTime >= c.notBefore && r.signingTime <= c.notAfter;
  const now = new Date();
  r.certExpiredNow = now < c.notBefore || now > c.notAfter;
}

function isPdfWhitespace(b) {
  return b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09 || b === 0x0c || b === 0x00;
}

function isOnlyWhitespace(bytes, from) {
  for (let i = from; i < bytes.length; i++) if (!isPdfWhitespace(bytes[i])) return false;
  return true;
}

function hexValue(b) {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x37;
  if (b >= 0x61 && b <= 0x66) return b - 0x57;
  return -1;
}

function badStructure(why) {
  throw new Error("İmza yapısı geçersiz: " + why + ".");
}

// The ByteRange has to cover the revision from its first byte, leaving out
// one gap, and that gap has to be exactly the /Contents hex string: '<',
// hex digits (whitespace allowed), '>'. Anything else in it is PDF syntax
// that every parser reads and no signature covers — signature wrapping,
// where a forged page and a second copy of the signature dictionary are
// slipped into the gap and the file still hashes to the signed digest.
// Returns the CMS bytes held in the gap.
function signedGap(bytes, br) {
  if (br.length !== 4 || !br.every((n) => Number.isSafeInteger(n) && n >= 0)) badStructure("ByteRange");
  const [a, b, c, d] = br;
  if (a !== 0 || b < 1 || c < b + 2 || c + d > bytes.length) badStructure("ByteRange");
  if (bytes[b] !== 0x3c || bytes[c - 1] !== 0x3e) badStructure("/Contents sınırları");
  const out = new Uint8Array((c - b - 1) >> 1);
  let n = 0, hi = -1;
  for (let i = b + 1; i < c - 1; i++) {
    const v = hexValue(bytes[i]);
    if (v < 0) {
      if (isPdfWhitespace(bytes[i])) continue;
      badStructure("/Contents dışında veri");
    }
    if (hi < 0) hi = v;
    else { out[n++] = (hi << 4) | v; hi = -1; }
  }
  if (hi >= 0) out[n++] = hi << 4;             // odd digit count: a final 0 is implied
  return out.subarray(0, n);
}

// The signature dictionary as its signer wrote it: the object around the
// gap, parsed from the signed bytes, which must carry this same /ByteRange.
// Its /M, /Reason and /SubFilter are then the signed ones even when a later
// update has redefined the object number.
function signedDictionary(bytes, br, ref, newest, ctx) {
  const P = lib();
  const [, b, c, d] = br;
  if (!ref) {
    // a direct dictionary in the field's /V (ISO 32000 asks for an indirect
    // one) has no object header to parse from: its /ByteRange at least has
    // to be written in the signed bytes next to the gap
    const near = bytesToBinary(bytes.subarray(Math.max(0, b - 4096), b)) + "\u0000" +
                 bytesToBinary(bytes.subarray(c, Math.min(c + d, c + 4096)));
    const written = [...near.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
    if (!written.some((m) => m.slice(1, 5).map(Number).join() === br.join())) badStructure("imzalı ByteRange eşleşmiyor");
    return newest;
  }
  const from = Math.max(0, b - 65536);
  const header = new RegExp(`(?:^|[^0-9])${ref.objectNumber}\\s+${ref.generationNumber}\\s+obj`, "g");
  let at = -1;
  for (const m of bytesToBinary(bytes.subarray(from, b)).matchAll(header)) at = from + m.index + m[0].length;
  if (at < 0) badStructure("imza sözlüğü bulunamadı");
  const parser = P.PDFObjectParser.forBytes(bytes.subarray(at, c + d), ctx);
  const dict = parser.parseObject();
  if (!(dict instanceof P.PDFDict) || at + parser.bytes.offset() <= c) badStructure("imza sözlüğü");
  const written = dict.get(P.PDFName.of("ByteRange"));
  const nums = written instanceof P.PDFArray ? written.asArray().map((x) => (x instanceof P.PDFNumber ? x.asNumber() : NaN)) : [];
  if (nums.join() !== br.join()) badStructure("imzalı ByteRange eşleşmiyor");
  return dict;
}

function findWidgetPage(doc, widgetRef) {
  const P = lib();
  if (!widgetRef) return null;
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.lookup(P.PDFName.of("Annots"));
    if (annots instanceof P.PDFArray && annots.asArray().some((a) => a.toString() === widgetRef.toString())) return i;
  }
  return null;
}

// One CMS SignedData against the bytes it covers.
// opts: { subFilter, claimedTime: the dictionary's /M (for the certificate
//         path when the CMS has no time of its own),
//         nested: a timestamp token inside another signature, whose own
//         unsigned attributes are not followed }
async function verifyCms(cmsBytes, signedBytes, opts = {}) {
  const f = forge();
  const A = f.asn1;
  const subFilter = opts.subFilter || "";
  const out = { integrity: false, signatureValid: null };
  if (/x509\.rsa_sha1/.test(subFilter)) {
    // a bare PKCS#1 value with the certificate in /Cert: not CMS, and not
    // something this code reads. Unverifiable, which is not "tampered".
    out.integrity = null;
    out.verifyNote = "adbe.x509.rsa_sha1 biçimi doğrulanamıyor.";
    return out;
  }
  const root = A.fromDer(bytesToBinary(cmsBytes), { parseAllBytes: false, strict: false });
  if (A.derToOid(root.value[0].value) !== OID.signedData) throw new Error("İmza verisi CMS SignedData değil.");
  const sd = root.value[1].value[0].value;
  let certs = [];
  for (let i = 3; i < sd.length && sd[i].tagClass === A.Class.CONTEXT_SPECIFIC; i++) {
    if (sd[i].type === 0) certs = sd[i].value;
  }
  const signerInfos = sd[sd.length - 1].value;
  if (!signerInfos.length) throw new Error("İmzalayan bilgisi yok.");
  const si = signerInfos[0].value;
  let k = 1;                                   // after the version
  const sid = si[k++];
  const digestOid = A.derToOid(si[k++].value[0].value);
  let signedAttrs = null;
  if (si[k].tagClass === A.Class.CONTEXT_SPECIFIC && si[k].type === 0) signedAttrs = si[k++];
  const sigAlgNode = si[k++];
  const signature = binaryToBytes(si[k++].value);
  const unsigned = si[k] && si[k].tagClass === A.Class.CONTEXT_SPECIFIC && si[k].type === 1 ? si[k].value : [];

  const hash = HASH_BY_OID[digestOid];
  if (!hash) throw new Error("Bilinmeyen özet algoritması: " + digestOid);
  out.digestAlgorithm = hash;

  const content = await encapsulatedContent(sd[2], signedBytes, subFilter);
  if (content.tstInfo) {
    out.imprintMatch = content.rangeOk;
    out.cmsTime = content.tstInfo.genTime;
    if (!opts.nested) out.documentTimestamp = true;
  }
  const actual = await digest(hash, content.bytes);
  // what the CMS says about the covered bytes, once its digest is known to hold
  const committed = () => (content.rangeOk === false ? false : content.rangeOk === null ? null : true);

  // certificates, and the one the SignerInfo names
  const parsed = [];
  for (const c of certs) {
    try { parsed.push({ asn1: c, info: parseCertificate(c) }); } catch (e) { /* skip unreadable certs */ }
  }
  const signer = findSigner(sid, parsed);
  if (signer) {
    signer.info.fingerprint = bytesToHex(await digest("SHA-256", der(signer.asn1)), ":");
    out.certificate = signer.info;
  } else {
    out.signerMissing = true;
    out.verifyNote = "İmzalayan sertifika imza verisinde bulunamadı.";
  }
  out.chainLength = parsed.length;

  // signed attributes: messageDigest against what we hashed, time, ESS
  let signedContent = content.bytes;
  if (signedAttrs) {
    let digestOk = false;
    for (const attr of signedAttrs.value) {
      const oid = A.derToOid(attr.value[0].value);
      const val = attr.value[1].value[0];
      if (oid === OID.messageDigest) digestOk = bytesToHex(binaryToBytes(val.value)) === bytesToHex(actual);
      if (oid === OID.signingTime && !content.tstInfo) {
        out.cmsTime = val.type === A.Type.UTCTIME ? A.utcTimeToDate(val.value) : A.generalizedTimeToDate(val.value);
      }
      if ((oid === OID.signingCertificateV2 || oid === OID.signingCertificate) && signer) {
        // ESS: the signed attributes pin the signer's certificate by hash
        try {
          const first = val.value[0].value[0].value;
          const v2 = oid === OID.signingCertificateV2;
          const hasAlg = v2 && first[0].type === A.Type.SEQUENCE;
          const essHash = v2 ? (hasAlg ? HASH_BY_OID[A.derToOid(first[0].value[0].value)] : "SHA-256") : "SHA-1";
          const pinned = binaryToBytes(first[hasAlg ? 1 : 0].value);
          const own = await digest(essHash, der(signer.asn1));
          out.essCertMatch = bytesToHex(pinned) === bytesToHex(own);
        } catch (e) { out.essCertMatch = false; }
      }
    }
    out.integrity = digestOk ? committed() : false;
    const set = A.create(A.Class.UNIVERSAL, A.Type.SET, true, signedAttrs.value);
    signedContent = binaryToBytes(A.toDer(set).getBytes());
  } else {
    out.integrity = null;                      // known once the signature verifies
  }

  if (signer) {
    // the signature over the signed attributes (or the content), with the
    // signer's public key
    try {
      out.signatureValid = await webcryptoVerify(signer.info, sigAlgNode, hash, signature, signedContent);
      if (!signedAttrs && out.signatureValid) out.integrity = committed();
    } catch (err) {
      out.signatureValid = null;
      out.verifyNote = String(err && err.message || err);
    }
    // the certificate path, at the time the signature claims; then the
    // signer's own certificate must be one meant for this kind of signing
    try {
      out.chain = await buildChain(signer, parsed, out.cmsTime || opts.claimedTime || null);
      const why = signerProblem(signer.info, !!content.tstInfo);
      if (why && out.chain.trusted) out.chain = { trusted: false, reason: why, path: out.chain.path };
    } catch (e) { out.chain = { trusted: false, reason: "error", path: [] }; }
  }

  if (!opts.nested) {
    const token = unsigned.find((attr) => A.derToOid(attr.value[0].value) === OID.timeStampToken);
    out.hasTimestamp = !!token;
    if (token) out.timestamp = await verifyTimestampToken(token, signature);
  }
  return out;
}

// What the CMS commits to. A detached CMS (PAdES, adbe.pkcs7.detached) signs
// the covered bytes themselves. Otherwise the content travels inside the CMS
// and names the covered bytes in its own way: a TSTInfo (document timestamp,
// or a timestamp token) by its messageImprint, adbe.pkcs7.sha1 as their
// SHA-1. rangeOk is true or false, or null for content that cannot be
// related to the covered bytes.
async function encapsulatedContent(eci, covered, subFilter) {
  const A = forge().asn1;
  const type = A.derToOid(eci.value[0].value);
  const wrapper = eci.value[1];
  if (!wrapper) return { bytes: covered, rangeOk: true };
  const bytes = binaryToBytes(octetString(wrapper.value[0]));
  if (type === OID.tstInfo) {
    const tst = A.fromDer(bytesToBinary(bytes)).value;
    const imprint = tst[2].value;
    const imprintHash = HASH_BY_OID[A.derToOid(imprint[0].value[0].value)];
    if (!imprintHash) throw new Error("Zaman damgasında bilinmeyen özet algoritması.");
    const rangeOk = bytesToHex(binaryToBytes(imprint[1].value)) === bytesToHex(await digest(imprintHash, covered));
    return { bytes, rangeOk, tstInfo: { genTime: A.generalizedTimeToDate(tst[4].value) } };
  }
  if (/adbe\.pkcs7\.sha1/.test(subFilter)) {
    return { bytes, rangeOk: bytesToHex(bytes) === bytesToHex(await digest("SHA-1", covered)) };
  }
  return { bytes, rangeOk: null };
}

// An OCTET STRING's content, also in BER's constructed (chunked) form.
function octetString(node) {
  return Array.isArray(node.value) ? node.value.map(octetString).join("") : node.value;
}

// The certificate the SignerInfo names: by issuer and serial (a unique
// serial is enough when only the name's string encoding differs), or by
// subjectKeyIdentifier. No match means no signer — guessing the first
// certificate would check the signature against, say, a CA's key.
function findSigner(sid, parsed) {
  const A = forge().asn1;
  if (sid.tagClass === A.Class.UNIVERSAL && sid.type === A.Type.SEQUENCE) {
    const issuer = bytesToHex(der(sid.value[0]));
    const serial = bytesToHex(binaryToBytes(sid.value[1].value));
    const bySerial = parsed.filter((p) => p.info.serialHex === serial);
    return bySerial.find((p) => p.info.issuerDerHex === issuer) || (bySerial.length === 1 ? bySerial[0] : null);
  }
  if (sid.tagClass === A.Class.CONTEXT_SPECIFIC && sid.type === 0) {
    const ski = bytesToHex(binaryToBytes(sid.value));
    return parsed.find((p) => p.info.skiHex === ski) || null;
  }
  return null;
}

// A path to a pinned root does not make any certificate a signer: a CA's
// certificate is not one, keyUsage has to allow signatures, and a
// timestamp's signer has to be a TSA (extendedKeyUsage timeStamping).
function signerProblem(info, timestamp) {
  if (info.ca === true) return "ca-signer";
  if (info.keyUsage && !info.keyUsage.digitalSignature && !info.keyUsage.nonRepudiation) return "key-usage";
  if (timestamp && !(info.extKeyUsage || []).includes(OID.timeStamping)) return "not-tsa";
  return null;
}

// An RFC 3161 token in a signature's unsigned attributes. Those sit outside
// the signature (and the whole CMS outside the ByteRange), so anyone can add
// one: it counts only when its imprint is the hash of this signature value,
// its own CMS verifies and its TSA chains to a pinned root.
async function verifyTimestampToken(attr, signatureValue) {
  try {
    const tv = await verifyCms(der(attr.value[1].value[0]), signatureValue, { nested: true });
    if (tv.imprintMatch === undefined) throw new Error("Zaman damgası TSTInfo içermiyor.");
    return {
      trusted: tv.integrity === true && tv.signatureValid === true && !!(tv.chain && tv.chain.trusted),
      imprintMatch: tv.imprintMatch,
      signatureValid: tv.signatureValid,
      genTime: tv.cmsTime || null,
      tsa: tv.certificate ? tv.certificate.name : null,
      chain: tv.chain || null,
    };
  } catch (err) {
    return { trusted: false, imprintMatch: null, signatureValid: null, error: String(err && err.message || err) };
  }
}

/* ------------------------------ Chain building ---------------------------- */
// Path from the signer's certificate up to a pinned anchor (trust.js), each
// link checked with WebCrypto, each issuer checked as an issuer: a CA by
// basicConstraints, keyCertSign when keyUsage is present, within its
// pathLenConstraint, and (unless pinned) valid at the signing time.
// Certificates are matched to anchors by their DER, so a chain that carries
// its own copy of a pinned root still ends at that root. Revocation
// (CRL/OCSP) is out of reach for a static page and is not checked.
//
// chain: { trusted, anchor?, path: issuer names, reason? } where reason is
// "untrusted-root" (ends at a root Mühür does not pin), "incomplete" (no
// issuer found), "not-ca" (the issuer is not allowed to issue
// certificates), "path-length", "expired" (an issuing CA was outside its
// validity), "too-long", "error"; and for a signer, "ca-signer",
// "key-usage" and "not-tsa" (see signerProblem).
let anchorPool = null;
async function anchors() {
  if (!anchorPool) {
    const A = forge().asn1;
    anchorPool = (async () => {
      const out = [];
      for (const a of ANCHORS) {
        const raw = binaryToBytes(atob(a.der));
        if (bytesToHex(await digest("SHA-384", raw)).toLowerCase() !== a.sha384) continue; // pin
        const asn1 = A.fromDer(bytesToBinary(raw));
        out.push({ asn1, info: parseCertificate(asn1), der: raw, derHex: bytesToHex(der(asn1)), root: a.root, name: a.name, anchor: true });
      }
      return out;
    })();
  }
  return anchorPool;
}

function certParts(certAsn1) {
  const A = forge().asn1;
  const tbs = certAsn1.value[0];
  const i = tbs.value[0].tagClass === A.Class.CONTEXT_SPECIFIC ? 1 : 0;
  const bits = certAsn1.value[2];
  const raw = bits.bitStringContents !== undefined ? bits.bitStringContents : bits.value;
  return {
    tbs: der(tbs),
    issuer: bytesToHex(der(tbs.value[i + 2])),
    subject: bytesToHex(der(tbs.value[i + 4])),
    sigAlgNode: certAsn1.value[1],
    sigAlg: A.derToOid(certAsn1.value[1].value[0].value),
    signature: binaryToBytes(raw).subarray(1),
  };
}

const partsOf = (entry) => entry.parts || (entry.parts = certParts(entry.asn1));

async function signedBy(parts, issuerInfo) {
  try {
    const hash = parts.sigAlg === OID.rsaPss ? pssParams(parts.sigAlgNode).hash : HASH_BY_OID[parts.sigAlg];
    if (!hash) return false;
    return await webcryptoVerify(issuerInfo, parts.sigAlgNode, hash, parts.signature, parts.tbs);
  } catch (e) { return false; }
}

// Why `cand` may not issue the certificate below it; `below` counts the CA
// certificates between it and the signer.
function issuerProblem(cand, below, when) {
  const c = cand.info;
  if (c.ca !== true || (c.keyUsage && !c.keyUsage.keyCertSign)) return "not-ca";
  if (c.pathLen != null && below > c.pathLen) return "path-length";
  if (!cand.anchor && (when < c.notBefore || when > c.notAfter)) return "expired";
  return null;
}

async function buildChain(signer, parsed, at) {
  const when = at instanceof Date && !isNaN(at) ? at : new Date();
  const pinned = await anchors();
  const byDer = new Map(pinned.map((a) => [a.derHex, a]));
  // anchors first; a certificate from the CMS that is byte-identical to one
  // is the anchor
  const pool = pinned.slice();
  for (const p of parsed) {
    const derHex = bytesToHex(der(p.asn1));
    if (!byDer.has(derHex) && !pool.some((e) => e.derHex === derHex)) pool.push({ asn1: p.asn1, info: p.info, derHex });
  }
  const start = byDer.get(bytesToHex(der(signer.asn1))) || { asn1: signer.asn1, info: signer.info };

  // Depth-first, so a refused or dead-end issuer does not hide another one.
  // Every step costs a signature check, and the certificates come from the
  // signer, so the number of checks is capped: a CMS stuffed with CA
  // certificates of the same names must not stall the page.
  const RANK = ["incomplete", "too-long", "expired", "path-length", "not-ca", "untrusted-root"];
  let failure = "incomplete";
  let checks = 0;
  const fail = (why) => { if (RANK.indexOf(why) > RANK.indexOf(failure)) failure = why; return null; };
  const walk = async (cur, path, below, seen) => {
    const parts = partsOf(cur);
    if (parts.issuer === parts.subject) {
      return cur.anchor && cur.root ? { trusted: true, anchor: cur.name, path } : fail("untrusted-root");
    }
    if (path.length >= MAX_CHAIN) return fail("too-long");
    for (const cand of pool) {
      if (seen.has(cand) || partsOf(cand).subject !== parts.issuer) continue;
      if (++checks > MAX_CHAIN_CHECKS) return fail("too-long");
      if (!(await signedBy(parts, cand.info))) continue;
      const why = issuerProblem(cand, below, when);
      if (why) { fail(why); continue; }
      const next = path.concat(cand.info.name);
      if (cand.anchor && cand.root) return { trusted: true, anchor: cand.name, path: next };
      const found = await walk(cand, next, below + 1, new Set(seen).add(cand));
      if (found) return found;
    }
    return null;
  };
  return (await walk(start, [], 0, new Set([start]))) || { trusted: false, reason: failure, path: [] };
}

// Public: path for any certificate (DER), with optional extra CA
// certificates, checked at `at` (default: now).
export async function certificateChain(certDer, extraDers, at) {
  const A = forge().asn1;
  const toEntry = (d) => { const asn1 = A.fromDer(bytesToBinary(d)); return { asn1, info: parseCertificate(asn1) }; };
  const leaf = toEntry(certDer);
  return buildChain(leaf, (extraDers || []).map(toEntry), at);
}

// One signature check with WebCrypto, dispatched on the signature algorithm
// and not only on the key: RSA PKCS#1 v1.5, RSA-PSS and ECDSA. A signature
// value that does not decode, or an algorithm of the other key family, is a
// failed signature (false). A key, curve or parameter set WebCrypto cannot
// handle throws, which callers report as "could not verify" (null).
async function webcryptoVerify(key, sigAlgNode, hash, signature, data) {
  const A = forge().asn1;
  const alg = A.derToOid(sigAlgNode.value[0].value);
  const keyFamily = key.keyAlg === OID.rsaEncryption || key.keyAlg === OID.rsaPss ? "rsa" : key.keyAlg === OID.ecPublicKey ? "ec" : null;
  const algFamily = alg.startsWith("1.2.840.113549.1.1.") ? "rsa" : alg.startsWith("1.2.840.10045.") ? "ec" : null;
  if (!keyFamily) throw new Error("Bu anahtar türü tarayıcıda doğrulanamıyor.");
  if (algFamily && algFamily !== keyFamily) return false;
  if (keyFamily === "rsa" && alg === OID.rsaPss) {
    const p = pssParams(sigAlgNode);
    // WebCrypto ties MGF1's hash to the message hash
    if (!p.hash || p.mgfHash !== p.hash) throw new Error("Bu RSA-PSS parametreleri tarayıcıda doğrulanamıyor.");
    const k = await crypto.subtle.importKey("spki", rsaSpki(key), { name: "RSA-PSS", hash: p.hash }, false, ["verify"]);
    return crypto.subtle.verify({ name: "RSA-PSS", saltLength: p.salt }, k, signature, data);
  }
  if (keyFamily === "rsa" && RSA_PKCS1_SIG.has(alg)) {
    const k = await crypto.subtle.importKey("spki", rsaSpki(key), { name: "RSASSA-PKCS1-v1_5", hash: RSA_PKCS1_SIG.get(alg) || hash }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", k, signature, data);
  }
  if (keyFamily === "ec" && ECDSA_SIG.has(alg)) {
    if (!CURVES[key.curve]) throw new Error("Bu eğri tarayıcıda doğrulanamıyor.");
    const [namedCurve, size] = CURVES[key.curve];
    const raw = derToRawEcdsa(signature, size);
    if (!raw) return false;
    const k = await crypto.subtle.importKey("spki", key.spki, { name: "ECDSA", namedCurve }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: ECDSA_SIG.get(alg) || hash }, k, raw, data);
  }
  throw new Error("Bu imza algoritması tarayıcıda doğrulanamıyor: " + alg);
}

// RFC 4055 RSASSA-PSS-params; absent fields mean SHA-1, MGF1 with SHA-1 and
// a 20-byte salt.
function pssParams(algId) {
  const A = forge().asn1;
  let hash = "SHA-1", mgfHash = "SHA-1", salt = 20;
  const p = algId.value[1];
  if (p && p.type === A.Type.SEQUENCE) {
    for (const field of p.value) {
      if (field.tagClass !== A.Class.CONTEXT_SPECIFIC) continue;
      const inner = field.value[0];
      if (field.type === 0) hash = HASH_BY_OID[A.derToOid(inner.value[0].value)];
      else if (field.type === 1) mgfHash = inner.value[1] ? HASH_BY_OID[A.derToOid(inner.value[1].value[0].value)] : undefined;
      else if (field.type === 2) salt = A.derToInteger(inner.value);
    }
  }
  return { hash, mgfHash, salt };
}

// WebCrypto imports RSA keys under rsaEncryption only; an id-RSASSA-PSS key
// holds the same RSAPublicKey, so its SubjectPublicKeyInfo is rewritten.
function rsaSpki(key) {
  if (key.keyAlg !== OID.rsaPss) return key.spki;
  const A = forge().asn1;
  const C = A.Class.UNIVERSAL, T = A.Type;
  const bits = A.fromDer(bytesToBinary(key.spki)).value[1];
  const raw = bits.bitStringContents !== undefined ? bits.bitStringContents : bits.value;
  return der(A.create(C, T.SEQUENCE, true, [
    A.create(C, T.SEQUENCE, true, [A.create(C, T.OID, false, A.oidToDer(OID.rsaEncryption).getBytes()), A.create(C, T.NULL, false, "")]),
    A.create(C, T.BITSTRING, false, raw),
  ]));
}

// ECDSA-Sig-Value (DER SEQUENCE of r, s) -> the fixed-size r||s WebCrypto
// wants. Anything that is not exactly that gives null: a malformed value is
// a signature that does not verify, not one that cannot be checked.
function derToRawEcdsa(sig, size) {
  try {
    const A = forge().asn1;
    const seq = A.fromDer(bytesToBinary(sig));
    if (seq.type !== A.Type.SEQUENCE || seq.value.length !== 2) return null;
    const part = (v) => {
      if (v.type !== A.Type.INTEGER) throw new Error("ECDSA");
      let b = binaryToBytes(v.value);
      while (b.length > size && b[0] === 0) b = b.subarray(1);
      if (b.length > size) throw new Error("ECDSA");
      const out = new Uint8Array(size);
      out.set(b, size - b.length);
      return out;
    };
    return concatBytes([part(seq.value[0]), part(seq.value[1])]);
  } catch (e) {
    return null;
  }
}

function decodeAsn1String(node) {
  const A = forge().asn1;
  const v = node.value;
  if (node.type === A.Type.BMPSTRING) {
    let s = "";
    for (let i = 0; i + 1 < v.length; i += 2) s += String.fromCharCode((v.charCodeAt(i) << 8) | v.charCodeAt(i + 1));
    return s;
  }
  if (node.type === A.Type.UTF8) {
    try { return forge().util.decodeUtf8(v); } catch (e) { return v; }
  }
  return v;
}

function parseName(seq) {
  const A = forge().asn1;
  const out = {};
  for (const set of seq.value) {
    for (const atv of set.value) {
      const key = NAME_OIDS[A.derToOid(atv.value[0].value)];
      if (key) out[key] = decodeAsn1String(atv.value[1]);
    }
  }
  return out;
}

function parseTime(node) {
  const A = forge().asn1;
  return node.type === A.Type.UTCTIME ? A.utcTimeToDate(node.value) : A.generalizedTimeToDate(node.value);
}

// The extensions path building and signer checks need. An extension that
// does not decode counts as its most restrictive reading.
function readExtensions(extensions) {
  const A = forge().asn1;
  const out = { qualified: false, qc5070: false, ca: false, pathLen: null, keyUsage: null, extKeyUsage: null, skiHex: null };
  for (const ext of extensions) {
    const oid = A.derToOid(ext.value[0].value);
    const inner = () => A.fromDer(ext.value[ext.value.length - 1].value);   // extnValue
    try {
      if (oid === OID.basicConstraints) {
        for (const n of inner().value) {
          if (n.type === A.Type.BOOLEAN) out.ca = n.value.charCodeAt(0) !== 0;
          else if (n.type === A.Type.INTEGER) out.pathLen = A.derToInteger(n.value);
        }
      } else if (oid === OID.keyUsage) {
        out.keyUsage = { digitalSignature: false, nonRepudiation: false, keyCertSign: false };
        const bits = inner();
        const raw = bits.bitStringContents !== undefined ? bits.bitStringContents : bits.value;
        const b = raw.charCodeAt(1) || 0;      // after the unused-bits octet
        out.keyUsage = { digitalSignature: !!(b & 0x80), nonRepudiation: !!(b & 0x40), keyCertSign: !!(b & 0x04) };
      } else if (oid === OID.extKeyUsage) {
        out.extKeyUsage = [];
        out.extKeyUsage = inner().value.map((n) => A.derToOid(n.value));
      } else if (oid === OID.subjectKeyIdentifier) {
        out.skiHex = bytesToHex(binaryToBytes(inner().value));
      } else if (oid === OID.qcStatements) {
        // ETSI QcCompliance, or BTK's "nitelikli elektronik sertifika (5070)"
        const bin = A.toDer(ext).getBytes();
        out.qc5070 = bin.includes(A.oidToDer("2.16.792.1.61.0.1.5070.1.1").getBytes());
        out.qualified = out.qc5070 || bin.includes(A.oidToDer("0.4.0.1862.1.1").getBytes());
      }
    } catch (e) {
      if (oid === OID.basicConstraints) { out.ca = false; out.pathLen = null; }
    }
  }
  return out;
}

// Also returned, for path building and signer checks: ca, pathLen,
// keyUsage { digitalSignature, nonRepudiation, keyCertSign } or null,
// extKeyUsage (OIDs) or null, skiHex, issuerDerHex.
export function parseCertificate(certAsn1) {
  const A = forge().asn1;
  const tbs = certAsn1.value[0].value;
  let i = 0;
  if (tbs[0].tagClass === A.Class.CONTEXT_SPECIFIC) i++;
  const serialHex = bytesToHex(binaryToBytes(tbs[i++].value));
  i++; // signature algorithm
  const issuerNode = tbs[i++];
  const issuer = parseName(issuerNode);
  const validity = tbs[i++].value;
  const subject = parseName(tbs[i++]);
  const spkiNode = tbs[i++];
  const keyAlg = A.derToOid(spkiNode.value[0].value[0].value);
  const params = spkiNode.value[0].value[1];
  const curve = params && params.type === A.Type.OID ? A.derToOid(params.value) : null;
  let ext = readExtensions([]);
  for (; i < tbs.length; i++) {
    if (tbs[i].tagClass === A.Class.CONTEXT_SPECIFIC && tbs[i].type === 3) ext = readExtensions(tbs[i].value[0].value);
  }
  const sameName = JSON.stringify(issuer) === JSON.stringify(subject);
  return {
    subject, issuer, serialHex,
    issuerDerHex: bytesToHex(der(issuerNode)),
    name: subject.CN || [subject.givenName, subject.surname].filter(Boolean).join(" ") || subject.O || "Bilinmeyen",
    email: subject.email || null,
    organization: subject.O || null,
    issuerName: issuer.CN || issuer.O || "Bilinmeyen",
    notBefore: parseTime(validity[0]),
    notAfter: parseTime(validity[1]),
    selfSigned: sameName,
    qualified: ext.qualified,
    qc5070: ext.qc5070,
    ca: ext.ca,
    pathLen: ext.pathLen,
    keyUsage: ext.keyUsage,
    extKeyUsage: ext.extKeyUsage,
    skiHex: ext.skiHex,
    keyAlg, curve,
    keyLabel: keyAlg === OID.rsaEncryption ? "RSA" : keyAlg === OID.ecPublicKey ? "ECDSA" : keyAlg === OID.rsaPss ? "RSA-PSS" : keyAlg,
    spki: binaryToBytes(A.toDer(spkiNode).getBytes()),
  };
}
