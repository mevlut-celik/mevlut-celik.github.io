// The pinned Kamu SM issuing CAs (trust.js) must chain to their roots with
// WebCrypto; a tampered copy must not.
import { setup, app } from "../harness.mjs";
await setup();
const S = await app("js/sign.js");
const { ANCHORS } = await app("js/trust.js");
for (const a of ANCHORS.filter((x) => !x.root)) {
  const der = new Uint8Array(Buffer.from(a.der, "base64"));
  console.log(a.name, "->", JSON.stringify(await S.certificateChain(der)));
  const bad = Uint8Array.from(der); bad[bad.length - 10] ^= 0x55;
  console.log("  tampered ->", JSON.stringify(await S.certificateChain(bad)));
}
