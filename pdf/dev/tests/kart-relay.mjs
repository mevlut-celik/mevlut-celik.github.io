// kart.js transport in Safari's relay mode, with a fake popup in place of
// the bridge's /relay page. No bridge needed:
//   node tests/kart-relay.mjs
// Covers: a relay that never came up is dropped and the retry opens a new
// window; a closed window fails the waiting request at once; closeRelay()
// fails pending requests and force-closes a page that ignores the close
// message; a stale timer never touches a later relay; the slot and digest
// travel with the card certificate.
import assert from "assert/strict";
import { setup, app } from "../harness.mjs";
await setup();

// Timers run 20x faster, so the 8 s ready wait and 60 s request timeouts fit a test run.
const SPEED = 20;
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, (ms || 0) / SPEED, ...a);
globalThis.setInterval = (fn, ms, ...a) => realSetInterval(fn, (ms || 0) / SPEED, ...a);
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms));

const BASE = "http://127.0.0.1:21730";
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", platform: "MacIntel" },
});

// A popup: records what the page sends it; `answer` plays the relay page.
class Popup {
  constructor(url) { this.url = url; this.closed = false; this.sent = []; this.answer = null; }
  postMessage(m, origin) {
    assert.equal(origin, BASE);
    this.sent.push(m);
    if (this.answer) realSetTimeout(() => this.answer(m), 1);
  }
  close() { this.closed = true; }
}
const listeners = [];
const opened = [];
let blockPopups = false;
globalThis.window = {
  addEventListener(type, fn) { if (type === "message") listeners.push(fn); },
  open(url, name) {
    assert.equal(name, "muhur-kopru");
    if (blockPopups) return null;
    const w = new Popup(url);
    opened.push(w);
    return w;
  },
};
const fromBridge = (data) => { for (const fn of listeners) fn({ origin: BASE, data }); };
const ready = () => fromBridge({ type: "muhur-bridge-ready" });
const reply = (m, status, data) => fromBridge({ type: "muhur-bridge-reply", id: m.id, status, data });
const bridgeAnswers = (w, route) => { w.answer = (m) => { if (!m.close) route(m); }; };

const kart = await app("js/kart.js");
const codeOf = (p) => p.then(() => "ok", (e) => e.code);
let t0;

// 1) First run in Safari with the bridge not started: the ready wait times
// out, the window (the browser's error page) is closed, and "Tekrar dene"
// opens a new one that works once the bridge answers.
t0 = Date.now();
assert.equal(await codeOf(kart.openRelay()), "KOPRU_YOK");
assert.ok(opened[0].closed, "the dead relay window is closed");
const p2 = kart.openRelay();
assert.equal(opened.length, 2, "the retry opens a fresh window");
ready();
await p2;
bridgeAnswers(opened[1], (m) => reply(m, 200, { ok: true, card: "deneme", tokens: [{ slot: 0, label: "Deneme" }] }));
assert.equal((await kart.status()).card, "deneme");
assert.equal(opened[1].sent.at(-1).method, "GET");
console.log("ok  timed-out relay is dropped; retry opens a new window and works");

// 2) The user closes the bridge window while certificates are being read:
// the request fails at once with POPUP, not after its 60 s timeout.
opened[1].answer = null;
const pending = codeOf(kart.certificates("1234"));
await sleep(30);
opened[1].closed = true;
t0 = Date.now();
assert.equal(await pending, "POPUP");
assert.ok(Date.now() - t0 < 500, "failed within the window watch, not the timeout");
assert.equal(await codeOf(kart.status()), "POPUP", "no relay left: a call fails at once");
console.log("ok  closing the window fails the waiting request at once");

// 3) closeRelay() while a request waits: it fails right away, and a page that
// does not close itself on the message is closed from the opener.
const p3 = kart.openRelay();
assert.equal(opened.length, 3);
ready();
await p3;
const waiting = codeOf(kart.status());
await sleep(5);
kart.closeRelay();
assert.equal(await waiting, "POPUP");
assert.ok(opened[2].sent.some((m) => m.close), "the close message was sent");
await sleep(80);
assert.ok(opened[2].closed, "fallback close() ran on the right window");
console.log("ok  closeRelay fails pending requests and force-closes the window");

// 4) A request timer from a dropped relay never touches a later relay's
// request with the same id: the later one still gets its (late) answer.
const p4 = kart.openRelay();
ready();
await p4;
const started = Date.now();
const old = codeOf(kart.status());       // id 1 on relay 4
await sleep(5);
kart.closeRelay();
assert.equal(await old, "POPUP");
const p5 = kart.openRelay();
ready();
await p5;
const w5 = opened[4];
await sleep(1000);                       // the later request starts well after the first
const late = kart.status();              // id 1 on relay 5
await sleep(5);
const msg = w5.sent.find((m) => m.method === "GET");
assert.equal(msg.id, 1);
// answer after the first request's timer has fired, before the second's
await sleep(Math.max(0, started + 60000 / SPEED + 150 - Date.now()));
reply(msg, 200, { ok: true, card: "var" });
assert.equal((await late).card, "var");
console.log("ok  a stale timer leaves a later relay's request alone");

// 5) A late "ready" from an earlier window cannot resurrect anything, and a
// reply for an unknown id is ignored.
fromBridge({ type: "muhur-bridge-reply", id: 999, status: 200, data: { ok: true } });
console.log("ok  stray replies are ignored");

// 6) Popups blocked: a clear POPUP error, no relay kept.
kart.closeRelay();
blockPopups = true;
assert.equal(await codeOf(kart.openRelay()), "POPUP");
blockPopups = false;
console.log("ok  a blocked popup is reported");

// 7) The card certificate carries the slot it came from, and signing sends
// that slot and the digest that matches the key.
const f = globalThis.forge;
const keys = f.pki.rsa.generateKeyPair(1024);
const cert = f.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "01";
cert.validity.notBefore = new Date(Date.now() - 86400000);
cert.validity.notAfter = new Date(Date.now() + 86400000);
cert.setSubject([{ name: "commonName", value: "Kart Deneme" }]);
cert.setIssuer([{ name: "commonName", value: "Kart Deneme" }]);
cert.sign(keys.privateKey, f.md.sha256.create());
const der64 = f.util.encode64(f.asn1.toDer(f.pki.certificateToAsn1(cert)).getBytes());
const p7 = kart.openRelay();
ready();
await p7;
const w7 = opened.at(-1);
bridgeAnswers(w7, (m) => {
  if (m.path === "/v1/sertifikalar") reply(m, 200, { ok: true, slot: m.body.slot, certificates: [{ id: "imza", der: der64, keyAlg: "RSA" }] });
  if (m.path === "/v1/imzala") reply(m, 200, { ok: true, signature: "AQID", chain: [] });
});
const certs = await kart.certificates("1234", 2);
assert.equal(w7.sent.find((m) => m.path === "/v1/sertifikalar").body.slot, 2);
assert.equal(certs[0].slot, 2);
assert.equal(kart.cardHash(certs[0]), "SHA-256");
const sig = await kart.cardSigner(certs[0], "1234").sign(new Uint8Array([9, 9]));
assert.deepEqual(Array.from(sig), [1, 2, 3]);
const signMsg = w7.sent.find((m) => m.path === "/v1/imzala");
assert.equal(signMsg.body.slot, 2);
assert.equal(signMsg.body.hash, "SHA-256");
const without = await kart.certificates("1234");
assert.ok(!("slot" in w7.sent.filter((m) => m.path === "/v1/sertifikalar").at(-1).body), "no slot sent when none was chosen");
assert.equal(without[0].slot, null);
kart.closeRelay();
assert.equal(kart.cardHash({ keyAlg: "ECDSA", info: { curve: "1.3.132.0.34" } }), "SHA-384");
assert.equal(kart.cardHash({ keyAlg: "ECDSA", info: { curve: "1.3.132.0.35" } }), "SHA-512");
assert.equal(kart.cardHash({ keyAlg: "ECDSA", info: { curve: "1.2.840.10045.3.1.7" } }), "SHA-256");
console.log("ok  slot and digest travel with the card certificate");

console.log("kart-relay: all passed");
process.exit(0);
