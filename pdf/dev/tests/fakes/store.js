// In-memory stand-in for assets/js/store.js, mapped in by ui-dialogs.html.
export const log = [];
const vault = new Map();
export function currentUser() { return { name: "Deneme Kullanıcı", email: "deneme@example.test" }; }
export async function getVault(kind, fallback) { return vault.has(kind) ? vault.get(kind) : (fallback === undefined ? null : fallback); }
export async function putVault(kind, value) { vault.set(kind, value); }
export async function deleteState(id) { log.push(["deleteState", id]); }
export async function putDoc(doc) { log.push(["putDoc", doc && doc.id]); }
export async function putBlob() { return "blob"; }
export async function getBlob() { return new Uint8Array(); }
