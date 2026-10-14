// Writes what the mock PKCS#11 module serves: cert, names, modulus and the key.
import java.io.*;
import java.math.BigInteger;
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;

public class Export {
  public static void main(String[] a) throws Exception {
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (InputStream in = new FileInputStream(a[0])) { ks.load(in, a[1].toCharArray()); }
    String alias = ks.aliases().nextElement();
    X509Certificate c = (X509Certificate) ks.getCertificate(alias);
    PrivateKey k = (PrivateKey) ks.getKey(alias, a[1].toCharArray());
    Path d = Paths.get(a[2]);
    Files.write(d.resolve("cert.der"), c.getEncoded());
    Files.write(d.resolve("subject.der"), c.getSubjectX500Principal().getEncoded());
    Files.write(d.resolve("issuer.der"), c.getIssuerX500Principal().getEncoded());
    RSAPublicKey pub = (RSAPublicKey) c.getPublicKey();
    Files.write(d.resolve("modulus.bin"), unsigned(pub.getModulus()));
    Files.write(d.resolve("exponent.bin"), unsigned(pub.getPublicExponent()));
    String pem = "-----BEGIN PRIVATE KEY-----\n" + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(k.getEncoded()) + "\n-----END PRIVATE KEY-----\n";
    Files.write(d.resolve("key.pem"), pem.getBytes());
    System.out.println("alias=" + alias + " bits=" + pub.getModulus().bitLength());
  }
  static byte[] unsigned(BigInteger b) {
    byte[] x = b.toByteArray();
    if (x.length > 1 && x[0] == 0) return java.util.Arrays.copyOfRange(x, 1, x.length);
    return x;
  }
}
