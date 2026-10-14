/* ==========================================================================
   Mühür — kart.js
   Signing with an e-signature card (Kamu SM / TÜBİTAK AKİS, or any card
   with a PKCS#11 driver) through the local bridge in kopru/.

   Two ways to reach http://127.0.0.1:21730:
   - fetch(): Chrome, Edge and Firefox allow it from https pages after a
     one-time "apps on this device" permission prompt;
   - a relay window: Safari blocks that fetch as mixed content, so the
     bridge serves a small page that is opened from a click and forwards
     the same requests with postMessage, to and from known origins only.
     A relay that does not come up in time, or whose window is closed, is
     dropped at once (its waiting requests fail), so the next click opens a
     new window instead of reusing a dead one.

   The PIN lives in memory for one signing and is only ever sent to the
   loopback bridge.
   ========================================================================== */

import { forge } from "./libs.js";
import { parseCertificate } from "./sign.js";
import { bytesToBinary, bytesToHex, bytesToBase64, base64ToBytes, digest } from "./util.js";

export const PORT = 21730;
export const BASE = `http://127.0.0.1:${PORT}`;
export const JAR_URL = new URL("../../kopru/MuhurImzaKoprusu.jar", import.meta.url).href;
export const SOURCE_URL = new URL("../../kopru/MuhurImzaKoprusu.java", import.meta.url).href;
export const DRIVER_URL = "https://akiskart.bilgem.tubitak.gov.tr/destek/";

export class CardError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 0;
  }
}

export function isSafari() {
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium|CriOS|FxiOS|Edg\/|OPR\//.test(ua);
}

export function platform() {
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
  if (/win/i.test(p)) return "windows";
  if (/mac/i.test(p)) return "mac";
  return "linux";
}

/* -------------------------------- Transport ------------------------------ */
// The relay window and what waits on it. Every window.open gets a record
// of its own (window, ready promise, pending requests, watch timer), and
// every timer and reply works on the record it was made for, never on the
// module-level `relay`. So a relay that failed or closed is simply dropped:
// its waiters fail at once, and the next click opens a fresh one instead of
// handing back a promise that has already been rejected.
let relay = null;

const RELAY_READY_MS = 8000;
const RELAY_WATCH_MS = 500;

function relayClosed() {
  return new CardError("POPUP", "Köprü penceresi kapandı; işlem tamamlanmadı. Tekrar bağlanmayı dene.");
}

if (typeof window !== "undefined") window.addEventListener("message", (e) => {
  const r = relay;
  if (e.origin !== BASE || !r) return;
  const m = e.data;
  if (!m || typeof m !== "object") return;
  if (m.type === "muhur-bridge-ready") r.settle(null);
  if (m.type === "muhur-bridge-reply") {
    const done = r.pending.get(m.id);
    if (done) { r.pending.delete(m.id); done(m); }
  }
});

// Fails the ready promise (if still waiting) and every pending request of
// one relay, stops watching its window and forgets it if it is current.
function endRelay(r, err) {
  clearInterval(r.watch);
  r.settle(err);
  for (const done of r.pending.values()) done(null, err);
  r.pending.clear();
  if (relay === r) relay = null;
}

// Must run inside a click handler: browsers only allow popups from a gesture.
export function openRelay() {
  const cur = relay;
  if (cur && !cur.win.closed) return cur.ready;
  if (cur) endRelay(cur, relayClosed());
  // the same name reuses a leftover popup instead of stacking a second one
  const win = window.open(`${BASE}/relay`, "muhur-kopru", "popup,width=380,height=260");
  if (!win) return Promise.reject(new CardError("POPUP", "Tarayıcı köprü penceresini engelledi. Bu site için açılır pencerelere izin verip tekrar dene."));
  const r = { win, pending: new Map(), seq: 0, watch: 0, settle: null, ready: null };
  r.ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      endRelay(r, new CardError("KOPRU_YOK", "Köprü penceresi yanıt vermedi. İmza Köprüsü'nün bilgisayarında çalıştığından emin ol."));
      // it shows the browser's "can't connect" page: close it, so that
      // "Tekrar dene" opens a fresh window once the bridge is running
      try { win.close(); } catch (e) { /* gone */ }
    }, RELAY_READY_MS);
    r.settle = (err) => {
      clearTimeout(t);
      r.settle = () => {};
      if (err) reject(err); else resolve();
    };
  });
  r.ready.catch(() => { /* reported to whoever awaits it */ });
  // a closed window never answers: fail its waiters now, not at their timeout
  r.watch = setInterval(() => { if (win.closed) endRelay(r, relayClosed()); }, RELAY_WATCH_MS);
  relay = r;
  return r.ready;
}

export function closeRelay() {
  const r = relay;
  if (!r) return;
  endRelay(r, new CardError("POPUP", "Köprü penceresi kapatıldı."));
  const w = r.win;
  if (w.closed) return;
  // the relay page closes itself; a page that can't (the browser's error
  // page) is closed from here, unless a new relay has taken the window over
  try { w.postMessage({ type: "muhur-bridge", close: true }, BASE); } catch (e) { /* gone */ }
  setTimeout(() => {
    try { if (!w.closed && !(relay && relay.win === w)) w.close(); } catch (e) { /* gone */ }
  }, 300);
}

function useRelay() { return isSafari() || !!(relay && !relay.win.closed); }

async function viaRelay(method, path, body, timeout, label) {
  const r = relay;
  if (!r || r.win.closed) throw relayClosed();
  await r.ready;
  if (relay !== r) throw relayClosed();
  return new Promise((resolve, reject) => {
    const id = ++r.seq;
    const t = setTimeout(() => { r.pending.delete(id); reject(new CardError("ZAMAN", "Köprü zamanında yanıt vermedi.")); }, timeout);
    r.pending.set(id, (m, err) => {
      clearTimeout(t);
      if (err) reject(err);
      else resolve({ status: m.status, data: m.data });
    });
    try {
      r.win.postMessage({ type: "muhur-bridge", id, method, path, body, label }, BASE);
    } catch (e) {
      r.pending.delete(id);
      clearTimeout(t);
      reject(relayClosed());
    }
  });
}

async function viaFetch(method, path, body, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(BASE + path, {
      method, cache: "no-store", signal: ctrl.signal,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json() };
  } catch (err) {
    const denied = (await permissionState()) === "denied";
    throw new CardError(denied ? "IZIN" : "KOPRU_YOK", denied
      ? "Tarayıcı bu sitenin bilgisayardaki uygulamalara erişmesini engelliyor. Adres çubuğundaki site ayarlarından 'Cihazdaki uygulamalar / Yerel ağ' iznini aç."
      : "İmza Köprüsü'ne ulaşılamadı. Köprünün çalıştığından emin ol.");
  } finally {
    clearTimeout(t);
  }
}

async function call(method, path, body, { timeout = 15000, label } = {}) {
  const res = useRelay() ? await viaRelay(method, path, body, timeout, label) : await viaFetch(method, path, body, timeout);
  if (!res.data || res.data.ok === false) {
    const e = (res.data && res.data.error) || {};
    throw new CardError(e.code || "HATA", e.message || "Köprü bir hata bildirdi.", res.status);
  }
  return res.data;
}

// Chrome 142+ / Firefox 153+ ask once before a site may reach this device.
export async function permissionState() {
  if (!navigator.permissions || !navigator.permissions.query) return null;
  for (const name of ["loopback-network", "local-network-access", "local-network"]) {
    try { return (await navigator.permissions.query({ name })).state; } catch (e) { /* unknown name */ }
  }
  return null;
}

/* ---------------------------------- API ---------------------------------- */
// -> { version, mode, library, card: "var"|"yok"|"deneme"|"hata:…", java, os,
//      tokens: [{ slot, label }], pinpad? }
//    tokens: the cards present; with several, the page names one (slot) so a
//    PIN never goes to a card the user did not pick. pinpad (optional): true
//    when the token takes the PIN on the reader's own keypad; the dialog then
//    sends an empty PIN instead of asking for one. A bridge that does not
//    report it leaves the choice to the user ("Okuyucumun tuş takımı var").
export async function status() {
  return call("GET", "/v1/durum", null, { timeout: 60000, label: "Kart aranıyor…" });
}

// -> [{ id, der: Uint8Array, info, fingerprint, signing, slot }]
// slot: the token the certificates came from (the bridge says which), so
// that signing goes to the same card.
export async function certificates(pin, slot) {
  await forge();
  const body = { pin };
  if (typeof slot === "number") body.slot = slot;
  const data = await call("POST", "/v1/sertifikalar", body, { timeout: 60000, label: "Sertifikalar okunuyor…" });
  const from = typeof data.slot === "number" ? data.slot : typeof slot === "number" ? slot : null;
  const out = [];
  for (const c of data.certificates || []) {
    const der = base64ToBytes(c.der);
    let info;
    try { info = parseCertificate(globalThis.forge.asn1.fromDer(bytesToBinary(der))); } catch (e) { continue; }
    info.fingerprint = bytesToHex(await digest("SHA-256", der), ":");
    out.push({ id: c.id, der, info, signing: c.signing !== false, keyAlg: c.keyAlg, slot: from });
  }
  // qualified signing certificates first
  out.sort((a, b) => (b.info.qualified - a.info.qualified) || (b.signing - a.signing));
  return out;
}

// The signer sign.js needs; the card signs the CMS signed attributes.
// EC keys sign with the digest that matches their curve (Kamu SM's P-384
// keys with SHA-384); RSA keys with SHA-256.
const CURVE_HASH = { "1.3.132.0.34": "SHA-384", "1.3.132.0.35": "SHA-512" };

function isEc(cert) { return cert.keyAlg === "ECDSA" || cert.info.keyLabel === "ECDSA"; }

// The digest a card certificate signs with (also shown in the sign dialog).
export function cardHash(cert) {
  return isEc(cert) ? CURVE_HASH[cert.info.curve] || "SHA-256" : "SHA-256";
}

export function cardSigner(cert, pin) {
  const ec = isEc(cert);
  const hash = cardHash(cert);
  return {
    certDer: cert.der,
    chainDer: [],
    keyAlg: ec ? "ECDSA" : "RSA",
    hash,
    async sign(data) {
      const body = { pin, id: cert.id, data: bytesToBase64(data), hash };
      if (typeof cert.slot === "number") body.slot = cert.slot;
      const r = await call("POST", "/v1/imzala", body, { timeout: 120000, label: "Kart imzalıyor…" });
      this.chainDer = (r.chain || []).map(base64ToBytes);
      return base64ToBytes(r.signature);
    },
  };
}

export function runCommand(os) {
  const p = os || platform();
  if (p === "windows") return "java -jar \"%USERPROFILE%\\Downloads\\MuhurImzaKoprusu.jar\"";
  return "java -jar ~/Downloads/MuhurImzaKoprusu.jar";
}
