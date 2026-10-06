/* ==========================================================================
   Mühür — sigui.js
   Everything the user sees about signing:
   - the signature pad (draw with pressure-like width, type in a script
     face, or upload a photo with the paper taken out), saved per account;
   - the digital signing dialog and its visible-field picker;
   - the digital identity manager (self-signed or .p12/.pfx);
   - verification cards for the signatures already in a document.
   ========================================================================== */

import { E } from "./ed.js";
import * as store from "./store.js";
import { $, $$, h, icon, esc, toast, dialog, confirmDialog, promptDialog, menu, busy, pickFiles } from "./ui.js";
import { pdflib, forge, fontBytes } from "./libs.js";
import { uid, formatDateTime, formatDate, downloadBytes, safeFileName, base64ToBytes, tzLabel } from "./util.js";
import { createSelfSignedIdentity, importP12, describeIdentity, identityCertDer, signPdf } from "./sign.js";
import { isPristine, auditInfo, displayToPdf, apply } from "./pdfwork.js";
import { addVersion } from "./docs.js";

const INKS = [["#111111", "Siyah"], ["#1d3fbf", "Mavi"], ["#0b4d2c", "Yeşil"]];
const SCRIPTS = [["Dancing Script", 600], ["Great Vibes", 400], ["Caveat", 500], ["Allura", 400]];

/* ============================ Saved signatures ========================== */
async function signatures() {
  if (E.open) return E.signatures;
  return store.getVault("signatures", []);
}
async function saveSignatures(list) {
  E.signatures = list;
  await store.putVault("signatures", list);
}

export function signatureTiles(onPick, opts) {
  const wrap = h("div.sigs");
  const draw = (list) => {
    wrap.textContent = "";
    for (const sig of list) {
      const tile = h("button.sigtile", { type: "button", title: sig.kind === "initials" ? "Paraf" : "İmza", onclick: () => onPick(sig) },
        h("span.sigtile__kind", { text: sig.kind === "initials" ? "PARAF" : "İMZA" }),
        h("img", { src: sig.url, alt: "" }));
      const del = h("span.ibtn.ibtn--sm.sigtile__del", { role: "button", title: "Sil", "aria-label": "Sil", html: icon("x") });
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!(await confirmDialog({ title: "İmza silinsin mi?", message: "Belgelere daha önce yerleştirilmiş kopyalar etkilenmez.", confirm: "Sil", danger: true }))) return;
        const next = (await signatures()).filter((s) => s.id !== sig.id);
        await saveSignatures(next);
        draw(next);
      });
      tile.append(del);
      wrap.append(tile);
    }
    if (!(opts && opts.noAdd)) {
      wrap.append(h("button.sigtile.sigtile--add", { type: "button", html: icon("plus") + "<span>Yeni imza</span>", onclick: async () => { const s = await createSignature("signature"); if (s) { draw(await signatures()); onPick(s); } } }));
      wrap.append(h("button.sigtile.sigtile--add", { type: "button", html: icon("plus") + "<span>Yeni paraf</span>", onclick: async () => { const s = await createSignature("initials"); if (s) { draw(await signatures()); onPick(s); } } }));
    }
  };
  signatures().then(draw);
  return wrap;
}

export function signatureMenu(anchor, onPick) {
  const tiles = signatureTiles((sig) => { import("./ui.js").then((u) => u.closeMenu()); onPick(sig); });
  tiles.style.padding = "4px";
  tiles.style.width = "280px";
  menu(anchor, [{ head: "İmzalarım" }, { node: tiles }], { noFocus: true });
}

export function openSignMenu(anchor) {
  menu(anchor, [
    { label: "İmzamı ekle", sub: "Çizilmiş, yazılmış ya da yüklenmiş imza", icon: "signature", onClick: () => { if (E.signatures.some((s) => s.kind !== "initials")) E.setTool("signature"); else createSignature("signature").then((s) => s && E.setTool("signature", s)); } },
    { label: "Paraf ekle", icon: "pen-tool", onClick: () => { const s = E.signatures.find((x) => x.kind === "initials"); if (s) E.setTool("initials", s); else createSignature("initials").then((x) => x && E.setTool("initials", x)); } },
    { label: "Tarih ekle", icon: "calendar", onClick: () => E.setTool("date") },
    "sep",
    { label: "Dijital olarak imzala…", sub: "Kriptografik imza (PAdES)", icon: "file-pen-line", onClick: () => openDigitalSign() },
    { label: "İmza paneli", sub: "Belgedeki imzaları doğrula", icon: "shield-check", onClick: () => import("./panels.js").then((p) => p.showPanel("signatures")) },
  ], { align: "right" });
}

/* ============================ Signature pad ============================= */
export function createSignature(kind) {
  const user = store.currentUser();
  const isInit = kind === "initials";
  let tab = "draw";
  let ink = INKS[0][0];
  let result = null;

  // --- draw
  const surface = h("div.pad__surface");
  const canvas = h("canvas");
  surface.append(canvas, h("span.pad__line"), h("span.pad__x", { text: "×" }), h("span.pad__hint", { text: isInit ? "Parafını buraya çiz" : "İmzanı buraya çiz" }));
  const strokes = [];
  let ratio = 1;
  const ctx = canvas.getContext("2d");
  const fit = () => {
    const r = surface.getBoundingClientRect();
    ratio = Math.min(4, (window.devicePixelRatio || 1) * 2);
    canvas.width = Math.round(r.width * ratio);
    canvas.height = Math.round(r.height * ratio);
    redraw();
  };
  const redraw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s, ratio);
    surface.querySelector(".pad__hint").style.display = strokes.length ? "none" : "";
  };
  let cur = null;
  surface.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);
    const r = surface.getBoundingClientRect();
    cur = { color: ink, pts: [{ x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, w: null }] };
    strokes.push(cur);
    redraw();
  });
  surface.addEventListener("pointermove", (e) => {
    if (!cur) return;
    const r = surface.getBoundingClientRect();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top, t: ev.timeStamp };
      const last = cur.pts[cur.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.8) continue;
      cur.pts.push(p);
    }
    redraw();
  });
  const end = () => { cur = null; };
  surface.addEventListener("pointerup", end);
  surface.addEventListener("pointercancel", end);

  const inkDots = (onPick) => {
    const row = h("div.inkdots");
    for (const [c, label] of INKS) {
      row.append(h("button.swatch", { type: "button", class: "swatch" + (c === ink ? " is-active" : ""), style: { background: c }, title: label, "aria-label": label, onclick: (e) => {
        ink = c;
        $$(".inkdots .swatch", body).forEach((s) => s.classList.toggle("is-active", s.style.background === e.currentTarget.style.background));
        onPick();
      } }));
    }
    return row;
  };

  const drawPane = h("div.pad", {}, surface, h("div.pad__bar", {},
    inkDots(() => { for (const s of strokes) s.color = ink; redraw(); }),
    h("div.toggle-row", {},
      h("button.btn.btn--sm.btn--ghost", { type: "button", html: icon("undo-2") + "Geri al", onclick: () => { strokes.pop(); redraw(); } }),
      h("button.btn.btn--sm.btn--ghost", { type: "button", html: icon("eraser") + "Temizle", onclick: () => { strokes.length = 0; redraw(); } }))));

  // --- type
  const nameInput = h("input.input", { type: "text", value: isInit ? (user && user.initials) || "" : (user && user.name) || "", "aria-label": "Metin" });
  let script = SCRIPTS[0][0];
  const typed = h("div.typed");
  const drawTyped = () => {
    typed.textContent = "";
    for (const [f, wgt] of SCRIPTS) {
      typed.append(h("button.typed__opt", { type: "button", class: "typed__opt" + (f === script ? " is-active" : ""), style: { fontFamily: `"${f}", cursive`, fontWeight: wgt, color: ink }, text: nameInput.value || "İmza", onclick: () => { script = f; drawTyped(); } }));
    }
  };
  nameInput.addEventListener("input", drawTyped);
  nameInput.addEventListener("keydown", (e) => e.stopPropagation());
  const typePane = h("div.pad", { hidden: true }, h("label.field", {}, h("span.field__label", { text: isInit ? "Parafın" : "Adın" }), nameInput), typed, h("div.pad__bar", {}, inkDots(drawTyped), h("span.fineprint", { text: "Yazı tipini seçmek için tıkla." })));

  // --- upload
  let uploaded = null;
  const upInput = h("input", { type: "file", accept: "image/*", hidden: true });
  const removeBg = h("input", { type: "checkbox", checked: true });
  const preview = h("div.upload", { html: icon("upload", "icon--lg") + "<span>İmzanın fotoğrafını ya da taramasını seç<br><small>Beyaz kâğıt üzerinde koyu mürekkep en iyi sonucu verir</small></span>" });
  preview.addEventListener("click", () => upInput.click());
  const refreshUpload = async () => {
    if (!uploaded) return;
    const url = await cleanImage(uploaded, removeBg.checked);
    preview.innerHTML = "";
    preview.append(h("img", { src: url, alt: "Yüklenen imza" }));
    preview.dataset.url = url;
  };
  upInput.addEventListener("change", async () => {
    const f = upInput.files && upInput.files[0];
    if (!f) return;
    uploaded = await loadImage(f);
    refreshUpload();
  });
  removeBg.addEventListener("change", refreshUpload);
  const upPane = h("div.pad", { hidden: true }, preview, upInput, h("label.check", {}, removeBg, h("span", { text: "Arka planı kaldır (kâğıdı saydam yap)" })));

  const seg = h("div.segment", { role: "tablist" });
  const panes = { draw: drawPane, type: typePane, upload: upPane };
  for (const [k, label] of [["draw", "Çiz"], ["type", "Yaz"], ["upload", "Yükle"]]) {
    seg.append(h("button.segment__btn", { type: "button", class: "segment__btn" + (k === tab ? " is-active" : ""), text: label, onclick: () => {
      tab = k;
      $$(".segment__btn", seg).forEach((b) => b.classList.toggle("is-active", b.textContent === label));
      for (const [pk, pane] of Object.entries(panes)) pane.hidden = pk !== k;
      if (k === "type") { drawTyped(); nameInput.focus(); }
    } }));
  }
  const body = h("div", { style: { display: "grid", gap: "14px" } }, seg, drawPane, typePane, upPane,
    h("p.fineprint", { text: "İmzan yalnızca bu hesapta, şifreli olarak saklanır." }));

  const d = dialog({
    title: isInit ? "Paraf oluştur" : "İmza oluştur",
    body,
    size: "md",
    actions: [
      { label: "Vazgeç", value: null },
      { label: "Kaydet ve kullan", kind: "primary", onClick: async () => {
        let out = null;
        if (tab === "draw") {
          if (!strokes.length) { toast("Önce imzanı çiz.", "warn"); return false; }
          out = await exportStrokes(strokes, surface.getBoundingClientRect(), ratio);
        } else if (tab === "type") {
          if (!nameInput.value.trim()) { toast("Bir metin yaz.", "warn"); return false; }
          out = await exportTyped(nameInput.value.trim(), script, SCRIPTS.find((s) => s[0] === script)[1], ink, isInit);
        } else {
          if (!preview.dataset.url) { toast("Bir görsel seç.", "warn"); return false; }
          out = await trimDataUrl(preview.dataset.url);
        }
        if (!out) return false;
        const sig = { id: uid("sg"), kind: isInit ? "initials" : "signature", url: out.url, w: out.w, h: out.h, created: Date.now() };
        const list = [sig, ...(await signatures())].slice(0, 16);
        await saveSignatures(list);
        result = sig;
        return sig;
      } },
    ],
    onOpen: () => requestAnimationFrame(fit),
  });
  return d.result.then((v) => v || result);
}

function drawStroke(c, s, ratio) {
  const pts = s.pts;
  c.fillStyle = s.color;
  c.strokeStyle = s.color;
  c.lineCap = "round";
  c.lineJoin = "round";
  const maxW = 3.1, minW = 0.9;
  let v = 0;
  let w = (maxW + minW) / 2;
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0].x * ratio, pts[0].y * ratio, (w / 2) * ratio, 0, Math.PI * 2);
    c.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dt = Math.max(1, b.t - a.t);
    const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;
    v = 0.7 * v + 0.3 * speed;
    const target = Math.max(minW, maxW / (1 + v * 1.4));
    const nw = w * 0.6 + target * 0.4;
    // quadratic through midpoints for a smooth line
    const p0 = i > 1 ? mid(pts[i - 2], a) : a;
    const p1 = mid(a, b);
    c.lineWidth = ((w + nw) / 2) * ratio;
    c.beginPath();
    c.moveTo(p0.x * ratio, p0.y * ratio);
    c.quadraticCurveTo(a.x * ratio, a.y * ratio, p1.x * ratio, p1.y * ratio);
    c.stroke();
    w = nw;
  }
  const last = pts[pts.length - 1], prev = mid(pts[pts.length - 2], last);
  c.beginPath();
  c.moveTo(prev.x * ratio, prev.y * ratio);
  c.lineTo(last.x * ratio, last.y * ratio);
  c.stroke();
}
function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

async function exportStrokes(strokes, rect, ratio) {
  const c = document.createElement("canvas");
  const scale = Math.max(ratio, 3);
  c.width = Math.round(rect.width * scale);
  c.height = Math.round(rect.height * scale);
  const cx = c.getContext("2d");
  for (const s of strokes) drawStroke(cx, s, scale);
  return trimCanvas(c);
}

async function exportTyped(text, font, weight, color, isInit) {
  await document.fonts.load(`${weight} 120px "${font}"`, text).catch(() => null);
  const c = document.createElement("canvas");
  const cx = c.getContext("2d");
  const size = 150;
  cx.font = `${weight} ${size}px "${font}", cursive`;
  const w = Math.ceil(cx.measureText(text).width) + size;
  c.width = w;
  c.height = Math.round(size * 1.9);
  cx.font = `${weight} ${size}px "${font}", cursive`;
  cx.fillStyle = color;
  cx.textBaseline = "alphabetic";
  cx.fillText(text, size / 2, size * 1.25);
  void isInit;
  return trimCanvas(c);
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Görsel okunamadı."));
    img.src = url;
  });
}

async function cleanImage(img, removeBg) {
  const max = 1400;
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * s);
  c.height = Math.round(img.naturalHeight * s);
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0, c.width, c.height);
  if (removeBg) {
    const data = cx.getImageData(0, 0, c.width, c.height);
    const d = data.data;
    // estimate paper brightness from the brightest tenth of pixels
    const lums = [];
    for (let i = 0; i < d.length; i += 4 * 16) lums.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    lums.sort((a, b) => a - b);
    const paper = lums[Math.floor(lums.length * 0.9)] || 240;
    const hi = paper - 18, lo = Math.max(40, paper - 110);
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const a = l >= hi ? 0 : l <= lo ? 1 : (hi - l) / (hi - lo);
      d[i + 3] = Math.round(d[i + 3] * a);
      // deepen the remaining ink a little
      if (a > 0) { d[i] *= 0.85; d[i + 1] *= 0.85; d[i + 2] *= 0.85; }
    }
    cx.putImageData(data, 0, 0);
  }
  return (await trimCanvas(c)).url;
}

async function trimDataUrl(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return trimCanvas(c);
}

function trimCanvas(c) {
  const cx = c.getContext("2d", { willReadFrequently: true });
  const { data, width, height } = cx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) { toast("Boş görünüyor; tekrar dene.", "warn"); return null; }
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04) + 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  let w = x1 - x0 + 1, hh = y1 - y0 + 1;
  const s = Math.min(1, 1200 / w);
  const out = document.createElement("canvas");
  out.width = Math.round(w * s);
  out.height = Math.round(hh * s);
  out.getContext("2d").drawImage(c, x0, y0, w, hh, 0, 0, out.width, out.height);
  return { url: out.toDataURL("image/png"), w: out.width, h: out.height };
}

/* ============================ Digital identity ========================== */
export async function getIdentity() {
  const id = await store.getVault("identity");
  E.identity = id;
  return id;
}

export function identitySummary() {
  const box = h("div", { style: { display: "grid", gap: "10px" } });
  (async () => {
    await forge();
    const id = await getIdentity();
    if (!id) {
      box.append(h("p.fineprint", { text: "Dijital imza atabilmek için bir dijital kimliğe (X.509 sertifika) ihtiyacın var. Tek tıkla öz-imzalı bir kimlik oluşturabilir ya da kurumunun verdiği .p12/.pfx dosyasını içe aktarabilirsin." }),
        h("button.btn.btn--sm", { type: "button", html: icon("fingerprint") + "Kimliği ayarla", onclick: () => openIdentity().then(() => import("./panels.js").then((p) => p.refresh())) }));
      return;
    }
    const info = await describeIdentity(id);
    box.append(identityCard(info), h("button.btn.btn--sm", { type: "button", html: icon("settings") + "Kimliği yönet", onclick: () => openIdentity().then(() => import("./panels.js").then((p) => p.refresh())) }));
  })();
  return box;
}

function identityCard(info) {
  return h("div.idcard", {},
    h("div.idcard__head", {}, h("span.idcard__seal", { html: icon(info.selfSigned ? "fingerprint" : "badge-check") }),
      h("div", {}, h("div", { style: { fontWeight: 650 }, text: info.name }), h("div.fineprint", { text: info.selfSigned ? "Öz-imzalı sertifika (Mühür)" : "Veren: " + info.issuerName }))),
    h("dl.kv", {},
      h("dt", { text: "Geçerlilik" }), h("dd", { text: `${formatDate(info.notBefore)} – ${formatDate(info.notAfter)}` }),
      h("dt", { text: "Anahtar" }), h("dd", { text: info.keyLabel + (info.qualified ? " · Nitelikli (QC)" : "") }),
      h("dt", { text: "Parmak izi" }), h("dd", { class: "mono", text: info.fingerprint.slice(0, 47) + "…" })));
}

export async function openIdentity() {
  await Promise.all([forge(), pdflib()]);
  const user = store.currentUser();
  const body = h("div", { style: { display: "grid", gap: "14px" } });
  let d;
  const render = async () => {
    body.textContent = "";
    const id = await getIdentity();
    if (id) {
      const info = await describeIdentity(id);
      body.append(identityCard(info),
        h("div.kv", {}),
        h("div.mono", { style: { fontSize: "11px", color: "var(--ink-mute)", wordBreak: "break-all" }, text: "SHA-256: " + info.fingerprint }),
        h("div.pactions", {},
          h("button.btn.btn--sm", { type: "button", html: icon("download") + "Sertifikayı indir (.cer)", onclick: () => downloadBytes(identityCertDer(id), safeFileName(info.name + " sertifika", "cer"), "application/pkix-cert") }),
          h("button.btn.btn--sm", { type: "button", html: icon("plus") + "Yeni öz-imzalı kimlik", onclick: () => makeSelf(true) }),
          h("button.btn.btn--sm", { type: "button", html: icon("file-key") + ".p12/.pfx içe aktar", onclick: importFile }),
          h("button.btn.btn--sm.btn--danger-ghost", { type: "button", html: icon("trash-2") + "Kimliği kaldır", onclick: removeId })),
        h("div.tip", { html: icon("info") + "<span>Öz-imzalı bir kimlikle atılan imza, belgenin imzadan sonra değişmediğini kanıtlar. Adobe Acrobat'ta “kimlik doğrulanamadı” uyarısı görünmemesi için alıcı .cer dosyasını güvenilir sertifikalarına ekleyebilir ya da kurumsal bir sertifika (.p12) kullanabilirsin.</span>" }));
    } else {
      body.append(
        h("p.muted", { text: "Dijital kimlik, imzanın senin anahtarınla atıldığını kanıtlayan bir X.509 sertifikası ve ona ait özel anahtardır. Özel anahtar bu cihazda, hesabının şifresiyle korunan kasada kalır." }),
        h("div.pactions", {},
          h("button.btn.btn--primary", { type: "button", html: icon("fingerprint") + "Öz-imzalı kimlik oluştur", onclick: () => makeSelf(false) }),
          h("button.btn", { type: "button", html: icon("file-key") + ".p12/.pfx içe aktar", onclick: importFile })));
    }
    body.append(h("div.tip.tip--warn", { html: icon("triangle-alert") + "<span>5070 sayılı Kanun kapsamındaki <strong>nitelikli elektronik imza</strong> (e-imza kartı / USB token) tarayıcıdan doğrudan kullanılamaz. Mühür, NES ile imzalanmış PDF'leri doğrulayabilir; NES ile imzalamak için sağlayıcının imzalama yazılımını kullan.</span>" }));
  };
  const makeSelf = async (replace) => {
    if (replace && !(await confirmDialog({ title: "Kimlik değiştirilsin mi?", message: "Yeni bir anahtar çifti oluşturulur. Eski kimlikle atılmış imzalar geçerli kalır ama bu cihazda o kimlikle imza atamazsın.", confirm: "Oluştur" }))) return;
    const b = busy("Anahtar çifti oluşturuluyor…");
    try {
      const id = await createSelfSignedIdentity({ name: user.name, email: user.email, organization: "Mühür" });
      await store.putVault("identity", id);
      toast("Dijital kimlik oluşturuldu.", "ok");
    } catch (err) {
      toast("Kimlik oluşturulamadı: " + (err.message || err), "error");
    } finally {
      b.done();
    }
    render();
  };
  const importFile = async () => {
    const input = $("#file-any");
    const [file] = await pickFiles(input, { accept: ".p12,.pfx,application/x-pkcs12" });
    if (!file) return;
    const pw = await promptDialog({ title: "Sertifika parolası", label: file.name + " parolası", type: "password", confirm: "İçe aktar", required: false });
    if (pw === null) return;
    const b = busy("Sertifika okunuyor…");
    try {
      const id = importP12(await file.arrayBuffer(), pw);
      await store.putVault("identity", id);
      toast("Sertifika içe aktarıldı.", "ok");
    } catch (err) {
      toast(err.message || String(err), "error");
    } finally {
      b.done();
    }
    render();
  };
  const removeId = async () => {
    if (!(await confirmDialog({ title: "Dijital kimlik kaldırılsın mı?", message: "Özel anahtar bu cihazdan silinir. Daha önce atılmış imzalar geçerli kalır.", confirm: "Kaldır", danger: true }))) return;
    await store.putVault("identity", null);
    E.identity = null;
    render();
  };
  await render();
  d = dialog({ title: "Dijital kimlik", sub: "PAdES imzalarında kullanılan sertifika", body, size: "md", actions: [{ label: "Kapat", value: true }] });
  return d.result;
}

/* ============================= Digital sign ============================= */
const REASONS = ["Bu belgeyi onaylıyorum", "Bu belgenin yazarıyım", "Bu belgeyi inceledim", "Bu belgenin koşullarını kabul ediyorum", "Bu belgeye tanıklık ediyorum"];

export async function openDigitalSign(saved) {
  await Promise.all([forge(), pdflib()]);
  const user = store.currentUser();
  let identity = await getIdentity();
  const st = saved || {
    reason: REASONS[0], location: "", contact: user.email, visible: true, field: null, sigId: (E.signatures.find((s) => s.kind !== "initials") || {}).id || null,
    audit: true,
  };
  const existing = (E.verification || []).length;
  const pristine = isPristine(E.state);
  const incremental = existing && pristine;

  const body = h("div.form");
  const idBox = h("div");
  const drawId = async () => {
    idBox.textContent = "";
    identity = await getIdentity();
    if (identity) {
      const info = await describeIdentity(identity);
      const card = identityCard(info);
      card.append(h("button.link", { type: "button", text: "Kimliği yönet", style: { justifySelf: "start", fontSize: "12.5px" }, onclick: () => openIdentity().then(drawId) }));
      idBox.append(card);
    } else {
      idBox.append(h("div.idcard", {},
        h("div.idcard__head", {}, h("span.idcard__seal", { html: icon("fingerprint") }), h("div", {}, h("div", { style: { fontWeight: 650 }, text: "Dijital kimlik gerekli" }), h("div.fineprint", { text: "Bir kez oluşturulur, bu hesabın kasasında saklanır." }))),
        h("div.pactions", {},
          h("button.btn.btn--sm.btn--primary", { type: "button", html: icon("fingerprint") + "Öz-imzalı kimlik oluştur", onclick: async () => {
            const b = busy("Anahtar çifti oluşturuluyor…");
            try { await store.putVault("identity", await createSelfSignedIdentity({ name: user.name, email: user.email, organization: "Mühür" })); } finally { b.done(); }
            drawId();
          } }),
          h("button.btn.btn--sm", { type: "button", html: icon("file-key") + ".p12/.pfx içe aktar", onclick: () => openIdentity().then(drawId) }))));
    }
  };
  await drawId();

  const reasonSel = h("select.select");
  for (const r of REASONS) reasonSel.append(h("option", { value: r, text: r, selected: r === st.reason }));
  reasonSel.append(h("option", { value: "__custom", text: "Diğer…", selected: !REASONS.includes(st.reason) }));
  const reasonCustom = h("input.input", { type: "text", value: REASONS.includes(st.reason) ? "" : st.reason, placeholder: "İmza nedeni", hidden: REASONS.includes(st.reason) });
  reasonSel.addEventListener("change", () => { reasonCustom.hidden = reasonSel.value !== "__custom"; if (!reasonCustom.hidden) reasonCustom.focus(); });
  const loc = h("input.input", { type: "text", value: st.location, placeholder: "Ör. Ankara" });
  const contact = h("input.input", { type: "text", value: st.contact });

  const visSeg = h("div.segment.segment--sm");
  const fieldBox = h("div", { style: { display: "grid", gap: "10px" } });
  const drawField = () => {
    fieldBox.textContent = "";
    if (!st.visible) {
      fieldBox.append(h("p.fineprint", { text: "İmza, sayfada bir kutu göstermeden PDF okuyucunun imza panelinde görünür." }));
      return;
    }
    const where = st.field ? `Sayfa ${E.pageIndex(st.field.pageId) + 1} · ${Math.round(st.field.rect.w)}×${Math.round(st.field.rect.h)} pt` : "Henüz seçilmedi";
    fieldBox.append(h("div.form__row", {},
      h("span", { html: `<span class="muted">Alan:</span> <strong>${esc(where)}</strong>` }),
      h("button.btn.btn--sm", { type: "button", html: icon("square-dashed-mouse-pointer") + (st.field ? "Yeniden çiz" : "Alanı sayfada çiz"), onclick: () => pickField() })));
    const tiles = h("div.sigs");
    const noneTile = h("button.sigtile.sigtile--add", { type: "button", class: "sigtile sigtile--add" + (!st.sigId ? " is-active" : ""), text: "Yalnızca metin", onclick: () => { st.sigId = null; drawField(); } });
    if (!st.sigId) noneTile.style.boxShadow = "0 0 0 2px var(--accent)";
    tiles.append(noneTile);
    for (const s of E.signatures.filter((x) => x.kind !== "initials").slice(0, 5)) {
      const t = h("button.sigtile", { type: "button", onclick: () => { st.sigId = s.id; drawField(); } }, h("img", { src: s.url, alt: "" }));
      if (st.sigId === s.id) t.style.boxShadow = "0 0 0 2px var(--accent)";
      tiles.append(t);
    }
    fieldBox.append(h("span.field__label", { text: "Kutuda görünecek imza" }), tiles);
  };
  for (const [k, label] of [[false, "Görünmez"], [true, "Sayfada göster"]]) {
    visSeg.append(h("button.segment__btn", { type: "button", class: "segment__btn" + (st.visible === k ? " is-active" : ""), text: label, onclick: (e) => {
      st.visible = k;
      $$(".segment__btn", visSeg).forEach((b) => b.classList.toggle("is-active", b === e.currentTarget));
      drawField();
    } }));
  }
  drawField();

  const auditCb = h("input", { type: "checkbox", checked: st.audit && !incremental, disabled: !!incremental });
  const notes = h("div", { style: { display: "grid", gap: "8px" } });
  if (incremental) notes.append(h("div.tip.tip--ok", { html: icon("shield-check") + `<span>Belgede ${existing} imza var ve değişiklik yapmadın. Yeni imza artımlı olarak eklenir; önceki imzalar geçerli kalır.</span>` }));
  else if (existing) notes.append(h("div.tip.tip--danger", { html: icon("shield-x") + `<span>Belgede ${existing} dijital imza var ama düzenleme yaptın. İmzalarken belge yeniden yazılır ve <strong>önceki imzalar geçersiz olur</strong>. Önce düzenlemeleri geri alırsan imzalar korunur.</span>` }));
  notes.append(h("div.tip", { html: icon("info") + "<span>İmzalı hali yeni bir sürüm olarak kaydedilir. Sonradan yapılan her değişiklik imzayı geçersiz kılar; değişiklik yapıp yeniden imzalayabilirsin.</span>" }));

  body.append(
    idBox,
    h("label.field", {}, h("span.field__label", { text: "İmza nedeni" }), reasonSel, reasonCustom),
    h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" } },
      h("label.field", {}, h("span.field__label", { text: "Konum" }), loc),
      h("label.field", {}, h("span.field__label", { text: "İletişim" }), contact)),
    h("div.field", {}, h("span.field__label", { text: "Görünüm" }), visSeg, fieldBox),
    h("label.check", {}, auditCb, h("span", { text: "Sona imza denetim sayfası ekle (imzalayan, zaman, içerik özeti)" })),
    notes);
  for (const el of $$("input, select", body)) el.addEventListener("keydown", (e) => e.stopPropagation());

  const collect = () => {
    st.reason = reasonSel.value === "__custom" ? reasonCustom.value.trim() : reasonSel.value;
    st.location = loc.value.trim();
    st.contact = contact.value.trim();
    st.audit = auditCb.checked;
  };
  let d = null;
  const pickField = async () => {
    collect();
    d.close("pick");
  };
  d = dialog({
    title: "Dijital olarak imzala",
    sub: "PAdES uyumlu kriptografik imza (adbe.pkcs7.detached, SHA-256)",
    body,
    size: "md",
    actions: [
      { label: "Vazgeç", value: null },
      { label: "İmzala ve kaydet", kind: "seal", icon: "file-pen-line", onClick: () => {
        collect();
        if (!identity) { toast("Önce bir dijital kimlik oluştur ya da içe aktar.", "warn"); return false; }
        if (st.visible && !st.field) { pickField(); return undefined; }
        return "sign";
      } },
    ],
  });
  const r = await d.result;
  if (r === "pick") {
    const field = await E.drawSigField();
    if (field) st.field = field;
    return openDigitalSign(st);
  }
  if (r !== "sign") return;
  await performSign(st, identity, user, { incremental });
}

async function performSign(st, identity, user, { incremental }) {
  const P = await pdflib();
  await forge();
  const b = busy("Belge imzalanıyor…");
  try {
    const info = await describeIdentity(identity);
    const now = new Date();
    const visual = [];
    E.state.items.forEach((it) => { if (it.type === "image" && (it.kind === "signature" || it.kind === "initials")) visual.push(E.pageIndex(it.page) + 1); });
    const visualLabel = [...new Set(visual)].sort((a, b) => a - b).map((n) => "Sayfa " + n);
    let base;
    if (incremental || (isPristine(E.state) && !st.audit)) {
      base = E.sources.get("main").bytes.slice();
    } else {
      let audit = null;
      if (st.audit) {
        b.set("İçerik özeti hesaplanıyor…");
        const content = await E.buildBytes({ force: true });
        audit = await auditInfo({
          docName: E.doc.name, docId: E.doc.id, pageCount: E.state.pages.length, contentBytes: content, user,
          identityInfo: info, reason: st.reason, location: st.location, visualSignatures: visualLabel,
        });
      }
      b.set("PDF hazırlanıyor…");
      base = await E.buildBytes({ audit, force: true });
    }

    let page = 0, rect = null, appearance = null;
    if (st.visible && st.field) {
      page = E.pageIndex(st.field.pageId);
      const doc = await P.PDFDocument.load(base, { updateMetadata: false, ignoreEncryption: true });
      const pg = doc.getPage(Math.max(0, page));
      const rot = pg.getRotation().angle % 360;
      if (rot) {
        toast("Döndürülmüş sayfada görünür imza kutusu desteklenmiyor; imza görünmez olarak eklendi.", "warn", { timeout: 7000 });
      } else {
        const m = displayToPdf(pg.getCropBox(), 0);
        const r = st.field.rect;
        const [x1, y1] = apply(m, r.x, r.y + r.h);
        const [x2, y2] = apply(m, r.x + r.w, r.y);
        rect = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
        const sig = E.signatures.find((s) => s.id === st.sigId);
        appearance = {
          imagePng: sig ? base64ToBytes(sig.url.split(",")[1]) : null,
          lines: ["Dijital olarak imzalayan:", user.name, formatDateTime(now) + " " + tzLabel(now), st.reason ? "Neden: " + st.reason : null].filter(Boolean),
          fontBytes: await fontBytes("LiberationSans-Regular.ttf"),
        };
      }
    }
    b.set("İmza oluşturuluyor…");
    const signed = await signPdf(base, {
      identity, name: user.name, reason: st.reason, location: st.location, contact: st.contact,
      page: Math.max(0, page), rect, appearance, date: now,
    });
    b.set("Sürüm kaydediliyor…");
    await addVersion(E.doc, signed, `İmzalı · ${user.name} · ${formatDateTime(now)}`, { signed: true });
    await store.deleteState(E.doc.id);
    await E.reloadVersion();
    import("./panels.js").then((p) => p.showPanel("signatures"));
    toast("Belge dijital olarak imzalandı.", "ok", { timeout: 8000, action: { label: "İndir", run: () => downloadBytes(signed, safeFileName(E.doc.name, "pdf")) } });
  } catch (err) {
    console.error(err);
    toast("İmzalanamadı: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

/* ============================= Verification ============================= */
export function verificationCard(r) {
  const ok = r.integrity && r.signatureValid === true;
  const bad = r.integrity === false || r.signatureValid === false;
  const status = bad ? "bad" : ok && !r.laterChanges ? "ok" : "warn";
  const iconName = { ok: "shield-check", warn: "shield-alert", bad: "shield-x" }[status];
  const c = r.certificate || {};
  const who = c.name || r.nameEntry || "Bilinmeyen imzalayan";
  const card = h("div.sigcard");
  card.append(h("div.sigcard__head", {},
    h("span.sigcard__icon.sigcard__icon--" + status, { class: "sigcard__icon sigcard__icon--" + status, html: icon(iconName) }),
    h("div", {}, h("div.sigcard__who", { text: who }), h("div.sigcard__when", { text: r.signingTime ? formatDateTime(r.signingTime) : "Zaman bilgisi yok" }))));
  const checks = h("ul.checks");
  const add = (kind, text) => checks.append(h("li", { class: "is-" + kind, html: icon(kind === "ok" ? "circle-check" : kind === "bad" ? "circle-x" : "circle-alert") + `<span>${text}</span>` }));
  if (r.error) add("bad", "İmza okunamadı: " + esc(r.error));
  else {
    add(r.integrity ? "ok" : "bad", r.integrity ? "İmzalanan içerik değiştirilmemiş" : "İmzalanan içerik değiştirilmiş!");
    if (r.signatureValid === true) add("ok", `İmza matematiksel olarak geçerli (${esc(c.keyLabel || "")}, ${esc(r.digestAlgorithm || "")})`);
    else if (r.signatureValid === false) add("bad", "İmza değeri sertifikayla doğrulanamadı");
    else add("warn", "İmza algoritması bu tarayıcıda doğrulanamadı");
    add(r.coversWholeDocument ? "ok" : "warn", r.coversWholeDocument ? "Belgenin tamamını kapsıyor" : "Bu imzadan sonra belgeye eklemeler yapılmış (ör. başka bir imza)");
    if (r.known) add("ok", "Bu senin dijital kimliğin");
    else if (c.selfSigned) add("warn", "Kimlik bir sertifika otoritesince doğrulanmamış (öz-imzalı)");
    else add("warn", `Sertifika “${esc(c.issuerName || "?")}” tarafından verilmiş; güven zinciri burada denetlenmedi`);
    if (c.qualified) add("ok", "Nitelikli elektronik sertifika (QC) beyanı içeriyor");
    if (r.certValidAtSigning === false) add("warn", "İmza anında sertifika geçerlilik süresi dışındaydı");
    if (r.hasTimestamp) add("ok", "Güvenilir zaman damgası içeriyor");
  }
  card.append(checks);
  const kv = h("dl.kv");
  const row = (k, v) => { if (v) kv.append(h("dt", { text: k }), h("dd", { text: v })); };
  row("Neden", r.reason);
  row("Konum", r.location);
  row("E-posta", c.email);
  row("Kurum", c.organization);
  row("Veren", c.issuerName);
  row("Sayfa", r.page != null ? String(r.page + 1) + (r.rect && r.rect[2] - r.rect[0] > 1 ? " (görünür)" : " (görünmez)") : null);
  row("Alan", r.fieldName);
  row("Parmak izi", c.fingerprint ? c.fingerprint.slice(0, 23) + "…" : null);
  card.append(kv);
  card.addEventListener("click", () => {
    if (r.page != null && E.state.pages[r.page]) E.scrollToPage(E.state.pages[r.page].id, 0);
  });
  return card;
}
