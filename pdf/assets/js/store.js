/* ==========================================================================
   Mühür — store.js
   Accounts and storage, with no server.

   Every account owns a random 256-bit data key (DEK). The DEK is stored
   twice, each time sealed with AES-GCM under a key derived (PBKDF2-SHA256)
   from a secret: once from the password, once from a recovery code shown at
   sign-up. Signing in means unsealing the DEK — a wrong password fails the
   GCM tag, so no password hash is stored at all.

   Everything the account owns — profile, documents, edit state, saved
   signatures, the signing identity — is encrypted with the DEK before it
   reaches IndexedDB. Records carry only an opaque owner id (a hash of the
   e-mail address) and a random id.

   A session keeps the DEK as a non-extractable CryptoKey in IndexedDB, so
   a reload does not ask for the password again; "remember me" decides
   whether that outlives the tab.
   ========================================================================== */

import { enc, dec, bytesToHex, uid } from "./util.js";

const DB_NAME = "muhur";
const DB_VERSION = 1;
const PBKDF2_ITERATIONS = 600000;
const RECOVERY_ITERATIONS = 200000;
const SESSION_SHORT = 12 * 60 * 60 * 1000;
const SESSION_LONG = 30 * 24 * 60 * 60 * 1000;
const TAB_KEY = "muhur.tab";
const LAST_EMAIL_KEY = "muhur.lastEmail";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/* =============================== IndexedDB ============================== */
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("users", { keyPath: "id" });
      db.createObjectStore("session", { keyPath: "id" });
      for (const name of ["docs", "blobs", "states", "vault"]) {
        const store = db.createObjectStore(name, { keyPath: "id" });
        store.createIndex("owner", "owner", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Veritabanı başka bir sekmede açık; o sekmeyi kapatıp yeniden deneyin."));
  });
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, (err) => { try { t.abort(); } catch (e) { /* already done */ } reject(err); });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("İşlem iptal edildi"));
  });
}

async function get(store, id) {
  return tx([store], "readonly", (t) => promisify(t.objectStore(store).get(id)));
}

async function put(store, value) {
  return tx([store], "readwrite", (t) => promisify(t.objectStore(store).put(value)));
}

async function del(store, id) {
  return tx([store], "readwrite", (t) => promisify(t.objectStore(store).delete(id)));
}

async function byOwner(store, owner) {
  return tx([store], "readonly", (t) => promisify(t.objectStore(store).index("owner").getAll(owner)));
}

/* ================================ Crypto ================================ */
const subtle = () => crypto.subtle;

async function deriveKey(secret, salt, iterations) {
  const base = await subtle().importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle().encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv, data };
}

async function open(key, rec) {
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: rec.iv }, key, rec.data));
}

async function sealJson(key, value) {
  return seal(key, enc.encode(JSON.stringify(value)));
}

async function openJson(key, rec) {
  return JSON.parse(dec.decode(await open(key, rec)));
}

function importDek(raw, extractable) {
  return subtle().importKey("raw", raw, { name: "AES-GCM" }, extractable, ["encrypt", "decrypt"]);
}

async function ownerId(email) {
  const d = new Uint8Array(await subtle().digest("SHA-256", enc.encode("muhur:" + email)));
  return bytesToHex(d).toLowerCase();
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function makeRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let s = "";
  for (const b of bytes) s += CROCKFORD[b & 31];
  return s.match(/.{5}/g).join("-");
}

function normalizeRecoveryCode(code) {
  return String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
}

/* ================================ Session =============================== */
const state = { user: null, key: null };

export function currentUser() { return state.user; }
function requireKey() {
  if (!state.key) throw new Error("Oturum kilitli. Lütfen yeniden giriş yapın.");
  return state.key;
}

async function startSession(user, key, remember) {
  const id = uid("tab");
  state.user = user;
  state.key = key;
  await put("session", {
    id: "current", owner: user.id, email: user.email, key, remember: !!remember,
    tab: id, expires: Date.now() + (remember ? SESSION_LONG : SESSION_SHORT),
  });
  try { sessionStorage.setItem(TAB_KEY, id); } catch (e) { /* storage blocked */ }
  try {
    if (remember) localStorage.setItem(LAST_EMAIL_KEY, user.email);
    else localStorage.removeItem(LAST_EMAIL_KEY);
  } catch (e) { /* storage blocked */ }
}

export function lastEmail() {
  try { return localStorage.getItem(LAST_EMAIL_KEY) || ""; } catch (e) { return ""; }
}

export async function restoreSession() {
  const s = await get("session", "current");
  if (!s) return null;
  let tab = null;
  try { tab = sessionStorage.getItem(TAB_KEY); } catch (e) { /* storage blocked */ }
  const fresh = s.expires > Date.now() && (s.remember || tab === s.tab);
  if (!fresh) { await del("session", "current"); return null; }
  const user = await get("users", s.owner);
  if (!user) { await del("session", "current"); return null; }
  try {
    const profile = await openJson(s.key, user.profile);
    state.user = { id: user.id, email: s.email, ...profile };
    state.key = s.key;
    try { sessionStorage.setItem(TAB_KEY, s.tab); } catch (e) { /* storage blocked */ }
    return state.user;
  } catch (e) {
    await del("session", "current");
    return null;
  }
}

export async function signOut() {
  state.user = null;
  state.key = null;
  await del("session", "current");
  try { sessionStorage.removeItem(TAB_KEY); } catch (e) { /* storage blocked */ }
}

/* ================================ Accounts ============================== */
export async function register({ name, email, password, remember }) {
  email = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Geçerli bir e-posta adresi girin.");
  if (String(password || "").length < 8) throw new Error("Şifre en az 8 karakter olmalı.");
  if (!String(name || "").trim()) throw new Error("Adınızı girin.");
  const id = await ownerId(email);
  if (await get("users", id)) throw new Error("Bu e-posta ile bu cihazda zaten bir hesap var.");

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const recoverySalt = crypto.getRandomValues(new Uint8Array(16));
  const recoveryCode = makeRecoveryCode();
  const kek = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const rek = await deriveKey(normalizeRecoveryCode(recoveryCode), recoverySalt, RECOVERY_ITERATIONS);
  const key = await importDek(dekRaw, false);
  const profile = { name: String(name).trim(), initials: initialsOf(name), created: new Date().toISOString() };

  await put("users", {
    id,
    kdf: { salt, iterations: PBKDF2_ITERATIONS },
    wrap: await seal(kek, dekRaw),
    recovery: { salt: recoverySalt, iterations: RECOVERY_ITERATIONS, ...(await seal(rek, dekRaw)) },
    profile: await sealJson(key, profile),
    created: Date.now(),
  });
  dekRaw.fill(0);
  const user = { id, email, ...profile };
  await startSession(user, key, remember);
  return { user, recoveryCode };
}

async function unlockWith(user, secret, which) {
  const params = which === "recovery" ? user.recovery : { ...user.kdf, ...user.wrap };
  const kek = await deriveKey(secret, params.salt, params.iterations);
  return open(kek, which === "recovery" ? user.recovery : user.wrap);
}

export async function signIn({ email, password, remember }) {
  email = normalizeEmail(email);
  const user = await get("users", await ownerId(email));
  if (!user) throw new Error("E-posta veya şifre hatalı.");
  let raw;
  try {
    raw = await unlockWith(user, password, "password");
  } catch (e) {
    throw new Error("E-posta veya şifre hatalı.");
  }
  const key = await importDek(raw, false);
  raw.fill(0);
  const profile = await openJson(key, user.profile);
  const u = { id: user.id, email, ...profile };
  await startSession(u, key, remember);
  return u;
}

export async function hasAccount(email) {
  return !!(await get("users", await ownerId(normalizeEmail(email))));
}

export async function recoverAccount({ email, code, password }) {
  email = normalizeEmail(email);
  if (String(password || "").length < 8) throw new Error("Yeni şifre en az 8 karakter olmalı.");
  const user = await get("users", await ownerId(email));
  if (!user) throw new Error("Bu cihazda bu e-postaya ait hesap yok.");
  let raw;
  try {
    raw = await unlockWith(user, normalizeRecoveryCode(code), "recovery");
  } catch (e) {
    throw new Error("Kurtarma kodu hatalı.");
  }
  await rewrap(user, raw, password);
  const key = await importDek(raw, false);
  raw.fill(0);
  const profile = await openJson(key, user.profile);
  const u = { id: user.id, email, ...profile };
  await startSession(u, key, false);
  return u;
}

async function rewrap(user, raw, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  user.kdf = { salt, iterations: PBKDF2_ITERATIONS };
  user.wrap = await seal(kek, raw);
  await put("users", user);
}

export async function changePassword(current, next) {
  if (String(next || "").length < 8) throw new Error("Yeni şifre en az 8 karakter olmalı.");
  const user = await get("users", state.user.id);
  let raw;
  try {
    raw = await unlockWith(user, current, "password");
  } catch (e) {
    throw new Error("Mevcut şifre hatalı.");
  }
  await rewrap(user, raw, next);
  raw.fill(0);
}

export async function newRecoveryCode(password) {
  const user = await get("users", state.user.id);
  let raw;
  try {
    raw = await unlockWith(user, password, "password");
  } catch (e) {
    throw new Error("Şifre hatalı.");
  }
  const code = makeRecoveryCode();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const rek = await deriveKey(normalizeRecoveryCode(code), salt, RECOVERY_ITERATIONS);
  user.recovery = { salt, iterations: RECOVERY_ITERATIONS, ...(await seal(rek, raw)) };
  raw.fill(0);
  await put("users", user);
  return code;
}

export async function verifyPassword(password) {
  const user = await get("users", state.user.id);
  try {
    (await unlockWith(user, password, "password")).fill(0);
    return true;
  } catch (e) {
    return false;
  }
}

export async function updateProfile(patch) {
  const key = requireKey();
  const user = await get("users", state.user.id);
  const profile = { ...(await openJson(key, user.profile)), ...patch };
  user.profile = await sealJson(key, profile);
  await put("users", user);
  Object.assign(state.user, patch);
  return state.user;
}

export async function deleteAccount(password) {
  if (!(await verifyPassword(password))) throw new Error("Şifre hatalı.");
  const owner = state.user.id;
  await tx(["docs", "blobs", "states", "vault", "users", "session"], "readwrite", async (t) => {
    for (const name of ["docs", "blobs", "states", "vault"]) {
      const keys = await promisify(t.objectStore(name).index("owner").getAllKeys(owner));
      for (const k of keys) t.objectStore(name).delete(k);
    }
    t.objectStore("users").delete(owner);
    t.objectStore("session").delete("current");
  });
  state.user = null;
  state.key = null;
  try { localStorage.removeItem(LAST_EMAIL_KEY); } catch (e) { /* storage blocked */ }
}

function initialsOf(name) {
  return String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 3)
    .map((w) => w[0].toLocaleUpperCase("tr-TR")).join("");
}

/* ============================ Encrypted records ========================= */
// docs: document cards (name, sizes, thumbnail, versions)
export async function listDocs() {
  const key = requireKey();
  const rows = await byOwner("docs", state.user.id);
  const out = [];
  for (const r of rows) {
    try { out.push({ id: r.id, ...(await openJson(key, r)) }); } catch (e) { /* unreadable: skip */ }
  }
  return out.sort((a, b) => (b.modified || 0) - (a.modified || 0));
}

export async function getDoc(id) {
  const r = await get("docs", id);
  if (!r || r.owner !== state.user.id) return null;
  return { id, ...(await openJson(requireKey(), r)) };
}

export async function putDoc(doc) {
  const { id, ...meta } = doc;
  const sealed = await sealJson(requireKey(), meta);
  await put("docs", { id, owner: state.user.id, ...sealed });
  return doc;
}

export async function deleteDoc(doc) {
  const blobIds = new Set();
  for (const v of doc.versions || []) blobIds.add(v.blob);
  const st = await getState(doc.id).catch(() => null);
  if (st) for (const b of Object.values(st.sources || {})) blobIds.add(b);
  await tx(["docs", "blobs", "states"], "readwrite", (t) => {
    t.objectStore("docs").delete(doc.id);
    t.objectStore("states").delete(doc.id);
    for (const b of blobIds) t.objectStore("blobs").delete(b);
  });
}

// blobs: file bytes
export async function putBlob(bytes, id) {
  const blobId = id || uid("b");
  const sealed = await seal(requireKey(), bytes);
  await put("blobs", { id: blobId, owner: state.user.id, size: bytes.length, ...sealed });
  return blobId;
}

export async function getBlob(id) {
  const r = await get("blobs", id);
  if (!r || r.owner !== state.user.id) throw new Error("Dosya bulunamadı.");
  return open(requireKey(), r);
}

export async function deleteBlob(id) {
  await del("blobs", id);
}

// states: the editable layer of a document (pages, annotations, form values)
export async function getState(docId) {
  const r = await get("states", docId);
  if (!r || r.owner !== state.user.id) return null;
  return openJson(requireKey(), r);
}

export async function putState(docId, value) {
  const sealed = await sealJson(requireKey(), value);
  await put("states", { id: docId, owner: state.user.id, ...sealed });
}

export async function deleteState(docId) {
  await del("states", docId);
}

// vault: per-account items — signatures, identity, preferences
export async function getVault(kind, fallback) {
  const r = await get("vault", state.user.id + ":" + kind);
  if (!r) return fallback === undefined ? null : fallback;
  return openJson(requireKey(), r);
}

export async function putVault(kind, value) {
  const sealed = await sealJson(requireKey(), value);
  await put("vault", { id: state.user.id + ":" + kind, owner: state.user.id, ...sealed });
}

export async function storageInfo() {
  let usage = 0;
  let quota = 0;
  let persisted = false;
  try {
    if (navigator.storage && navigator.storage.estimate) ({ usage, quota } = await navigator.storage.estimate());
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
  } catch (e) { /* not supported */ }
  return { usage, quota, persisted };
}

export async function requestPersistence() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; }
}
