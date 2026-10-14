// The bridge's card path (SunPKCS11) against a mock PKCS#11 module, so the
// login rules can be checked without a card:
//   - every request logs in with its own PIN and logs out at the end
//     (a wrong PIN after a good one is still refused);
//   - /v1/durum finds tokens without logging in (no pinpad prompt), skips
//     an empty reader and keeps one provider (one poller thread) per slot;
//   - with several tokens a PIN goes only to the slot the page names;
//   - pulled, re-inserted and swapped cards are followed.
// Needs a JDK (java/keytool), a C compiler (cc) and /usr/bin/openssl.
//   node tests/kopru-pkcs11.mjs
import { execFileSync, spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const JAR = path.resolve(here, "../../kopru/MuhurImzaKoprusu.jar");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "muhur-p11-"));
const lib = path.join(work, process.platform === "darwin" ? "libmockp11.dylib" : "libmockp11.so");
const state = path.join(work, "state.txt");
const log = path.join(work, "p11.log");
const PIN = "123456";

/* ------------------------------- set up ---------------------------------- */
execFileSync("cc", ["-shared", "-fPIC", "-O1", "-fvisibility=hidden", "-o", lib, path.join(here, "kopru-pkcs11/mockp11.c")]);
execFileSync("keytool", ["-genkeypair", "-alias", "imza", "-keyalg", "RSA", "-keysize", "2048", "-sigalg", "SHA256withRSA",
  "-storetype", "PKCS12", "-keystore", path.join(work, "k.p12"), "-storepass", "246810", "-keypass", "246810",
  "-dname", "CN=Kart Deneme, C=TR"], { stdio: "ignore" });
execFileSync("java", [path.join(here, "kopru-pkcs11/Export.java"), path.join(work, "k.p12"), "246810", work], { stdio: "ignore" });

const setSlots = (...lines) => fs.writeFileSync(state, lines.join("\n") + "\n");
const logLines = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

setSlots(`token ${PIN}`);
const port = await freePort();
const B = `http://127.0.0.1:${port}`;
const bridge = spawn("java", ["-jar", JAR, "--lib", lib, "--port", String(port)], {
  env: { ...process.env, MOCKP11_STATE: state, MOCKP11_LOG: log, MOCKP11_DIR: work },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
bridge.stdout.on("data", (d) => (out += d));
bridge.stderr.on("data", (d) => (out += d));
for (let i = 0; i < 40 && !out.includes("Ctrl+C"); i++) await sleep(100);

const get = (p) => fetch(B + p).then(async (r) => ({ status: r.status, data: await r.json() }));
const post = (p, body) => fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, data: await r.json() }));
const code = (r) => (r.data.ok ? r.status : `${r.status} ${r.data.error.code}`);
// OS threads of the bridge (each SunPKCS11 provider on an empty reader runs one)
const threads = () => process.platform === "linux" ? fs.readdirSync(`/proc/${bridge.pid}/task`).length
  : execFileSync("ps", ["-M", "-p", String(bridge.pid)]).toString().trim().split("\n").length - 1;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok || detail === undefined ? "" : "  -> " + JSON.stringify(detail)}`);
  if (!ok) failed++;
}
// log lines written while fn runs
async function during(fn) {
  const before = logLines().length;
  const r = await fn();
  return { r, lines: logLines().slice(before) };
}
async function signOnce(pin, extra = {}) {
  const certs = await post("/v1/sertifikalar", { pin, ...extra });
  if (!certs.data.ok) return { certs };
  const c = certs.data.certificates[0];
  const data = crypto.randomBytes(300);
  const r = await post("/v1/imzala", { pin, id: c.id, data: data.toString("base64"), hash: "SHA-256", slot: certs.data.slot });
  const x = new crypto.X509Certificate(Buffer.from(c.der, "base64"));
  const verified = r.data.ok && crypto.verify("sha256", data, x.publicKey, Buffer.from(r.data.signature, "base64"));
  return { certs, r, verified };
}

try {
  /* ---------------------------- one token -------------------------------- */
  let t = await during(() => get("/v1/durum"));
  check("durum: card var, one token at slot 0", t.r.data.card === "var" && t.r.data.tokens.length === 1 && t.r.data.tokens[0].slot === 0, t.r.data);
  check("durum: no C_Login", !t.lines.some((l) => l.startsWith("LOGIN")), t.lines);

  t = await during(() => signOnce(PIN));
  check("sign with the right PIN verifies", t.r.verified === true, t.r.r && t.r.r.data);
  check("each request logs in and out", t.lines.filter((l) => l === "LOGIN slot=0 -> OK").length === 2 && t.lines.filter((l) => l === "LOGOUT slot=0").length === 2, t.lines);

  // the reported bug: after one good PIN, any PIN signed
  t = await during(async () => {
    const c = await post("/v1/sertifikalar", { pin: "000000" });
    const s = await post("/v1/imzala", { pin: "000000", id: "imza", data: Buffer.from("x").toString("base64") });
    return [c, s];
  });
  check("wrong PIN after a good one: certificates refused", code(t.r[0]) === "401 PIN_HATALI", t.r[0].data);
  check("wrong PIN after a good one: signing refused", code(t.r[1]) === "401 PIN_HATALI", t.r[1].data);
  check("the card saw both wrong PINs", t.lines.filter((l) => l === "LOGIN slot=0 -> PIN_INCORRECT").length === 2 && !t.lines.some((l) => l.startsWith("SIGN")), t.lines);
  t = await during(() => signOnce(PIN));
  check("right PIN works again (tries reset)", t.r.verified === true, t.r.r && t.r.r.data);
  t = await during(() => post("/v1/sertifikalar", { pin: "" }));
  check("no PIN on a card without a keypad: PIN_GEREKLI, no login tried", code(t.r) === "400 PIN_GEREKLI" && !t.lines.some((l) => l.startsWith("LOGIN")), [t.r.data, t.lines]);

  /* ------------------------ empty reader first --------------------------- */
  setSlots("empty", `token ${PIN}`);
  t = await during(() => get("/v1/durum"));
  check("empty slot 0 + token at 1: card var, token slot 1", t.r.data.card === "var" && t.r.data.tokens.map((x) => x.slot).join() === "1", t.r.data);
  t = await during(() => signOnce(PIN));
  check("signs on the token behind the empty reader", t.r.verified === true && t.lines.includes("LOGIN slot=1 -> OK"), t.lines);
  const before = threads();
  for (let i = 0; i < 30; i++) await get("/v1/durum");
  const after = threads();
  check("30 polls with an empty reader: no new threads", after - before <= 2, { before, after });

  /* ----------------------------- no token -------------------------------- */
  setSlots("empty", "empty");
  t = await during(() => get("/v1/durum"));
  check("no token: card yok", t.r.data.card === "yok" && t.r.data.tokens.length === 0, t.r.data);
  t = await during(() => post("/v1/sertifikalar", { pin: PIN }));
  check("no token: KART_YOK, no login", code(t.r) === "404 KART_YOK" && !t.lines.some((l) => l.startsWith("LOGIN")), [t.r.data, t.lines]);

  /* --------------------------- re-insertion ------------------------------ */
  setSlots(`token ${PIN}`, "empty");
  await sleep(2600);   // SunPKCS11 polls an empty removable slot every 2 s
  t = await during(() => get("/v1/durum"));
  check("card inserted into the kept provider's slot is found", t.r.data.card === "var" && t.r.data.tokens.map((x) => x.slot).join() === "0", t.r.data);
  t = await during(() => signOnce(PIN));
  check("and signs", t.r.verified === true, t.r.r && t.r.r.data);

  /* ---------------------------- two tokens ------------------------------- */
  setSlots(`token ${PIN}`, "token 654321");
  await sleep(2600);
  t = await during(() => get("/v1/durum"));
  check("two tokens listed", t.r.data.tokens.map((x) => x.slot).join() === "0,1", t.r.data);
  t = await during(() => post("/v1/sertifikalar", { pin: "654321" }));
  check("two tokens, no slot: KART_SEC and no PIN sent anywhere", code(t.r) === "409 KART_SEC" && !t.lines.some((l) => l.startsWith("LOGIN")), [t.r.data, t.lines]);
  t = await during(() => post("/v1/imzala", { pin: "654321", id: "imza", data: "AAAA" }));
  check("two tokens, no slot: signing refused too", code(t.r) === "409 KART_SEC" && !t.lines.some((l) => l.startsWith("LOGIN")), [t.r.data, t.lines]);
  t = await during(() => signOnce("654321", { slot: 1 }));
  check("slot 1 named: PIN goes to slot 1 only", t.r.verified === true && t.lines.every((l) => !l.startsWith("LOGIN") || l.startsWith("LOGIN slot=1")), t.lines);
  t = await during(() => post("/v1/sertifikalar", { pin: "654321", slot: 0 }));
  check("slot 0 named with slot 1's PIN: refused on slot 0 only", code(t.r) === "401 PIN_HATALI" && t.lines.filter((l) => l.startsWith("LOGIN")).join() === "LOGIN slot=0 -> PIN_INCORRECT", t.lines);
  check("the PIN error names that card", /\(Kart 1\)/.test(t.r.data.error.message), t.r.data.error.message);

  /* ---------------------- reader list shrinks/grows ---------------------- */
  setSlots(`token ${PIN}`);
  t = await during(() => get("/v1/durum"));
  check("reader removed: one token left", t.r.data.tokens.map((x) => x.slot).join() === "0", t.r.data);
  setSlots("empty", "empty", `token ${PIN}`);
  t = await during(() => get("/v1/durum"));
  check("readers renumbered: token found at slot 2", t.r.data.tokens.map((x) => x.slot).join() === "2", t.r.data);
  t = await during(() => signOnce(PIN));
  check("and signs there", t.r.verified === true && t.lines.includes("LOGIN slot=2 -> OK"), t.lines);

  /* ------------------------------ pinpad --------------------------------- */
  setSlots(`token ${PIN} pinpad`);
  await get("/v1/durum");
  await sleep(2600);
  t = await during(async () => { for (let i = 0; i < 5; i++) await get("/v1/durum"); return get("/v1/durum"); });
  check("pinpad reader: status polls never prompt", t.r.data.card === "var" && !t.lines.some((l) => l.startsWith("LOGIN")), t.lines);
  t = await during(() => post("/v1/sertifikalar", { pin: "x" }));
  check("pinpad reader: certificates log in on the keypad", t.r.data.ok === true && t.lines.includes("LOGIN slot=0 -> PINPAD_PROMPT_OK"), [t.r.data, t.lines]);
  t = await during(() => post("/v1/sertifikalar", { pin: "" }));
  check("pinpad reader: an empty PIN is fine (the keypad asks)", t.r.data.ok === true && t.lines.includes("LOGIN slot=0 -> PINPAD_PROMPT_OK"), [t.r.data, t.lines]);

  /* ------------------------------ lockout -------------------------------- */
  setSlots("empty");   // swap the pinpad token for a plain one
  await get("/v1/durum");
  setSlots(`token ${PIN}`);
  await sleep(2600);
  const tries = [];
  for (let i = 0; i < 3; i++) tries.push(code(await post("/v1/sertifikalar", { pin: "999999" })));
  check("third wrong PIN locks: PIN_BLOKE", tries.join() === "401 PIN_HATALI,401 PIN_HATALI,423 PIN_BLOKE", tries);
} catch (e) {
  failed++;
  console.log("FAIL  " + (e.stack || e));
} finally {
  bridge.kill();
  if (failed) console.log("\n--- bridge output ---\n" + out + "\n--- module log ---\n" + logLines().join("\n"));
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
