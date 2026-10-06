/* ==========================================================================
   Mühür — sign.js
   Cryptographic signatures, the part a picture of a signature cannot give:

   1. Identity  — a self-signed X.509 certificate made in the browser, or the
                  user's own .p12/.pfx (RSA). Keys never leave the device.
   2. Signing   — adbe.pkcs7.detached (the CMS profile every reader accepts),
                  written as an incremental update so earlier signatures in
                  the file stay valid. Classic xref tables and xref streams
                  are both continued in kind.
   3. Verifying — every /ByteRange in a file is checked: the digest of the
                  covered bytes against the signed messageDigest, then the
                  signature over the signed attributes with WebCrypto (RSA and
                  ECDSA), whether the signature covers the whole file, and
                  what the certificate says about the signer.

   pdf-lib and forge are loaded as classic scripts and read from globalThis,
   so this module also runs under Node for the test-suite.
   ========================================================================== */

import {
  enc, toBytes, concatBytes, bytesToBinary, binaryToBytes, bytesToHex, digest,
  indexOfAscii, lastIndexOfAscii, pdfDate, parsePdfDate,
} from "./util.js";

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
  const f = forge();
  const cert = f.pki.certificateFromPem(identity.certPem);
  return binaryToBytes(f.asn1.toDer(f.pki.certificateToAsn1(cert)).getBytes());
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
// opts: { identity, name, reason, location, contact, date,
//         page (0-based), rect [x1 y1 x2 y2] in PDF user space or null,
//         appearance: { imagePng, lines: [], fontBytes } }
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
  const sigHead = `${sigRef.objectNumber} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached\n/ByteRange `;
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
  const cms = createCms(signed, opts.identity, date);
  if (cms.length * 2 > SIGNATURE_BYTES * 2) throw new Error("İmza verisi ayrılan alana sığmadı.");
  out.set(enc.encode(bytesToHex(cms)), contentsStart + 1);
  return out;
}

function createCms(signedBytes, identity, date) {
  const f = forge();
  const cert = f.pki.certificateFromPem(identity.certPem);
  const key = f.pki.privateKeyFromPem(identity.keyPem);
  const p7 = f.pkcs7.createSignedData();
  p7.content = f.util.createBuffer(bytesToBinary(signedBytes));
  p7.addCertificate(cert);
  for (const pem of identity.chainPem || []) p7.addCertificate(f.pki.certificateFromPem(pem));
  p7.addSigner({
    key, certificate: cert, digestAlgorithm: f.pki.oids.sha256,
    authenticatedAttributes: [
      { type: f.pki.oids.contentType, value: f.pki.oids.data },
      { type: f.pki.oids.messageDigest },
      { type: f.pki.oids.signingTime, value: date },
    ],
  });
  p7.sign({ detached: true });
  const asn1 = p7.toAsn1();
  // forge re-encodes the issuer name from parsed attributes and UTF-8 encodes
  // UTF8String values a second time; put the certificate's own bytes back so
  // verifiers can match the signer to its certificate.
  const tbs = f.pki.certificateToAsn1(cert).value[0].value;
  const issuer = tbs[(tbs[0].tagClass === f.asn1.Class.CONTEXT_SPECIFIC ? 1 : 0) + 2];
  const signedData = asn1.value[1].value[0].value;
  signedData[signedData.length - 1].value[0].value[1].value[0] = issuer;
  return binaryToBytes(f.asn1.toDer(asn1).getBytes());
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
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  timeStampToken: "1.2.840.113549.1.9.16.2.14",
  rsaEncryption: "1.2.840.113549.1.1.1",
  rsaPss: "1.2.840.113549.1.1.10",
  ecPublicKey: "1.2.840.10045.2.1",
  qcStatements: "1.3.6.1.5.5.7.1.3",
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
const CURVES = { "1.2.840.10045.3.1.7": ["P-256", 32], "1.3.132.0.34": ["P-384", 48], "1.3.132.0.35": ["P-521", 66] };
const NAME_OIDS = {
  "2.5.4.3": "CN", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C", "2.5.4.7": "L",
  "2.5.4.5": "serialNumber", "1.2.840.113549.1.9.1": "email", "2.5.4.42": "givenName", "2.5.4.4": "surname",
};

export function hasSignatures(bytes) {
  return indexOfAscii(toBytes(bytes), "/ByteRange") >= 0;
}

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
  for (const [ref, dict, inlineWidget] of sigs) {
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

      const br = dict.lookup(P.PDFName.of("ByteRange"), P.PDFArray).asArray().map((n) => n.asNumber());
      const contents = dict.lookup(P.PDFName.of("Contents"));
      const cms = contents.asBytes();
      const signed = concatBytes([bytes.subarray(br[0], br[0] + br[1]), bytes.subarray(br[2], br[2] + br[3])]);
      const coveredEnd = br[2] + br[3];
      r.revisionEnd = coveredEnd;
      r.coversWholeDocument = isOnlyWhitespace(bytes, coveredEnd);
      Object.assign(r, await verifyCms(cms, signed, r.subFilter));
      if (r.certificate) {
        r.known = !!(knownFingerprints && knownFingerprints.includes(r.certificate.fingerprint));
      }
    } catch (err) {
      r.error = String(err && err.message || err);
      r.integrity = false;
      r.signatureValid = false;
    }
    r.signingTime = r.cmsTime || r.dictTime || null;
    results.push(r);
  }
  results.sort((a, b) => (a.revisionEnd || 0) - (b.revisionEnd || 0));
  results.forEach((r, i) => { r.order = i + 1; r.laterChanges = !r.coversWholeDocument; });
  return results;
}

function isOnlyWhitespace(bytes, from) {
  for (let i = from; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== 0x0a && b !== 0x0d && b !== 0x20 && b !== 0x09 && b !== 0x00) return false;
  }
  return true;
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

async function verifyCms(cmsBytes, signedBytes, subFilter) {
  const f = forge();
  const A = f.asn1;
  const out = { integrity: false, signatureValid: null };
  if (subFilter && /x509\.rsa_sha1/.test(subFilter)) {
    throw new Error("adbe.x509.rsa_sha1 biçimi doğrulanamıyor.");
  }
  const root = A.fromDer(bytesToBinary(cmsBytes), { parseAllBytes: false, strict: false });
  if (A.derToOid(root.value[0].value) !== OID.signedData) throw new Error("İmza verisi CMS SignedData değil.");
  const sd = root.value[1].value[0].value;
  let i = 3;
  let certs = [];
  while (i < sd.length && sd[i].tagClass === A.Class.CONTEXT_SPECIFIC) {
    if (sd[i].type === 0) certs = sd[i].value;
    i++;
  }
  const signerInfos = sd[sd.length - 1].value;
  if (!signerInfos.length) throw new Error("İmzalayan bilgisi yok.");
  const si = signerInfos[0].value;
  let k = 0;
  k++; // version
  const sid = si[k++];
  const digestOid = A.derToOid(si[k++].value[0].value);
  let signedAttrs = null;
  if (si[k].tagClass === A.Class.CONTEXT_SPECIFIC && si[k].type === 0) signedAttrs = si[k++];
  const sigAlgOid = A.derToOid(si[k++].value[0].value);
  const signature = binaryToBytes(si[k++].value);
  const unsigned = si[k] && si[k].tagClass === A.Class.CONTEXT_SPECIFIC && si[k].type === 1 ? si[k].value : [];

  const hash = HASH_BY_OID[digestOid];
  if (!hash) throw new Error("Bilinmeyen özet algoritması: " + digestOid);
  out.digestAlgorithm = hash;
  const actual = await digest(hash, signedBytes);

  // certificates
  const parsed = [];
  for (const c of certs) {
    try { parsed.push({ asn1: c, info: parseCertificate(c) }); } catch (e) { /* skip unreadable certs */ }
  }
  let signer = null;
  if (sid.tagClass === A.Class.UNIVERSAL && sid.type === A.Type.SEQUENCE) {
    const serial = bytesToHex(binaryToBytes(sid.value[1].value));
    signer = parsed.find((p) => p.info.serialHex === serial);
  }
  signer = signer || parsed[0];
  if (signer) {
    const der = binaryToBytes(A.toDer(signer.asn1).getBytes());
    signer.info.fingerprint = bytesToHex(await digest("SHA-256", der), ":");
    out.certificate = signer.info;
  }
  out.chainLength = parsed.length;

  // integrity: the bytes we hashed must equal the signed messageDigest
  let signedContent;
  if (signedAttrs) {
    for (const attr of signedAttrs.value) {
      const oid = A.derToOid(attr.value[0].value);
      const val = attr.value[1].value[0];
      if (oid === OID.messageDigest) out.integrity = bytesToHex(binaryToBytes(val.value)) === bytesToHex(actual);
      if (oid === OID.signingTime) {
        out.cmsTime = val.type === A.Type.UTCTIME ? A.utcTimeToDate(val.value) : A.generalizedTimeToDate(val.value);
      }
    }
    const set = A.create(A.Class.UNIVERSAL, A.Type.SET, true, signedAttrs.value);
    signedContent = binaryToBytes(A.toDer(set).getBytes());
  } else {
    signedContent = signedBytes;
    out.integrity = null;
  }
  out.hasTimestamp = unsigned.some((attr) => A.derToOid(attr.value[0].value) === OID.timeStampToken);

  // signature over the signed attributes, with the signer's public key
  if (signer) {
    try {
      out.signatureValid = await webcryptoVerify(signer.info.spki, signer.info.keyAlg, signer.info.curve, sigAlgOid, hash, signature, signedContent);
      if (!signedAttrs && out.signatureValid) out.integrity = true;
    } catch (err) {
      out.signatureValid = null;
      out.verifyNote = String(err && err.message || err);
    }
    const t = out.cmsTime || new Date();
    out.certValidAtSigning = t >= signer.info.notBefore && t <= signer.info.notAfter;
  }
  return out;
}

async function webcryptoVerify(spki, keyAlg, curve, sigAlgOid, hash, signature, data) {
  if (keyAlg === OID.rsaEncryption) {
    const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  }
  if (keyAlg === OID.ecPublicKey && CURVES[curve]) {
    const [namedCurve, size] = CURVES[curve];
    const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash }, key, derToRawEcdsa(signature, size), data);
  }
  throw new Error("Bu anahtar türü tarayıcıda doğrulanamıyor.");
}

function derToRawEcdsa(der, size) {
  const f = forge();
  const seq = f.asn1.fromDer(bytesToBinary(der));
  const part = (v) => {
    let b = binaryToBytes(v.value);
    while (b.length > size && b[0] === 0) b = b.subarray(1);
    const out = new Uint8Array(size);
    out.set(b, size - b.length);
    return out;
  };
  return concatBytes([part(seq.value[0]), part(seq.value[1])]);
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

export function parseCertificate(certAsn1) {
  const A = forge().asn1;
  const tbs = certAsn1.value[0].value;
  let i = 0;
  if (tbs[0].tagClass === A.Class.CONTEXT_SPECIFIC) i++;
  const serialHex = bytesToHex(binaryToBytes(tbs[i++].value));
  i++; // signature algorithm
  const issuer = parseName(tbs[i++]);
  const validity = tbs[i++].value;
  const subject = parseName(tbs[i++]);
  const spkiNode = tbs[i++];
  const keyAlg = A.derToOid(spkiNode.value[0].value[0].value);
  const params = spkiNode.value[0].value[1];
  const curve = params && params.type === A.Type.OID ? A.derToOid(params.value) : null;
  let qualified = false;
  for (; i < tbs.length; i++) {
    if (tbs[i].tagClass === A.Class.CONTEXT_SPECIFIC && tbs[i].type === 3) {
      for (const ext of tbs[i].value[0].value) {
        if (A.derToOid(ext.value[0].value) === OID.qcStatements) qualified = true;
      }
    }
  }
  const sameName = JSON.stringify(issuer) === JSON.stringify(subject);
  return {
    subject, issuer, serialHex,
    name: subject.CN || [subject.givenName, subject.surname].filter(Boolean).join(" ") || subject.O || "Bilinmeyen",
    email: subject.email || null,
    organization: subject.O || null,
    issuerName: issuer.CN || issuer.O || "Bilinmeyen",
    notBefore: parseTime(validity[0]),
    notAfter: parseTime(validity[1]),
    selfSigned: sameName,
    qualified,
    keyAlg, curve,
    keyLabel: keyAlg === OID.rsaEncryption ? "RSA" : keyAlg === OID.ecPublicKey ? "ECDSA" : keyAlg === OID.rsaPss ? "RSA-PSS" : keyAlg,
    spki: binaryToBytes(A.toDer(spkiNode).getBytes()),
  };
}
