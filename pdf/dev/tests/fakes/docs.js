// Stand-in for assets/js/docs.js: addVersion records the call and waits
// as long as the test says (ctl.saveMs), like a large PDF being written.
export const ctl = { calls: [], saveMs: 0 };
export async function addVersion(doc, bytes, label) {
  ctl.calls.push(label);
  await new Promise((r) => setTimeout(r, ctl.saveMs));
  return doc;
}
