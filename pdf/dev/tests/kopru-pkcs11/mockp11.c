/* A mock PKCS#11 v2.40 module for testing Mühür İmza Köprüsü without a card
 * (used by ../kopru-pkcs11.mjs, which builds it).
 *
 * Slots and tokens come from a state file (MOCKP11_STATE), re-read on every
 * call, so a test can insert, remove or swap tokens while the bridge runs:
 *     one line per slot:  "empty"  |  "token <pin> [pinpad]"
 * Login state is per token for the whole program, as in PKCS#11: C_Login
 * with the token already logged in returns CKR_USER_ALREADY_LOGGED_IN, and
 * closing the last session logs out. Every C_Login / C_Logout / signature
 * is appended to MOCKP11_LOG. Each token holds one RSA key (CKA_PRIVATE)
 * and its certificate, read from MOCKP11_DIR; signatures are made with
 * /usr/bin/openssl so they verify.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef unsigned char CK_BYTE;
typedef CK_BYTE CK_BBOOL;
typedef unsigned long CK_ULONG;
typedef CK_ULONG CK_RV, CK_FLAGS, CK_SLOT_ID, CK_SESSION_HANDLE, CK_OBJECT_HANDLE, CK_USER_TYPE, CK_MECHANISM_TYPE, CK_ATTRIBUTE_TYPE;

typedef struct { CK_BYTE major, minor; } CK_VERSION;
typedef struct { CK_VERSION cryptokiVersion; CK_BYTE manufacturerID[32]; CK_FLAGS flags; CK_BYTE libraryDescription[32]; CK_VERSION libraryVersion; } CK_INFO;
typedef struct { CK_BYTE slotDescription[64]; CK_BYTE manufacturerID[32]; CK_FLAGS flags; CK_VERSION hardwareVersion, firmwareVersion; } CK_SLOT_INFO;
typedef struct {
  CK_BYTE label[32]; CK_BYTE manufacturerID[32]; CK_BYTE model[16]; CK_BYTE serialNumber[16]; CK_FLAGS flags;
  CK_ULONG ulMaxSessionCount, ulSessionCount, ulMaxRwSessionCount, ulRwSessionCount, ulMaxPinLen, ulMinPinLen,
    ulTotalPublicMemory, ulFreePublicMemory, ulTotalPrivateMemory, ulFreePrivateMemory;
  CK_VERSION hardwareVersion, firmwareVersion; CK_BYTE utcTime[16];
} CK_TOKEN_INFO;
typedef struct { CK_SLOT_ID slotID; CK_ULONG state; CK_FLAGS flags; CK_ULONG ulDeviceError; } CK_SESSION_INFO;
typedef struct { CK_ATTRIBUTE_TYPE type; void *pValue; CK_ULONG ulValueLen; } CK_ATTRIBUTE;
typedef struct { CK_MECHANISM_TYPE mechanism; void *pParameter; CK_ULONG ulParameterLen; } CK_MECHANISM;
typedef struct { CK_ULONG ulMinKeySize, ulMaxKeySize; CK_FLAGS flags; } CK_MECHANISM_INFO;
typedef struct { CK_VERSION version; void *f[68]; } CK_FUNCTION_LIST;

#define OK 0x0UL
#define R_SLOT_ID_INVALID 0x3UL
#define R_GENERAL_ERROR 0x5UL
#define R_ARGUMENTS_BAD 0x7UL
#define R_ATTRIBUTE_TYPE_INVALID 0x12UL
#define R_DEVICE_REMOVED 0x32UL
#define R_FUNCTION_NOT_SUPPORTED 0x54UL
#define R_KEY_HANDLE_INVALID 0x60UL
#define R_MECHANISM_INVALID 0x70UL
#define R_OBJECT_HANDLE_INVALID 0x82UL
#define R_OPERATION_NOT_INITIALIZED 0x91UL
#define R_PIN_INCORRECT 0xA0UL
#define R_PIN_LOCKED 0xA4UL
#define R_SESSION_HANDLE_INVALID 0xB3UL
#define R_SESSION_PARALLEL_NOT_SUPPORTED 0xB4UL
#define R_TOKEN_NOT_PRESENT 0xE0UL
#define R_USER_ALREADY_LOGGED_IN 0x100UL
#define R_USER_NOT_LOGGED_IN 0x101UL
#define R_BUFFER_TOO_SMALL 0x150UL
#define R_CRYPTOKI_ALREADY_INITIALIZED 0x191UL
#define UNAVAILABLE (~0UL)

#define MAXSLOTS 8
#define MAXSESS 512

static int initialized;
static char statePath[1024], logPath[1024], dataDir[1024];

typedef struct { int present; char pin[32]; int pinpad; int loggedIn; int gen; int tries; } Slot;
static Slot slots[MAXSLOTS];
static int nslots;

typedef struct {
  int open, slot, gen;
  CK_OBJECT_HANDLE found[4]; int nfound, findPos, finding;
  int signing; CK_MECHANISM_TYPE mech; unsigned char *buf; size_t len;
} Sess;
static Sess sess[MAXSESS];

static unsigned char *certDer, *subjDer, *issuerDer, *modulus, *exponent;
static size_t certLen, subjLen, issuerLen, modLen, expLen;

static void logf_(const char *fmt, int slot, const char *what) {
  FILE *f = fopen(logPath, "a");
  if (!f) return;
  fprintf(f, fmt, slot, what);
  fputc('\n', f);
  fclose(f);
}

static unsigned char *readFile(const char *name, size_t *len) {
  char p[1200];
  snprintf(p, sizeof p, "%s/%s", dataDir, name);
  FILE *f = fopen(p, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  unsigned char *b = malloc(n > 0 ? n : 1);
  *len = fread(b, 1, n, f);
  fclose(f);
  return b;
}

// Re-read the state file; a token that went away loses its sessions and login.
static void refresh(void) {
  FILE *f = fopen(statePath, "r");
  if (!f) return;
  char line[256];
  int n = 0;
  while (n < MAXSLOTS && fgets(line, sizeof line, f)) {
    char kind[32] = "", pin[32] = "", extra[32] = "";
    if (sscanf(line, "%31s %31s %31s", kind, pin, extra) < 1) continue;
    int present = strcmp(kind, "token") == 0;
    Slot *s = &slots[n];
    if (s->present && !present) {
      s->loggedIn = 0;
      s->gen++;
      for (int i = 0; i < MAXSESS; i++) if (sess[i].open && sess[i].slot == n) sess[i].open = 0;
    } else if (!s->present && present) {
      s->gen++;
      s->tries = 3;
    }
    s->present = present;
    if (present) { memset(s->pin, 0, sizeof s->pin); strncpy(s->pin, pin, sizeof s->pin - 1); s->pinpad = strcmp(extra, "pinpad") == 0; }
    n++;
  }
  fclose(f);
  // readers that went away take their token, sessions and login with them
  for (int i = n; i < nslots; i++) {
    if (slots[i].present) slots[i].gen++;
    slots[i].present = 0;
    slots[i].loggedIn = 0;
    for (int k = 0; k < MAXSESS; k++) if (sess[k].open && sess[k].slot == i) sess[k].open = 0;
  }
  nslots = n;
}

static void pad(CK_BYTE *dst, size_t n, const char *s) { memset(dst, ' ', n); memcpy(dst, s, strlen(s) < n ? strlen(s) : n); }

static Sess *session(CK_SESSION_HANDLE h, CK_RV *rv) {
  refresh();
  if (h < 1 || h > MAXSESS || !sess[h - 1].open) { *rv = R_SESSION_HANDLE_INVALID; return NULL; }
  Sess *s = &sess[h - 1];
  if (!slots[s->slot].present) { *rv = R_DEVICE_REMOVED; return NULL; }
  if (slots[s->slot].gen != s->gen) { *rv = R_SESSION_HANDLE_INVALID; return NULL; }
  *rv = OK;
  return s;
}

static CK_RV C_Initialize(void *args) {
  (void) args;
  if (initialized) return R_CRYPTOKI_ALREADY_INITIALIZED;
  const char *e;
  if (!(e = getenv("MOCKP11_STATE"))) return R_GENERAL_ERROR;
  strncpy(statePath, e, sizeof statePath - 1);
  if (!(e = getenv("MOCKP11_LOG"))) return R_GENERAL_ERROR;
  strncpy(logPath, e, sizeof logPath - 1);
  if (!(e = getenv("MOCKP11_DIR"))) return R_GENERAL_ERROR;
  strncpy(dataDir, e, sizeof dataDir - 1);
  certDer = readFile("cert.der", &certLen);
  subjDer = readFile("subject.der", &subjLen);
  issuerDer = readFile("issuer.der", &issuerLen);
  modulus = readFile("modulus.bin", &modLen);
  exponent = readFile("exponent.bin", &expLen);
  if (!certDer || !subjDer || !issuerDer || !modulus || !exponent) return R_GENERAL_ERROR;
  initialized = 1;
  refresh();
  logf_("INIT slots=%d%s", nslots, "");
  return OK;
}

static CK_RV C_Finalize(void *r) { (void) r; initialized = 0; return OK; }

static CK_RV C_GetInfo(CK_INFO *i) {
  memset(i, 0, sizeof *i);
  i->cryptokiVersion.major = 2; i->cryptokiVersion.minor = 40;
  pad(i->manufacturerID, 32, "Muhur Test");
  pad(i->libraryDescription, 32, "Mock PKCS11");
  i->libraryVersion.major = 1;
  return OK;
}

CK_RV C_GetFunctionList(CK_FUNCTION_LIST **pp);

static CK_RV C_GetSlotList(CK_BBOOL tokenPresent, CK_SLOT_ID *list, CK_ULONG *count) {
  refresh();
  CK_ULONG n = 0;
  for (int i = 0; i < nslots; i++) if (!tokenPresent || slots[i].present) n++;
  if (!list) { *count = n; return OK; }
  if (*count < n) { *count = n; return R_BUFFER_TOO_SMALL; }
  n = 0;
  for (int i = 0; i < nslots; i++) if (!tokenPresent || slots[i].present) list[n++] = 10 + i;   // slot IDs differ from indexes
  *count = n;
  return OK;
}

static int slotIndex(CK_SLOT_ID id) { int i = (int) id - 10; return i >= 0 && i < nslots ? i : -1; }

static CK_RV C_GetSlotInfo(CK_SLOT_ID id, CK_SLOT_INFO *info) {
  refresh();
  int i = slotIndex(id);
  if (i < 0) return R_SLOT_ID_INVALID;
  memset(info, 0, sizeof *info);
  pad(info->slotDescription, 64, "Mock reader");
  pad(info->manufacturerID, 32, "Muhur Test");
  info->flags = 0x2UL | 0x4UL | (slots[i].present ? 0x1UL : 0);   // removable, hardware, token present
  return OK;
}

static CK_RV C_GetTokenInfo(CK_SLOT_ID id, CK_TOKEN_INFO *t) {
  refresh();
  int i = slotIndex(id);
  if (i < 0) return R_SLOT_ID_INVALID;
  if (!slots[i].present) return R_TOKEN_NOT_PRESENT;
  memset(t, 0, sizeof *t);
  char label[40];
  snprintf(label, sizeof label, "Mock token %d", i);
  pad(t->label, 32, label);
  pad(t->manufacturerID, 32, "Muhur Test");
  pad(t->model, 16, "Mock");
  pad(t->serialNumber, 16, "0001");
  // write protected (sessions are read-only), login required, PIN set
  t->flags = 0x2UL | 0x4UL | 0x8UL | 0x400UL | (slots[i].pinpad ? 0x100UL : 0);
  t->ulMaxSessionCount = 0; t->ulMaxRwSessionCount = 0;   // CK_EFFECTIVELY_INFINITE
  t->ulMaxPinLen = 16; t->ulMinPinLen = 4;
  t->ulTotalPublicMemory = t->ulFreePublicMemory = t->ulTotalPrivateMemory = t->ulFreePrivateMemory = UNAVAILABLE;
  return OK;
}

static const CK_MECHANISM_TYPE mechs[] = { 0x1UL, 0x40UL, 0x41UL, 0x42UL };   // RSA_PKCS, SHA256/384/512_RSA_PKCS

static CK_RV C_GetMechanismList(CK_SLOT_ID id, CK_MECHANISM_TYPE *list, CK_ULONG *count) {
  refresh();
  int i = slotIndex(id);
  if (i < 0) return R_SLOT_ID_INVALID;
  if (!slots[i].present) return R_TOKEN_NOT_PRESENT;
  CK_ULONG n = sizeof mechs / sizeof mechs[0];
  if (!list) { *count = n; return OK; }
  if (*count < n) { *count = n; return R_BUFFER_TOO_SMALL; }
  memcpy(list, mechs, sizeof mechs);
  *count = n;
  return OK;
}

static CK_RV C_GetMechanismInfo(CK_SLOT_ID id, CK_MECHANISM_TYPE m, CK_MECHANISM_INFO *info) {
  (void) id;
  for (size_t k = 0; k < sizeof mechs / sizeof mechs[0]; k++) if (mechs[k] == m) {
    info->ulMinKeySize = 1024; info->ulMaxKeySize = 4096; info->flags = 0x1UL | 0x800UL | 0x2000UL;   // HW, SIGN, VERIFY
    return OK;
  }
  return R_MECHANISM_INVALID;
}

static CK_RV C_OpenSession(CK_SLOT_ID id, CK_FLAGS flags, void *app, void *notify, CK_SESSION_HANDLE *h) {
  (void) app; (void) notify;
  refresh();
  int i = slotIndex(id);
  if (i < 0) return R_SLOT_ID_INVALID;
  if (!slots[i].present) return R_TOKEN_NOT_PRESENT;
  if (!(flags & 0x4UL)) return R_SESSION_PARALLEL_NOT_SUPPORTED;
  if (flags & 0x2UL) return 0xE2UL;   // CKR_TOKEN_WRITE_PROTECTED
  for (int k = 0; k < MAXSESS; k++) if (!sess[k].open) {
    memset(&sess[k], 0, sizeof sess[k]);
    sess[k].open = 1; sess[k].slot = i; sess[k].gen = slots[i].gen;
    *h = k + 1;
    return OK;
  }
  return R_GENERAL_ERROR;
}

static int openSessions(int slot) { int n = 0; for (int k = 0; k < MAXSESS; k++) if (sess[k].open && sess[k].slot == slot) n++; return n; }

static CK_RV C_CloseSession(CK_SESSION_HANDLE h) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  s->open = 0;
  if (openSessions(s->slot) == 0 && slots[s->slot].loggedIn) {   // the last session takes the login with it
    slots[s->slot].loggedIn = 0;
    logf_("LOGOUT_LASTCLOSE slot=%d%s", s->slot, "");
  }
  return OK;
}

static CK_RV C_CloseAllSessions(CK_SLOT_ID id) {
  int i = slotIndex(id);
  if (i < 0) return R_SLOT_ID_INVALID;
  for (int k = 0; k < MAXSESS; k++) if (sess[k].open && sess[k].slot == i) sess[k].open = 0;
  slots[i].loggedIn = 0;
  return OK;
}

static CK_RV C_GetSessionInfo(CK_SESSION_HANDLE h, CK_SESSION_INFO *info) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  info->slotID = 10 + s->slot;
  info->state = slots[s->slot].loggedIn ? 1 : 0;   // CKS_RO_USER_FUNCTIONS / CKS_RO_PUBLIC_SESSION
  info->flags = 0x4UL;
  info->ulDeviceError = 0;
  return OK;
}

static CK_RV C_Login(CK_SESSION_HANDLE h, CK_USER_TYPE user, CK_BYTE *pin, CK_ULONG len) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  if (user != 1) return 0x103UL;   // CKR_USER_TYPE_INVALID
  Slot *t = &slots[s->slot];
  if (t->loggedIn) { logf_("LOGIN slot=%d -> %s", s->slot, "ALREADY_LOGGED_IN"); return R_USER_ALREADY_LOGGED_IN; }
  if (t->tries <= 0) { logf_("LOGIN slot=%d -> %s", s->slot, "LOCKED"); return R_PIN_LOCKED; }
  if (pin == NULL) {
    if (!t->pinpad) return R_ARGUMENTS_BAD;
    t->loggedIn = 1;
    logf_("LOGIN slot=%d -> %s", s->slot, "PINPAD_PROMPT_OK");
    return OK;
  }
  if (len != strlen(t->pin) || memcmp(pin, t->pin, len) != 0) {
    t->tries--;
    logf_("LOGIN slot=%d -> %s", s->slot, "PIN_INCORRECT");
    return t->tries <= 0 ? R_PIN_LOCKED : R_PIN_INCORRECT;
  }
  t->tries = 3;
  t->loggedIn = 1;
  logf_("LOGIN slot=%d -> %s", s->slot, "OK");
  return OK;
}

static CK_RV C_Logout(CK_SESSION_HANDLE h) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  if (!slots[s->slot].loggedIn) return R_USER_NOT_LOGGED_IN;
  slots[s->slot].loggedIn = 0;
  logf_("LOGOUT slot=%d%s", s->slot, "");
  return OK;
}

/* Objects: 1 = certificate (public), 2 = RSA private key (private). */
static const CK_BYTE T = 1, F = 0;
static const CK_ULONG CLS_CERT = 1, CLS_PKEY = 3, KT_RSA = 0, CT_X509 = 0;
static const char LABEL[] = "imza";
static const CK_BYTE ID[] = { 0x01 };

static int attr(CK_OBJECT_HANDLE o, CK_ATTRIBUTE_TYPE t, const void **v, CK_ULONG *len) {
#define SET(p, n) do { *v = (p); *len = (n); return 1; } while (0)
  if (t == 0x0) SET(o == 1 ? &CLS_CERT : &CLS_PKEY, sizeof(CK_ULONG));   // CKA_CLASS
  if (t == 0x1) SET(&T, 1);                                                // CKA_TOKEN
  if (t == 0x2) SET(o == 1 ? &F : &T, 1);                                  // CKA_PRIVATE
  if (t == 0x3) SET(LABEL, sizeof LABEL - 1);                              // CKA_LABEL
  if (t == 0x102) SET(ID, sizeof ID);                                      // CKA_ID
  if (t == 0x101) SET(subjDer, subjLen);                                   // CKA_SUBJECT
  if (o == 1) {
    if (t == 0x11) SET(certDer, certLen);                                  // CKA_VALUE
    if (t == 0x80) SET(&CT_X509, sizeof(CK_ULONG));                        // CKA_CERTIFICATE_TYPE
    if (t == 0x81) SET(issuerDer, issuerLen);                              // CKA_ISSUER
  } else {
    if (t == 0x100) SET(&KT_RSA, sizeof(CK_ULONG));                        // CKA_KEY_TYPE
    if (t == 0x103 || t == 0x108) SET(&T, 1);                              // CKA_SENSITIVE, CKA_SIGN
    if (t == 0x162 || t == 0x202 || t == 0x105) SET(&F, 1);                // CKA_EXTRACTABLE, CKA_ALWAYS_AUTHENTICATE, CKA_DECRYPT
    if (t == 0x120) SET(modulus, modLen);                                  // CKA_MODULUS
    if (t == 0x122) SET(exponent, expLen);                                 // CKA_PUBLIC_EXPONENT
  }
  return 0;
#undef SET
}

static int visible(Sess *s, CK_OBJECT_HANDLE o) { return o == 1 || (o == 2 && slots[s->slot].loggedIn); }

static CK_RV C_GetAttributeValue(CK_SESSION_HANDLE h, CK_OBJECT_HANDLE o, CK_ATTRIBUTE *tmpl, CK_ULONG n) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  if (!visible(s, o)) return R_OBJECT_HANDLE_INVALID;
  CK_RV out = OK;
  for (CK_ULONG k = 0; k < n; k++) {
    const void *v; CK_ULONG len;
    if (!attr(o, tmpl[k].type, &v, &len)) { tmpl[k].ulValueLen = UNAVAILABLE; out = R_ATTRIBUTE_TYPE_INVALID; continue; }
    if (tmpl[k].pValue == NULL) tmpl[k].ulValueLen = len;
    else if (tmpl[k].ulValueLen < len) { tmpl[k].ulValueLen = UNAVAILABLE; out = R_BUFFER_TOO_SMALL; }
    else { memcpy(tmpl[k].pValue, v, len); tmpl[k].ulValueLen = len; }
  }
  return out;
}

static CK_RV C_FindObjectsInit(CK_SESSION_HANDLE h, CK_ATTRIBUTE *tmpl, CK_ULONG n) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  s->nfound = 0; s->findPos = 0; s->finding = 1;
  for (CK_OBJECT_HANDLE o = 1; o <= 2; o++) {
    if (!visible(s, o)) continue;
    int match = 1;
    for (CK_ULONG k = 0; k < n && match; k++) {
      const void *v; CK_ULONG len;
      if (!attr(o, tmpl[k].type, &v, &len) || len != tmpl[k].ulValueLen || memcmp(v, tmpl[k].pValue, len) != 0) match = 0;
    }
    if (match) s->found[s->nfound++] = o;
  }
  return OK;
}

static CK_RV C_FindObjects(CK_SESSION_HANDLE h, CK_OBJECT_HANDLE *out, CK_ULONG max, CK_ULONG *count) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  if (!s->finding) return R_OPERATION_NOT_INITIALIZED;
  CK_ULONG n = 0;
  while (n < max && s->findPos < s->nfound) out[n++] = s->found[s->findPos++];
  *count = n;
  return OK;
}

static CK_RV C_FindObjectsFinal(CK_SESSION_HANDLE h) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  s->finding = 0;
  return OK;
}

static CK_RV C_SignInit(CK_SESSION_HANDLE h, CK_MECHANISM *m, CK_OBJECT_HANDLE key) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  if (key != 2) return R_KEY_HANDLE_INVALID;
  if (!slots[s->slot].loggedIn) return R_USER_NOT_LOGGED_IN;
  int ok = 0;
  for (size_t k = 0; k < sizeof mechs / sizeof mechs[0]; k++) if (mechs[k] == m->mechanism) ok = 1;
  if (!ok) return R_MECHANISM_INVALID;
  free(s->buf);
  s->buf = NULL; s->len = 0; s->signing = 1; s->mech = m->mechanism;
  return OK;
}

static CK_RV C_SignUpdate(CK_SESSION_HANDLE h, CK_BYTE *data, CK_ULONG len) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  if (!s->signing) return R_OPERATION_NOT_INITIALIZED;
  s->buf = realloc(s->buf, s->len + len + 1);
  memcpy(s->buf + s->len, data, len);
  s->len += len;
  return OK;
}

// openssl signs the collected data with the token's key
static CK_RV finish(Sess *s, CK_BYTE *sig, CK_ULONG *sigLen) {
  if (!sig) { *sigLen = modLen; return OK; }
  if (*sigLen < modLen) { *sigLen = modLen; return R_BUFFER_TOO_SMALL; }
  s->signing = 0;
  if (!slots[s->slot].loggedIn) return R_USER_NOT_LOGGED_IN;
  char in[1200], out[1200], cmd[4000];
  snprintf(in, sizeof in, "%s/sign-in.bin", dataDir);
  snprintf(out, sizeof out, "%s/sign-out.bin", dataDir);
  FILE *f = fopen(in, "wb");
  fwrite(s->buf ? s->buf : (unsigned char *) "", 1, s->len, f);
  fclose(f);
  const char *dg = s->mech == 0x40UL ? "sha256" : s->mech == 0x41UL ? "sha384" : s->mech == 0x42UL ? "sha512" : NULL;
  if (dg) snprintf(cmd, sizeof cmd, "/usr/bin/openssl dgst -%s -sign '%s/key.pem' -out '%s' '%s'", dg, dataDir, out, in);
  else snprintf(cmd, sizeof cmd, "/usr/bin/openssl rsautl -sign -inkey '%s/key.pem' -in '%s' -out '%s'", dataDir, in, out);
  if (system(cmd) != 0) return R_GENERAL_ERROR;
  size_t n;
  unsigned char *b = readFile("sign-out.bin", &n);
  if (!b || n != modLen) return R_GENERAL_ERROR;
  memcpy(sig, b, n);
  *sigLen = n;
  free(b);
  free(s->buf);
  s->buf = NULL; s->len = 0;
  logf_("SIGN slot=%d mech=%s", s->slot, dg ? dg : "raw");
  return OK;
}

static CK_RV C_SignFinal(CK_SESSION_HANDLE h, CK_BYTE *sig, CK_ULONG *sigLen) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  if (!s->signing) return R_OPERATION_NOT_INITIALIZED;
  return finish(s, sig, sigLen);
}

static CK_RV C_Sign(CK_SESSION_HANDLE h, CK_BYTE *data, CK_ULONG len, CK_BYTE *sig, CK_ULONG *sigLen) {
  CK_RV rv;
  Sess *s = session(h, &rv);
  if (!s) return rv;
  if (!s->signing) return R_OPERATION_NOT_INITIALIZED;
  if (sig && *sigLen >= modLen) {
    s->buf = realloc(s->buf, s->len + len + 1);
    memcpy(s->buf + s->len, data, len);
    s->len += len;
  }
  return finish(s, sig, sigLen);
}

static CK_RV notSupported(void) { return R_FUNCTION_NOT_SUPPORTED; }

static CK_FUNCTION_LIST list;

__attribute__((visibility("default"))) CK_RV C_GetFunctionList(CK_FUNCTION_LIST **pp) {
  list.version.major = 2; list.version.minor = 40;
  for (int i = 0; i < 68; i++) list.f[i] = (void *) notSupported;
  list.f[0] = (void *) C_Initialize;
  list.f[1] = (void *) C_Finalize;
  list.f[2] = (void *) C_GetInfo;
  list.f[3] = (void *) C_GetFunctionList;
  list.f[4] = (void *) C_GetSlotList;
  list.f[5] = (void *) C_GetSlotInfo;
  list.f[6] = (void *) C_GetTokenInfo;
  list.f[7] = (void *) C_GetMechanismList;
  list.f[8] = (void *) C_GetMechanismInfo;
  list.f[12] = (void *) C_OpenSession;
  list.f[13] = (void *) C_CloseSession;
  list.f[14] = (void *) C_CloseAllSessions;
  list.f[15] = (void *) C_GetSessionInfo;
  list.f[18] = (void *) C_Login;
  list.f[19] = (void *) C_Logout;
  list.f[24] = (void *) C_GetAttributeValue;
  list.f[26] = (void *) C_FindObjectsInit;
  list.f[27] = (void *) C_FindObjects;
  list.f[28] = (void *) C_FindObjectsFinal;
  list.f[42] = (void *) C_SignInit;
  list.f[43] = (void *) C_Sign;
  list.f[44] = (void *) C_SignUpdate;
  list.f[45] = (void *) C_SignFinal;
  *pp = &list;
  return OK;
}

