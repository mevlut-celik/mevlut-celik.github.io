/* ==========================================================================
   Mühür İmza Köprüsü
   A small local program that lets the Mühür web app (a static site) sign
   PDFs with a qualified e-signature card or token — Kamu SM / TÜBİTAK
   AKİS cards and anything else with a PKCS#11 driver.

   How it fits together:
   - The page builds the whole PAdES / CMS structure itself. It sends the
     bridge only the DER of the signed attributes; the bridge hashes them
     (SHA-256), has the card sign the hash after the PIN is given, and
     returns the signature with the certificate chain.
   - It listens on 127.0.0.1 only, answers only allowed web origins (CORS
     + Host check against DNS rebinding) and never stores or logs a PIN.
   - Requests are served one at a time; a card is a single-threaded device.
   - Every card request logs in with the PIN it brings and logs out when it
     ends, so the card checks the PIN each time. With several cards in, the
     page names one ("slot" from /v1/durum); a PIN is never tried on a card
     the user did not pick.

   Runs on Java 8 and later:
       java -jar MuhurImzaKoprusu.jar          (built with javac --release 8)
       java MuhurImzaKoprusu.java              (JDK 11+, from source)

   Options:
       --lib <path>      PKCS#11 library (default: AKİS driver, found per OS)
       --origin <url>    also allow this web origin (repeatable)
       --p12 <file>      test mode: a .p12/.pfx file instead of a card
       --port <n>        development only: Mühür itself always connects to
                         21730, the default
   ========================================================================== */

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.AuthProvider;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Provider;
import java.security.ProviderException;
import java.security.PublicKey;
import java.security.Security;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.interfaces.ECKey;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collection;
import java.util.Date;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MuhurImzaKoprusu {

  static final String VERSION = "1.0.0";
  static final int DEFAULT_PORT = 21730;
  static final String[] DEFAULT_ORIGINS = {
    "https://mevlut-celik.github.io",
    "http://localhost:4321",
    "http://127.0.0.1:4321",
  };

  /* -------------------------------- Startup ------------------------------- */
  static int port = DEFAULT_PORT;
  static String library = null;
  static String p12 = null;
  static final Set<String> origins = new LinkedHashSet<String>(Arrays.asList(DEFAULT_ORIGINS));

  public static void main(String[] args) throws Exception {
    for (int i = 0; i < args.length; i++) {
      String a = args[i];
      if (a.equals("--lib") && i + 1 < args.length) library = args[++i];
      else if (a.equals("--port") && i + 1 < args.length) port = Integer.parseInt(args[++i]);
      else if (a.equals("--origin") && i + 1 < args.length) origins.add(stripSlash(args[++i]));
      else if (a.equals("--p12") && i + 1 < args.length) p12 = args[++i];
      else if (a.equals("--help") || a.equals("-h")) { usage(); return; }
      else { System.err.println("Bilinmeyen seçenek: " + a); usage(); System.exit(2); }
    }
    if (p12 == null && library == null) library = findLibrary();
    // the relay page (for Safari) is served by the bridge itself
    origins.add("http://127.0.0.1:" + port);
    origins.add("http://localhost:" + port);

    HttpServer server;
    try {
      server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), port), 0);
    } catch (java.net.BindException e) {
      // Mühür only ever calls 21730, so another port is no way out; say
      // whether it is our own bridge or something else holding the port
      if (bridgeAnswers(port)) {
        System.err.println("Mühür İmza Köprüsü zaten çalışıyor (port " + port + "). Açık olan köprü penceresini kullanın.");
      } else {
        System.err.println("Port " + port + " başka bir program tarafından kullanılıyor. Mühür köprüye yalnızca " + DEFAULT_PORT
          + " portundan bağlanır; o programı kapatıp köprüyü yeniden başlatın.");
      }
      System.exit(1);
      return;
    }
    server.createContext("/", MuhurImzaKoprusu::handle);
    server.setExecutor(Executors.newSingleThreadExecutor());
    server.start();

    System.out.println("Mühür İmza Köprüsü " + VERSION + " — http://127.0.0.1:" + port);
    if (port != DEFAULT_PORT) System.out.println("UYARI: Mühür web uygulaması yalnızca " + DEFAULT_PORT + " portuna bağlanır; başka port yalnızca geliştirme içindir.");
    if (p12 != null) System.out.println("Deneme modu: " + p12 + " dosyası kart yerine kullanılıyor.");
    else if (library != null) System.out.println("Kart sürücüsü: " + library);
    else System.out.println("UYARI: Kart sürücüsü (PKCS#11 kütüphanesi) bulunamadı. Kamu SM AKİS sürücüsünü kurun ya da --lib ile yolunu verin.");
    System.out.println("İzin verilen adresler: " + String.join(", ", origins));
    System.out.println("Mühür'de imzalarken bu pencereyi açık bırakın. Kapatmak için Ctrl+C.");
  }

  static void usage() {
    System.out.println("Kullanım: java -jar MuhurImzaKoprusu.jar [--lib <pkcs11 kütüphanesi>] [--origin <url>] [--p12 <dosya>]");
    System.out.println("          --port <n>  yalnızca geliştirme için; Mühür her zaman " + DEFAULT_PORT + " portuna bağlanır.");
  }

  static String stripSlash(String s) { return s.endsWith("/") ? s.substring(0, s.length() - 1) : s; }

  // Whether the program holding the port is a Mühür bridge. Asks for the
  // relay page: it is static, so this never touches a card or its driver.
  static boolean bridgeAnswers(int port) {
    try {
      HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/relay").openConnection(Proxy.NO_PROXY);
      c.setConnectTimeout(1500);
      c.setReadTimeout(3000);
      if (c.getResponseCode() != 200) return false;
      String page = new String(readAll(c.getInputStream(), 1 << 16), StandardCharsets.UTF_8);
      return page.contains("<title>Mühür İmza Köprüsü</title>");
    } catch (Exception e) {
      return false;
    }
  }

  static byte[] readAll(InputStream in, int max) throws java.io.IOException {
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int n;
      while ((n = in.read(buf)) > 0 && out.size() < max) out.write(buf, 0, n);
      return out.toByteArray();
    } finally {
      in.close();
    }
  }

  // The AKİS PKCS#11 library where the Kamu SM installers put it, then a
  // few common generic locations. --lib always wins.
  static String findLibrary() {
    String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
    List<String> c = new ArrayList<String>();
    if (os.contains("win")) {
      String sys = System.getenv("SystemRoot") == null ? "C:\\Windows" : System.getenv("SystemRoot");
      c.add(sys + "\\System32\\akisp11.dll");
      c.add(sys + "\\SysWOW64\\akisp11.dll");
    } else if (os.contains("mac")) {
      c.add("/usr/local/lib/libakisp11.dylib");
      c.add("/opt/homebrew/lib/libakisp11.dylib");
      c.add("/Library/AKIS/libakisp11.dylib");
      c.add("/usr/lib/libakisp11.dylib");
    } else {
      c.add("/usr/lib/libakisp11.so");
      c.add("/opt/Akia/libakisp11.so");
      c.add("/usr/local/lib/libakisp11.so");
      c.add("/usr/lib/x86_64-linux-gnu/libakisp11.so");
      c.add("/usr/lib64/libakisp11.so");
      c.add("/lib/libakisp11.so");
    }
    String env = System.getenv("MUHUR_PKCS11");
    if (env != null && !env.isEmpty()) c.add(0, env);
    for (String p : c) if (new File(p).isFile()) return p;
    // newer Akia packages may keep the module inside their own folders
    String[] roots = os.contains("win") ? new String[] { System.getenv("ProgramFiles"), System.getenv("ProgramFiles(x86)") }
      : os.contains("mac") ? new String[] { "/Applications", "/Library", "/usr/local", "/opt" } : new String[] { "/opt", "/usr/lib", "/usr/local" };
    String name = os.contains("win") ? "akisp11.dll" : os.contains("mac") ? "libakisp11.dylib" : "libakisp11.so";
    for (String r : roots) {
      if (r == null) continue;
      File hit = search(new File(r), name, 0);
      if (hit != null) return hit.getAbsolutePath();
    }
    return null;
  }

  static File search(File dir, String name, int depth) {
    if (depth > 5 || dir == null || !dir.isDirectory()) return null;
    File[] list = dir.listFiles();
    if (list == null) return null;
    for (File f : list) if (f.isFile() && f.getName().equalsIgnoreCase(name)) return f;
    for (File f : list) {
      String n = f.getName().toLowerCase(Locale.ROOT);
      // only walk folders that can plausibly hold the AKİS middleware
      if (f.isDirectory() && (depth > 0 || n.contains("akia") || n.contains("akis") || n.contains("tubitak") || n.contains("bilgem") || n.equals("lib") || n.equals("frameworks"))) {
        File hit = search(f, name, depth + 1);
        if (hit != null) return hit;
      }
    }
    return null;
  }

  /* --------------------------------- HTTP -------------------------------- */
  static void handle(HttpExchange ex) {
    String origin = ex.getRequestHeaders().getFirst("Origin");
    try {
      String host = ex.getRequestHeaders().getFirst("Host");
      // DNS rebinding: only answer requests addressed to the loopback itself
      if (host == null || !(host.equals("127.0.0.1:" + port) || host.equals("localhost:" + port))) {
        send(ex, 403, null, error("ADRES", "Bu köprüye yalnızca 127.0.0.1 üzerinden erişilebilir."));
        return;
      }
      String path = ex.getRequestURI().getPath();
      String method = ex.getRequestMethod();
      if (!allowedCaller(path, origin, ex.getRequestHeaders().getFirst("Sec-Fetch-Site"))) {
        log(ex, 403);
        send(ex, 403, null, error("KAYNAK", origin != null ? "Bu site köprüyü kullanma iznine sahip değil: " + origin
          : "Başka bir siteden gelen istek; köprüyü yalnızca Mühür kullanabilir."));
        return;
      }
      if (method.equals("OPTIONS")) {
        ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        ex.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
        ex.getResponseHeaders().add("Access-Control-Allow-Private-Network", "true");
        ex.getResponseHeaders().add("Access-Control-Max-Age", "600");
        send(ex, 204, origin, null);
        return;
      }
      String result;
      int status = 200;
      try {
        if ((path.equals("/") || path.equals("/relay")) && method.equals("GET")) { relayPage(ex); return; }
        // read inside this try: a bad or oversized body is the caller's
        // error (400/413 with a code), not an unexpected 500
        Map<String, String> body = method.equals("POST") ? Json.parse(readBody(ex)) : new LinkedHashMap<String, String>();
        // POST is accepted too, so the page can ask with an Origin header
        if (path.equals("/v1/durum") && (method.equals("GET") || method.equals("POST"))) result = status();
        else if (path.equals("/v1/sertifikalar") && method.equals("POST")) result = certificates(body);
        else if (path.equals("/v1/imzala") && method.equals("POST")) result = sign(body);
        else { status = 404; result = error("YOK", "Bilinmeyen istek."); }
      } catch (BridgeError e) {
        status = e.status;
        result = error(e.code, e.getMessage());
      }
      log(ex, status);
      send(ex, status, origin, result);
    } catch (Throwable t) {
      // the details go to this window only; the page gets a plain message
      System.out.println("  (beklenmeyen hata: " + t + ")");
      log(ex, 500);
      try {
        send(ex, 500, origin != null && origins.contains(origin) ? origin : null, error("BEKLENMEYEN", "Köprüde beklenmeyen bir hata oluştu; ayrıntı köprü penceresinde."));
      } catch (Exception ignored) { /* client gone */ }
    }
  }

  // Who may call. A web page is known by its Origin, which browsers send
  // with every POST and every cross-origin fetch. A plain GET (an <img
  // src>, a no-cors fetch, a link) carries none, so on /v1/ a missing
  // Origin passes only when Sec-Fetch-Site says the request did not come
  // from another site: the bridge's own relay page ("same-origin") or an
  // address typed by hand ("none"). Programs on this computer send
  // neither header and could forge both; the PIN, which the card checks
  // on every request, is what stops them.
  static boolean allowedCaller(String path, String origin, String site) {
    if (origin != null) return origins.contains(origin);
    if (!path.startsWith("/v1/")) return true;   // the relay page itself is opened as a cross-site navigation
    return site == null || site.equals("same-origin") || site.equals("none");
  }

  /* --------------------------------- Relay ------------------------------- */
  // Safari blocks fetch() from an https page to http://127.0.0.1 as mixed
  // content. Mühür then opens this page in a small window; it relays the
  // same requests to the bridge (same origin) and passes the answers back
  // with postMessage — only to and from the allowed origins.
  static void relayPage(HttpExchange ex) throws java.io.IOException {
    StringBuilder allowed = new StringBuilder("[");
    for (String o : origins) { if (allowed.length() > 1) allowed.append(','); allowed.append(Json.str(o)); }
    allowed.append(']');
    String html = "<!doctype html><html lang=\"tr\"><head><meta charset=\"utf-8\"><title>Mühür İmza Köprüsü</title>"
      + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
      + "<style>body{margin:0;font:14px/1.5 system-ui,-apple-system,sans-serif;background:#f3f1ed;color:#17181c;display:grid;place-items:center;min-height:100vh}"
      + "main{max-width:320px;padding:24px;text-align:center}h1{font-size:16px;margin:0 0 6px}p{margin:0;color:#61646c}"
      + "i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#c0352b;margin-right:6px}</style></head>"
      + "<body><main><h1><i></i>Mühür İmza Köprüsü</h1><p id=\"s\">Mühür ile bağlantı kuruluyor…</p></main><script>"
      + "const A=" + allowed + ";const s=document.getElementById('s');"
      + "if(!window.opener){s.textContent='Bu pencereyi Mühür açar; doğrudan kullanılmaz.';}"
      + "window.addEventListener('message',async(e)=>{if(!A.includes(e.origin))return;const m=e.data;if(!m||m.type!=='muhur-bridge')return;"
      + "if(m.close){window.close();return;}s.textContent=m.label||'İstek iletiliyor…';let reply;"
      + "try{const r=await fetch(m.path,{method:m.method||'GET',headers:m.body?{'Content-Type':'application/json'}:{},body:m.body?JSON.stringify(m.body):undefined});"
      + "reply={type:'muhur-bridge-reply',id:m.id,status:r.status,data:await r.json()};}"
      + "catch(err){reply={type:'muhur-bridge-reply',id:m.id,status:0,data:{ok:false,error:{code:'AG',message:String(err)}}};}"
      + "e.source.postMessage(reply,e.origin);s.textContent='Bağlı. Bu pencere imzalama bitince kapanır.';});"
      + "for(const o of A){try{window.opener&&window.opener.postMessage({type:'muhur-bridge-ready'},o);}catch(e){}}"
      + "</script></body></html>";
    byte[] b = html.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().add("Content-Type", "text/html; charset=utf-8");
    ex.getResponseHeaders().add("Cache-Control", "no-store");
    ex.getResponseHeaders().add("X-Frame-Options", "DENY");
    ex.getResponseHeaders().add("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
    ex.sendResponseHeaders(200, b.length);
    OutputStream os = ex.getResponseBody();
    os.write(b);
    os.close();
    log(ex, 200);
  }

  static void send(HttpExchange ex, int status, String origin, String json) throws java.io.IOException {
    if (origin != null) {
      ex.getResponseHeaders().add("Access-Control-Allow-Origin", origin);
      ex.getResponseHeaders().add("Vary", "Origin");
    }
    ex.getResponseHeaders().add("Cache-Control", "no-store");
    if (json == null) { ex.sendResponseHeaders(status, -1); ex.close(); return; }
    byte[] b = json.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
    ex.sendResponseHeaders(status, b.length);
    OutputStream os = ex.getResponseBody();
    os.write(b);
    os.close();
  }

  static String readBody(HttpExchange ex) throws BridgeError {
    try {
      InputStream in = ex.getRequestBody();
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[8192];
      int n;
      while ((n = in.read(buf)) > 0) {
        out.write(buf, 0, n);
        if (out.size() > 1 << 20) throw new BridgeError(413, "BUYUK", "İstek çok büyük.");
      }
      return new String(out.toByteArray(), StandardCharsets.UTF_8);
    } catch (java.io.IOException e) {
      throw new BridgeError(400, "JSON", "İstek okunamadı.");
    }
  }

  static void log(HttpExchange ex, int status) {
    SimpleDateFormat f = new SimpleDateFormat("HH:mm:ss");
    System.out.println(f.format(new Date()) + "  " + ex.getRequestMethod() + " " + ex.getRequestURI().getPath() + " -> " + status);
  }

  static String error(String code, String message) {
    return "{\"ok\":false,\"error\":{\"code\":" + Json.str(code) + ",\"message\":" + Json.str(message) + "}}";
  }

  static class BridgeError extends Exception {
    final int status;
    final String code;
    BridgeError(int status, String code, String message) { super(message); this.status = status; this.code = code; }
  }

  /* -------------------------------- Tokens ------------------------------- */
  // One SunPKCS11 provider per slot, made on first use and then kept. A
  // provider cannot be dropped cleanly: the JDK keeps the session it opens
  // on the token alive for the life of the program, and on an empty reader
  // it starts a thread that waits for a card. Making one per request (and
  // per status poll) piled up both. A kept provider follows its slot by
  // itself: SunPKCS11 drops the token's services when the card is pulled
  // and registers them again once a card is back.
  static final int MAX_SLOTS = 8;
  static final Map<Integer, Provider> providers = new HashMap<Integer, Provider>();
  static int slotsSeen = -1;

  static Provider newProvider(int slotIndex) throws Exception {
    // quoted so paths with spaces or parentheses parse; forward slashes so
    // the config tokenizer finds no escape sequences in a Windows path
    String cfg = "name=MuhurKart" + slotIndex + "\nlibrary=\"" + library.replace('\\', '/') + "\"\nslotListIndex=" + slotIndex + "\n";
    Provider base = Security.getProvider("SunPKCS11");
    if (base != null) {
      try {
        Method configure = Provider.class.getMethod("configure", String.class);
        return (Provider) configure.invoke(base, "--" + cfg);   // Java 9+
      } catch (NoSuchMethodException e) { /* Java 8 below */ }
    }
    Class<?> c = Class.forName("sun.security.pkcs11.SunPKCS11");
    return (Provider) c.getConstructor(InputStream.class).newInstance(new ByteArrayInputStream(cfg.getBytes(StandardCharsets.UTF_8)));
  }

  // Failures are not kept: a slot whose token or reader is missing now is
  // simply tried again on the next request.
  static synchronized Provider provider(int slot) throws Exception {
    Provider p = providers.get(slot);
    if (p == null) {
      p = newProvider(slot);
      providers.put(slot, p);
    }
    return p;
  }

  // Let go of a kept provider whose token stopped answering (a fixed slot
  // whose card was swapped, a reader that went away); the next look makes
  // a fresh one. This follows a hardware change, so it is rare.
  static synchronized void forget(int slot) {
    Provider p = providers.remove(slot);
    if (p != null) logoutQuietly(p);
  }

  // How many slots the driver lists right now. SunPKCS11 has no call for
  // it, but a slot index far past the end fails with "... only has N
  // slots" right after C_GetSlotList, before any session or thread exists.
  // -1 when the wording is not there; an exception when the driver itself
  // cannot be used.
  static int slotCount() throws Exception {
    try {
      newProvider(999);
    } catch (Exception e) {
      String m = rootMessage(e);
      Matcher n = Pattern.compile("only has (\\d+) slots").matcher(m);
      if (n.find()) return Integer.parseInt(n.group(1));
      if (m.contains("slotListIndex")) return -1;
      throw e;
    }
    return -1;
  }

  // Errors that mean the kept provider's session or slot is gone for good.
  // (A removable slot reports a pulled card as "Token has been removed",
  // and SunPKCS11 recovers from that on its own.)
  static boolean stale(String m) {
    return m.contains("CKR_SESSION_HANDLE_INVALID") || m.contains("CKR_SESSION_CLOSED") || m.contains("CKR_DEVICE_REMOVED")
      || m.contains("CKR_TOKEN_NOT_PRESENT") || m.contains("CKR_TOKEN_NOT_RECOGNIZED") || m.contains("CKR_SLOT_ID_INVALID");
  }

  static boolean noToken(String m) {
    String l = m.toLowerCase(Locale.ROOT);
    return l.contains("ckr_token_not_present") || l.contains("ckr_device_removed") || l.contains("ckr_token_not_recognized")
      || l.contains("token has been removed") || l.contains("token not present") || l.contains("no token")
      // a provider on an empty reader registers no services at all
      || l.contains("pkcs11 not found") || l.contains("no such algorithm: pkcs11");
  }

  static void logoutQuietly(Provider p) {
    try { ((AuthProvider) p).logout(); } catch (Exception e) { /* card gone or not answering */ }
  }

  // Whether the slot's token is there right now, without logging in.
  // logout() is the public call that talks to the token without a PIN
  // (C_GetSessionInfo, and C_Logout only if a login was left over), which
  // makes SunPKCS11 notice a pulled card and drop its services. Unlike
  // KeyStore.load(null, null) it never calls C_Login, so a pinpad reader
  // does not ask for the PIN on every status poll.
  static boolean present(Provider p) throws Exception {
    try {
      ((AuthProvider) p).logout();
    } catch (ProviderException e) {
      if (!noToken(rootMessage(e))) throw e;   // "Token has been removed": the services are gone now
    }
    return p.getService("KeyStore", "PKCS11") != null;
  }

  // One slot. A kept provider that stopped answering is replaced by a fresh
  // one, so a swapped card is found on the same request; a fresh one is
  // not retried (a slot that fails that way is skipped until next time).
  static boolean probe(int slot) throws Exception {
    Provider kept;
    synchronized (MuhurImzaKoprusu.class) { kept = providers.get(slot); }
    if (kept != null) {
      try {
        return present(kept);
      } catch (Exception e) {
        if (!stale(rootMessage(e))) throw e;
        forget(slot);
      }
    }
    return present(provider(slot));
  }

  static class Slots {
    final List<Integer> withToken = new ArrayList<Integer>();
    String error;   // first problem with a slot, kept for when no token is found
  }

  // Every slot that holds a token now, without logging in to any of them.
  static synchronized Slots findTokens() throws BridgeError {
    int count;
    try {
      count = slotCount();
    } catch (Exception e) {
      throw driverError(rootMessage(e));
    }
    // readers coming and going (a USB token is its own reader) can renumber
    // the driver's slot list; the kept providers then no longer match it
    if (count >= 0 && count != slotsSeen) {
      for (Integer s : new ArrayList<Integer>(providers.keySet())) forget(s);
      slotsSeen = count;
    }
    Slots found = new Slots();
    int n = count >= 0 ? Math.min(count, MAX_SLOTS) : MAX_SLOTS;
    for (int slot = 0; slot < n; slot++) {
      try {
        if (probe(slot)) found.withToken.add(slot);
      } catch (Exception e) {
        String m = rootMessage(e);
        if (m.contains("slotListIndex")) break;   // no more slots
        // a fixed slot without a token is normal; anything else is reported
        // only if no card turns up anywhere
        if (!noToken(m) && !stale(m) && found.error == null) found.error = m;
      }
    }
    return found;
  }

  static BridgeError driverError(String m) {
    String arch = System.getProperty("os.arch");
    String hint = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("mac")
      ? " Java " + arch + " mimarisinde; Apple Silicon'da Akia'nın 'Mac OS Arm' paketini kurun." : " Java " + arch + " mimarisinde; sürücüyle aynı (64/32 bit) olmalı.";
    return new BridgeError(500, "SURUCU_HATASI", "Kart sürücüsü yüklenemedi (" + library + ")." + hint + " Ayrıntı:" + m);
  }

  static class Session {
    KeyStore ks;
    Provider provider;
    Integer slot;
  }

  static String rootMessage(Throwable t) {
    StringBuilder sb = new StringBuilder();
    for (Throwable c = t; c != null; c = c.getCause()) sb.append(' ').append(c.getClass().getSimpleName()).append(':').append(c.getMessage());
    return sb.toString();
  }

  // Open the card (or the test .p12) and log in with the PIN. The PIN goes
  // to one token only: the slot the page names, or the only token present.
  // With several tokens and no choice nothing is sent, so a PIN meant for
  // one card can never use up the tries of another.
  static Session open(char[] pin, Integer slot) throws BridgeError {
    if (p12 != null) {
      try {
        KeyStore ks = KeyStore.getInstance("PKCS12");
        FileInputStream in = new FileInputStream(p12);
        try { ks.load(in, pin); } finally { in.close(); }
        Session s = new Session();
        s.ks = ks;
        s.slot = 0;   // the one "token" /v1/durum lists in test mode
        return s;
      } catch (Exception e) {
        throw new BridgeError(401, "PIN_HATALI", "Deneme dosyası açılamadı: parola hatalı olabilir.");
      }
    }
    if (library == null) throw new BridgeError(503, "SURUCU_YOK", "Kart sürücüsü bulunamadı. Kamu SM AKİS sürücüsünü kurun ya da köprüyü --lib <yol> ile başlatın.");
    Slots found = findTokens();
    if (slot == null) {
      if (found.withToken.size() > 1) {
        throw new BridgeError(409, "KART_SEC", "Birden fazla e-imza kartı/token'ı takılı. PIN yanlış karta gitmesin diye hiçbirine gönderilmedi; kullanmayacağınız kartı çıkarıp tekrar deneyin.");
      }
      if (found.withToken.isEmpty()) {
        if (found.error != null) throw new BridgeError(500, "KART_HATASI", "Kart açılamadı:" + found.error);
        throw new BridgeError(404, "KART_YOK", "Takılı bir e-imza kartı bulunamadı. Kartı/token'ı takıp tekrar deneyin.");
      }
      slot = found.withToken.get(0);
    } else if (!found.withToken.contains(slot)) {
      throw new BridgeError(404, "KART_YOK", "Seçilen kart artık takılı değil. Kartı/token'ı takıp tekrar deneyin.");
    }
    // with several cards in, errors name the one the PIN went to ("Kart 2", as /v1/durum lists it)
    String which = found.withToken.size() > 1 ? " (Kart " + (found.withToken.indexOf(slot) + 1) + ")" : "";
    Provider p;
    try {
      p = provider(slot);
    } catch (Exception e) {
      throw new BridgeError(500, "KART_HATASI", "Kart açılamadı:" + rootMessage(e));
    }
    try {
      // A PKCS#11 login holds for the whole program, every session and
      // provider included, and SunPKCS11 skips C_Login while one is active.
      // Log out first so the card really checks this request's PIN; if
      // that fails, stop here rather than sign on an older login.
      ((AuthProvider) p).logout();
      KeyStore ks = KeyStore.getInstance("PKCS11", p);
      try {
        ks.load(null, pin);
      } catch (Exception e) {
        // pinpad readers take the PIN on their own keypad
        if (!rootMessage(e).contains("protected authentication path")) throw e;
        System.out.println("PIN'i kart okuyucunun tuş takımından girin…");
        ks.load(null, null);
      }
      Session s = new Session();
      s.ks = ks;
      s.provider = p;
      s.slot = slot;
      return s;
    } catch (Exception e) {
      logoutQuietly(p);
      String m = rootMessage(e);
      if (m.contains("CKR_PIN_INCORRECT") || m.contains("CKR_PIN_LEN_RANGE") || m.contains("CKR_PIN_INVALID")) {
        throw new BridgeError(401, "PIN_HATALI", "PIN hatalı" + which + ". Art arda yanlış girişler kartı bloke eder; dikkatli deneyin.");
      }
      if (m.contains("CKR_PIN_LOCKED")) throw new BridgeError(423, "PIN_BLOKE", "Kartın" + which + " PIN'i kilitlenmiş. Yeni PIN'i Kamu SM Online İşlemler > PIN Oluşturma/Kilit Çözme'den oluşturun. PUK denemeyin: yanlış PUK kartı kalıcı olarak kullanılamaz hale getirir.");
      if (m.contains("CKR_PIN_EXPIRED")) throw new BridgeError(423, "PIN_SURESI", "PIN'in süresi dolmuş; kart yönetim aracıyla değiştirin.");
      // no PIN typed and the card has no keypad: SunPKCS11 stops before C_Login
      if (pin == null && (m.contains("no password provided") || m.contains("callback handler"))) throw new BridgeError(400, "PIN_GEREKLI", "PIN girilmedi.");
      if (stale(m)) forget(slot);
      if (noToken(m) || stale(m)) throw new BridgeError(404, "KART_YOK", "Kart çıkarılmış ya da yanıt vermiyor. Kartı/token'ı takıp tekrar deneyin.");
      throw new BridgeError(500, "KART_HATASI", "Kart açılamadı:" + m);
    }
  }

  // End of every card request: log out, so nothing stays signed in between
  // requests and the next one has to bring its own PIN.
  static void close(Session s) {
    if (s != null && s.provider != null) logoutQuietly(s.provider);
  }

  // After a failed card operation: a provider whose session died is replaced.
  static void forgetIfStale(Session s, String m) {
    if (s != null && s.provider != null && stale(m)) forget(s.slot);
  }

  // -> card: "var" | "yok" | "deneme" | "bilinmiyor" | "hata:…", and tokens:
  //    [{ slot, label }] for the page to pick from when there are several
  static String status() {
    String card = "bilinmiyor";
    StringBuilder tokens = new StringBuilder("[");
    if (p12 != null) {
      card = "deneme";
      tokens.append("{\"slot\":0,\"label\":").append(Json.str("Deneme dosyası")).append('}');
    } else if (library != null) {
      try {
        Slots found = findTokens();
        card = !found.withToken.isEmpty() ? "var" : found.error != null ? "hata:" + found.error : "yok";
        for (int i = 0; i < found.withToken.size(); i++) {
          if (i > 0) tokens.append(',');
          tokens.append("{\"slot\":").append(found.withToken.get(i)).append(",\"label\":").append(Json.str("Kart " + (i + 1))).append('}');
        }
      } catch (BridgeError e) {
        card = "hata:" + e.getMessage();
      }
    }
    return "{\"ok\":true,\"app\":\"Mühür İmza Köprüsü\",\"version\":" + Json.str(VERSION)
      + ",\"mode\":" + Json.str(p12 != null ? "p12" : "pkcs11")
      + ",\"library\":" + (library == null ? "null" : Json.str(library))
      + ",\"card\":" + Json.str(card)
      + ",\"tokens\":" + tokens.append(']')
      + ",\"java\":" + Json.str(System.getProperty("java.version"))
      + ",\"os\":" + Json.str(System.getProperty("os.name") + " " + System.getProperty("os.arch")) + "}";
  }

  // null on a card when no PIN was typed: a reader with its own keypad
  // then asks for it (C_Login with no PIN); any other card refuses before
  // a login is tried (PIN_GEREKLI below). The test file always needs one.
  static char[] pinOf(Map<String, String> body) throws BridgeError {
    String pin = body.get("pin");
    if (pin != null && !pin.isEmpty()) return pin.toCharArray();
    if (p12 == null) return null;
    throw new BridgeError(400, "PIN_GEREKLI", "PIN girilmedi.");
  }

  static void clear(char[] pin) { if (pin != null) Arrays.fill(pin, '\0'); }

  // The token to use, as /v1/durum listed it ("tokens"[].slot). Optional:
  // without it the only token present is used.
  static Integer slotOf(Map<String, String> body) throws BridgeError {
    String v = body.get("slot");
    if (v == null || v.isEmpty()) return null;
    try {
      int n = Integer.parseInt(v.trim());
      if (n >= 0 && n < MAX_SLOTS) return n;
    } catch (NumberFormatException e) { /* below */ }
    throw new BridgeError(400, "KART_SECIMI", "Geçersiz kart seçimi: " + v);
  }

  // -> certificates, and the slot they came from, for the page to send
  //    back with /v1/imzala
  static String certificates(Map<String, String> body) throws BridgeError {
    Integer slot = slotOf(body);
    char[] pin = pinOf(body);
    Session s = null;
    try {
      s = open(pin, slot);
      StringBuilder sb = new StringBuilder("{\"ok\":true,\"slot\":").append(s.slot).append(",\"certificates\":[");
      boolean first = true;
      Enumeration<String> aliases = s.ks.aliases();
      while (aliases.hasMoreElements()) {
        String alias = aliases.nextElement();
        if (!s.ks.isKeyEntry(alias)) continue;
        Certificate c = s.ks.getCertificate(alias);
        if (!(c instanceof X509Certificate)) continue;
        X509Certificate x = (X509Certificate) c;
        if (!first) sb.append(',');
        first = false;
        sb.append("{\"id\":").append(Json.str(alias))
          .append(",\"subject\":").append(Json.str(x.getSubjectX500Principal().getName()))
          .append(",\"issuer\":").append(Json.str(x.getIssuerX500Principal().getName()))
          .append(",\"notAfter\":").append(Json.str(iso(x.getNotAfter())))
          .append(",\"keyAlg\":").append(Json.str(keyAlg(x.getPublicKey())))
          .append(",\"signing\":").append(signingUse(x) ? "true" : "false")
          .append(",\"der\":").append(Json.str(Base64.getEncoder().encodeToString(x.getEncoded())))
          .append('}');
      }
      return sb.append("]}").toString();
    } catch (BridgeError e) {
      throw e;
    } catch (Exception e) {
      String m = rootMessage(e);
      forgetIfStale(s, m);
      throw new BridgeError(500, "KART_HATASI", "Sertifikalar okunamadı:" + m);
    } finally {
      close(s);
      clear(pin);
    }
  }

  // nonRepudiation (bit 1) is what a qualified signing certificate carries;
  // digitalSignature (bit 0) is accepted too.
  static boolean signingUse(X509Certificate x) {
    boolean[] ku = x.getKeyUsage();
    return ku == null || (ku.length > 1 && ku[1]) || (ku.length > 0 && ku[0]);
  }

  static String keyAlg(PublicKey k) {
    if (k instanceof ECKey || "EC".equals(k.getAlgorithm())) return "ECDSA";
    return k.getAlgorithm();
  }

  static String iso(Date d) {
    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
    f.setTimeZone(TimeZone.getTimeZone("UTC"));
    return f.format(d);
  }

  /* -------------------------------- Signing ------------------------------ */
  static final byte[] SHA256_DIGEST_INFO = {
    0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, (byte) 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20,
  };
  static final byte[] SHA384_DIGEST_INFO = {
    0x30, 0x41, 0x30, 0x0d, 0x06, 0x09, 0x60, (byte) 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02, 0x05, 0x00, 0x04, 0x30,
  };
  static final byte[] SHA512_DIGEST_INFO = {
    0x30, 0x51, 0x30, 0x0d, 0x06, 0x09, 0x60, (byte) 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03, 0x05, 0x00, 0x04, 0x40,
  };

  static String sign(Map<String, String> body) throws BridgeError {
    Integer slot = slotOf(body);
    String id = body.get("id");
    String data64 = body.get("data");
    if (id == null || data64 == null) throw new BridgeError(400, "EKSIK", "İmzalanacak veri ya da sertifika seçilmedi.");
    String hash = body.get("hash") == null ? "SHA-256" : body.get("hash");
    if (!(hash.equals("SHA-256") || hash.equals("SHA-384") || hash.equals("SHA-512"))) throw new BridgeError(400, "OZET", "Desteklenmeyen özet algoritması: " + hash);
    byte[] data;
    try { data = Base64.getDecoder().decode(data64); } catch (IllegalArgumentException e) { throw new BridgeError(400, "VERI", "Veri base64 değil."); }
    char[] pin = pinOf(body);   // last, so every path after it clears it
    Session s = null;
    try {
      s = open(pin, slot);
      if (!s.ks.isKeyEntry(id)) throw new BridgeError(404, "SERTIFIKA_YOK", "Seçilen sertifika kartta bulunamadı.");
      PrivateKey key = (PrivateKey) s.ks.getKey(id, p12 != null ? pin : null);
      X509Certificate cert = (X509Certificate) s.ks.getCertificate(id);
      String alg = keyAlg(cert.getPublicKey());
      String jca = hash.replace("-", "") + (alg.equals("ECDSA") ? "withECDSA" : "withRSA");   // e.g. SHA384withECDSA
      byte[] sig = alg.equals("ECDSA") ? toDerEcdsa(signWith(s, jca, key, data)) : signRsa(s, jca, hash, key, data);
      // check the card's answer with the certificate before handing it out
      Signature check = Signature.getInstance(jca);
      check.initVerify(cert.getPublicKey());
      check.update(data);
      if (!check.verify(sig)) throw new BridgeError(500, "IMZA_DOGRULANAMADI", "Kartın ürettiği imza sertifikayla doğrulanamadı.");

      List<X509Certificate> chain = chainOf(cert, s.ks.getCertificateChain(id));
      StringBuilder sb = new StringBuilder("{\"ok\":true,\"keyAlg\":").append(Json.str(alg))
        .append(",\"hash\":").append(Json.str(hash))
        .append(",\"signature\":").append(Json.str(Base64.getEncoder().encodeToString(sig)))
        .append(",\"chain\":[");
      for (int i = 0; i < chain.size(); i++) {
        if (i > 0) sb.append(',');
        sb.append(Json.str(Base64.getEncoder().encodeToString(chain.get(i).getEncoded())));
      }
      return sb.append("]}").toString();
    } catch (BridgeError e) {
      throw e;
    } catch (Exception e) {
      String m = rootMessage(e);
      forgetIfStale(s, m);
      if (m.contains("CKR_PIN") || m.contains("CKR_USER_NOT_LOGGED_IN")) throw new BridgeError(401, "PIN_HATALI", "Kart imzalamak için PIN istedi; PIN'i kontrol edin.");
      throw new BridgeError(500, "IMZA_HATASI", "Kart imzalayamadı:" + m);
    } finally {
      close(s);
      clear(pin);
    }
  }

  // "SHAxxxwithRSA/ECDSA" exists in every SunPKCS11 since Java 8: the token
  // hashes (CKM_SHA256_RSA_PKCS, CKM_ECDSA_SHA384…) or, when it cannot, the
  // JDK hashes and the token does the raw CKM_RSA_PKCS / CKM_ECDSA.
  static byte[] signWith(Session s, String jca, PrivateKey key, byte[] data) throws Exception {
    Signature sg = s.provider != null ? Signature.getInstance(jca, s.provider) : Signature.getInstance(jca);
    sg.initSign(key);
    sg.update(data);
    return sg.sign();
  }

  static byte[] signRsa(Session s, String jca, String hash, PrivateKey key, byte[] data) throws Exception {
    try {
      return signWith(s, jca, key, data);
    } catch (java.security.NoSuchAlgorithmException e) {
      if (s.provider == null) throw e;
    }
    // last resort for unusual modules: PKCS#1 v1.5 over our own DigestInfo
    byte[] prefix = hash.equals("SHA-384") ? SHA384_DIGEST_INFO : hash.equals("SHA-512") ? SHA512_DIGEST_INFO : SHA256_DIGEST_INFO;
    byte[] digest = MessageDigest.getInstance(hash).digest(data);
    byte[] info = new byte[prefix.length + digest.length];
    System.arraycopy(prefix, 0, info, 0, prefix.length);
    System.arraycopy(digest, 0, info, prefix.length, digest.length);
    javax.crypto.Cipher c = javax.crypto.Cipher.getInstance("RSA/ECB/PKCS1Padding", s.provider);
    c.init(javax.crypto.Cipher.ENCRYPT_MODE, key);
    return c.doFinal(info);
  }

  // Some providers return ECDSA as r||s; CMS wants DER SEQUENCE { r, s }.
  static byte[] toDerEcdsa(byte[] sig) {
    if (sig.length > 0 && sig[0] == 0x30) return sig;
    int n = sig.length / 2;
    byte[] r = unsignedInt(Arrays.copyOfRange(sig, 0, n));
    byte[] s = unsignedInt(Arrays.copyOfRange(sig, n, sig.length));
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(0x30);
    writeLen(out, r.length + s.length + 4);
    out.write(0x02); writeLen(out, r.length); out.write(r, 0, r.length);
    out.write(0x02); writeLen(out, s.length); out.write(s, 0, s.length);
    return out.toByteArray();
  }

  static byte[] unsignedInt(byte[] v) {
    int i = 0;
    while (i < v.length - 1 && v[i] == 0) i++;
    byte[] t = Arrays.copyOfRange(v, i, v.length);
    if ((t[0] & 0x80) != 0) { byte[] u = new byte[t.length + 1]; System.arraycopy(t, 0, u, 1, t.length); return u; }
    return t;
  }

  static void writeLen(ByteArrayOutputStream out, int len) {
    if (len < 128) { out.write(len); return; }
    out.write(0x81);
    out.write(len);
  }

  /* --------------------------------- Chain ------------------------------- */
  // The card usually holds only the user's certificate. The issuing CAs are
  // fetched from the certificate's AIA (caIssuers) URLs, best effort, so
  // readers can build the path to the Kamu SM root.
  static List<X509Certificate> chainOf(X509Certificate leaf, Certificate[] onCard) {
    List<X509Certificate> out = new ArrayList<X509Certificate>();
    if (onCard != null) for (Certificate c : onCard) if (c instanceof X509Certificate && !c.equals(leaf)) out.add((X509Certificate) c);
    X509Certificate cur = out.isEmpty() ? leaf : out.get(out.size() - 1);
    for (int depth = 0; depth < 4; depth++) {
      if (cur.getSubjectX500Principal().equals(cur.getIssuerX500Principal())) break;
      X509Certificate next = null;
      for (String url : caIssuerUrls(cur)) {
        next = fetchIssuer(url, cur);
        if (next != null) break;
      }
      if (next == null || out.contains(next)) break;
      out.add(next);
      cur = next;
    }
    return out;
  }

  static final byte[] ID_AD_CA_ISSUERS = { 0x2B, 6, 1, 5, 5, 7, 0x30, 2 };   // 1.3.6.1.5.5.7.48.2

  // AuthorityInfoAccess ::= SEQUENCE OF AccessDescription { accessMethod
  // OID, accessLocation GeneralName }. Walked by its DER lengths, keeping
  // the http(s) URIs ([6]) of the caIssuers entries. (Scanning the bytes
  // for text ran on into the next entry when caIssuers was not the last.)
  static List<String> caIssuerUrls(X509Certificate cert) {
    List<String> urls = new ArrayList<String>();
    byte[] ext = cert.getExtensionValue("1.3.6.1.5.5.7.1.1");
    if (ext == null) return urls;
    try {
      byte[] seq = der(der(ext, new int[] { 0 }, 0x04), new int[] { 0 }, 0x30);   // OCTET STRING { SEQUENCE OF }
      int[] at = { 0 };
      while (at[0] < seq.length) {
        byte[] ad = der(seq, at, 0x30);
        int[] in = { 0 };
        byte[] method = der(ad, in, 0x06);
        if (in[0] >= ad.length) continue;
        int tag = ad[in[0]] & 0xff;
        byte[] location = der(ad, in, tag);
        if (tag != 0x86 || !Arrays.equals(method, ID_AD_CA_ISSUERS)) continue;   // OCSP and non-URI names
        String u = new String(location, StandardCharsets.US_ASCII);
        if (u.startsWith("http://") || u.startsWith("https://")) urls.add(u);
      }
    } catch (RuntimeException e) {
      // malformed extension: no URLs, the chain stays as the card gave it
    }
    return urls;
  }

  // The contents of the DER element at pos[0], which must have this tag;
  // moves pos[0] past it. Short and long (1-3 byte) lengths. A truncated
  // element throws (IllegalArgumentException or ArrayIndexOutOfBounds).
  static byte[] der(byte[] b, int[] pos, int tag) {
    int i = pos[0];
    if ((b[i++] & 0xff) != tag) throw new IllegalArgumentException("DER etiketi");
    int len = b[i++] & 0xff;
    if (len >= 0x80) {
      int n = len & 0x7f;
      if (n < 1 || n > 3) throw new IllegalArgumentException("DER uzunluğu");
      len = 0;
      while (n-- > 0) len = (len << 8) | (b[i++] & 0xff);
    }
    if (len > b.length - i) throw new IllegalArgumentException("DER uzunluğu");
    pos[0] = i + len;
    return Arrays.copyOfRange(b, i, i + len);
  }

  static X509Certificate fetchIssuer(String url, X509Certificate child) {
    try {
      HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
      c.setConnectTimeout(4000);
      c.setReadTimeout(6000);
      c.setInstanceFollowRedirects(true);
      byte[] body = readAll(c.getInputStream(), 1 << 20);
      Collection<? extends Certificate> certs = CertificateFactory.getInstance("X.509").generateCertificates(new ByteArrayInputStream(body));
      for (Certificate cert : certs) {
        X509Certificate x = (X509Certificate) cert;
        if (x.getSubjectX500Principal().equals(child.getIssuerX500Principal())) {
          try { child.verify(x.getPublicKey()); return x; } catch (Exception e) { /* not the issuer */ }
        }
      }
    } catch (Exception e) {
      System.out.println("  (zincir: " + url + " indirilemedi)");
    }
    return null;
  }

  /* --------------------------------- JSON -------------------------------- */
  // Just enough JSON for flat request objects of strings, and for writing.
  static final class Json {
    static String str(String s) {
      StringBuilder sb = new StringBuilder("\"");
      for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        switch (c) {
          case '"': sb.append("\\\""); break;
          case '\\': sb.append("\\\\"); break;
          case '\n': sb.append("\\n"); break;
          case '\r': sb.append("\\r"); break;
          case '\t': sb.append("\\t"); break;
          default:
            if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
      }
      return sb.append('"').toString();
    }

    static Map<String, String> parse(String s) throws BridgeError {
      Map<String, String> m = new LinkedHashMap<String, String>();
      int[] i = { 0 };
      skip(s, i);
      if (i[0] >= s.length() || s.charAt(i[0]) != '{') throw bad();
      i[0]++;
      skip(s, i);
      if (i[0] < s.length() && s.charAt(i[0]) == '}') return m;
      while (true) {
        skip(s, i);
        String k = string(s, i);
        skip(s, i);
        if (i[0] >= s.length() || s.charAt(i[0]) != ':') throw bad();
        i[0]++;
        skip(s, i);
        String v;
        if (i[0] < s.length() && s.charAt(i[0]) == '"') v = string(s, i);
        else {
          int st = i[0];
          while (i[0] < s.length() && ",} \n\r\t".indexOf(s.charAt(i[0])) < 0) i[0]++;
          v = s.substring(st, i[0]);
          if (v.isEmpty()) throw bad();
          if (v.equals("null")) v = null;
        }
        m.put(k, v);
        skip(s, i);
        if (i[0] < s.length() && s.charAt(i[0]) == ',') { i[0]++; continue; }
        if (i[0] < s.length() && s.charAt(i[0]) == '}') return m;
        throw bad();
      }
    }

    static void skip(String s, int[] i) { while (i[0] < s.length() && Character.isWhitespace(s.charAt(i[0]))) i[0]++; }

    static String string(String s, int[] i) throws BridgeError {
      if (i[0] >= s.length() || s.charAt(i[0]) != '"') throw bad();
      i[0]++;
      StringBuilder sb = new StringBuilder();
      while (i[0] < s.length()) {
        char c = s.charAt(i[0]++);
        if (c == '"') return sb.toString();
        if (c == '\\') {
          if (i[0] >= s.length()) throw bad();
          char e = s.charAt(i[0]++);
          switch (e) {
            case 'n': sb.append('\n'); break;
            case 'r': sb.append('\r'); break;
            case 't': sb.append('\t'); break;
            case 'b': sb.append('\b'); break;
            case 'f': sb.append('\f'); break;
            case 'u': sb.append(hex4(s, i)); break;
            default: sb.append(e);
          }
        } else sb.append(c);
      }
      throw bad();
    }

    // the four hex digits of a "u" escape: ASCII only and exactly four
    // (Integer.parseInt would also take a sign, Character.digit other
    // scripts' digits)
    static char hex4(String s, int[] i) throws BridgeError {
      if (i[0] + 4 > s.length()) throw bad();
      int cp = 0;
      for (int k = 0; k < 4; k++) {
        char h = s.charAt(i[0]++);
        int d = h >= '0' && h <= '9' ? h - '0' : h >= 'a' && h <= 'f' ? h - 'a' + 10 : h >= 'A' && h <= 'F' ? h - 'A' + 10 : -1;
        if (d < 0) throw bad();
        cp = (cp << 4) | d;
      }
      return (char) cp;
    }

    static BridgeError bad() { return new BridgeError(400, "JSON", "İstek okunamadı."); }
  }
}
