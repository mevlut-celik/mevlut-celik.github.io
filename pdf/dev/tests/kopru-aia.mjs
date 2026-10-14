// The bridge's AIA reader (caIssuerUrls) on certificates whose caIssuers
// entry comes before OCSP, after it, twice, or not at all. It used to read
// text up to the next unprintable byte and so ran into the next entry.
//   node tests/kopru-aia.mjs
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const JAR = path.resolve(here, "../../kopru/MuhurImzaKoprusu.jar");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "muhur-aia-"));
const CA = "http://depo.kamusm.gov.tr/nes/kokshs.v7.crt";
const CA2 = "http://depo.kamusm.gov.tr/nes/ara.crt";
const OCSP = "http://ocsp.kamusm.gov.tr";
const cases = [
  ["caIssuers, then OCSP", `caIssuers:uri:${CA},ocsp:uri:${OCSP}`, [CA]],
  ["OCSP, then caIssuers", `ocsp:uri:${OCSP},caIssuers:uri:${CA}`, [CA]],
  ["two caIssuers", `caIssuers:uri:${CA},caIssuers:uri:${CA2},ocsp:uri:${OCSP}`, [CA, CA2]],
  ["OCSP only", `ocsp:uri:${OCSP}`, []],
  ["no AIA", null, []],
];

// calls the bridge's own method on each certificate given
fs.writeFileSync(path.join(work, "Aia.java"), `
import java.io.FileInputStream;
import java.lang.reflect.Method;
import java.security.cert.*;
public class Aia {
  public static void main(String[] a) throws Exception {
    Method m = Class.forName("MuhurImzaKoprusu").getDeclaredMethod("caIssuerUrls", X509Certificate.class);
    m.setAccessible(true);
    for (String f : a) {
      X509Certificate c = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new FileInputStream(f));
      StringBuilder line = new StringBuilder();
      for (Object u : (java.util.List<?>) m.invoke(null, c)) line.append(line.length() > 0 ? " " : "").append(u);
      System.out.println(line);
    }
  }
}`);

const files = cases.map(([, ext], i) => {
  const ks = path.join(work, `k${i}.p12`), der = path.join(work, `c${i}.der`);
  execFileSync("keytool", ["-genkeypair", "-alias", "a", "-keyalg", "EC", "-groupname", "secp256r1", "-storetype", "PKCS12",
    "-keystore", ks, "-storepass", "246810", "-dname", "CN=AIA Deneme", ...(ext ? ["-ext", `aia=${ext}`] : [])], { stdio: "ignore" });
  execFileSync("keytool", ["-exportcert", "-alias", "a", "-keystore", ks, "-storepass", "246810", "-file", der], { stdio: "ignore" });
  return der;
});
const got = execFileSync("java", ["-cp", JAR, path.join(work, "Aia.java"), ...files]).toString().split("\n");
let failed = 0;
cases.forEach(([name, , want], i) => {
  const urls = got[i] ? got[i].split(" ") : [];
  const ok = JSON.stringify(urls) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  -> ${JSON.stringify(urls)}, want ${JSON.stringify(want)}`}`);
});
fs.rmSync(work, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
