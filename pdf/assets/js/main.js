/* ==========================================================================
   Mühür — main.js
   Same shape as every project on this site: helpers, then one initX() per
   feature (query its own nodes, bail out if they are missing, bind its own
   listeners), then a single boot(). This one is an ES module and the
   heavy lifting lives next to it:

     store.js    accounts, encryption, IndexedDB
     docs.js     library records, versions, thumbnails
     editor.js   the editor (+ ed.js shared context, panels.js, sigui.js)
     pdfwork.js  state -> PDF with pdf-lib
     sign.js     PAdES signing and verification with forge + WebCrypto
   ========================================================================== */

import * as store from "./store.js";
import * as docs from "./docs.js";
import { h, icon, esc, toast, dialog, confirmDialog, promptDialog, menu, busy, pickFiles } from "./ui.js";
import { pdflib } from "./libs.js";
import { formatBytes, formatRelative, downloadBytes, safeFileName, debounce } from "./util.js";
import { openEditor, closeEditor, editorIsOpen, flushEditor } from "./editor.js";
import { mergePdfs, imagesToPdf, blankPdf } from "./pdfwork.js";
import { createSignature, openIdentity, signatureTiles } from "./sigui.js";

/* ------------------------------- Helpers ------------------------------- */
function $(selector, root) { return (root || document).querySelector(selector); }
function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

const app = { user: null, docs: [], selected: new Set(), filter: "", lockedReason: null };
const IDLE_LIMIT = 30 * 60 * 1000;

function show(view) {
  $("#app").dataset.view = view;
  $$(".view").forEach((v) => { v.hidden = v.dataset.viewName !== view; });
}

function setUserUi() {
  const u = app.user;
  $$("[data-user-initials]").forEach((el) => { el.textContent = u ? u.initials || "?" : "?"; });
}

/* ------------------------------- Routing ------------------------------- */
async function route() {
  if (!app.user) { showAuth(); return; }
  const m = /^#\/belge\/([\w-]+)/.exec(location.hash);
  if (m) {
    if (editorIsOpen()) await closeEditor();
    show("editor");
    try {
      await openEditor(m[1], { user: app.user, onClose: () => { location.hash = "#/"; } });
    } catch (err) {
      console.error(err);
      toast(err.message || "Belge açılamadı.", "error");
      location.hash = "#/";
    }
    return;
  }
  if (editorIsOpen()) await closeEditor();
  show("library");
  document.title = "Belgelerim · Mühür";
  await loadLibrary();
}

/* -------------------------------- Auth --------------------------------- */
function showAuth(notice) {
  show("auth");
  document.title = "Mühür — PDF düzenleyici ve e-imza";
  const box = $("#auth-notice");
  box.hidden = !notice;
  if (notice) box.innerHTML = icon("lock") + `<span>${esc(notice)}</span>`;
  const email = store.lastEmail();
  if (email) { $("#form-signin [name=email]").value = email; $("#form-signin [name=remember]").checked = true; }
  setAuthTab("signin");
  setTimeout(() => {
    const f = $("#form-signin");
    (f.email.value ? f.password : f.email).focus();
  }, 30);
}

function setAuthTab(tab) {
  $$("[data-auth-pane]").forEach((p) => { p.hidden = p.dataset.authPane !== tab; });
  $$(".segment__btn[data-auth-tab]").forEach((b) => {
    const on = b.dataset.authTab === tab || (tab === "recover" && b.dataset.authTab === "signin");
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on);
  });
  $$(".form__error", $(".auth")).forEach((e) => { e.hidden = true; });
}

function formError(form, msg) {
  const el = $(".form__error", form);
  el.textContent = msg;
  el.hidden = !msg;
}

async function withButton(form, fn) {
  const btn = $("button[type=submit]", form);
  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = icon("loader-circle", "spin") + "<span>Lütfen bekle…</span>";
  try { await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-zçğıöşü]/.test(pw) && /[A-ZÇĞİÖŞÜ]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^\w\s]/.test(pw)) s++;
  return Math.min(4, s);
}

function initAuth() {
  const root = $(".auth");
  if (!root) return;
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-auth-tab]");
    if (t) setAuthTab(t.dataset.authTab);
    const r = e.target.closest("[data-reveal]");
    if (r) {
      const input = r.parentElement.querySelector("input");
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      r.innerHTML = icon(showing ? "eye" : "eye-off");
    }
  });

  const pw = $("#form-signup [name=password]");
  pw.addEventListener("input", () => {
    const s = strength(pw.value);
    const bar = $("#pw-meter");
    bar.style.width = (pw.value ? 15 + s * 21.25 : 0) + "%";
    bar.style.background = ["var(--danger)", "var(--danger)", "var(--warn)", "var(--ok)", "var(--ok)"][s];
    $("#pw-hint").textContent = !pw.value ? "En az 8 karakter. Şifre belgelerini şifreleyen anahtarı korur."
      : ["Çok zayıf", "Zayıf", "Orta", "İyi", "Güçlü"][s] + " · " + (pw.value.length < 8 ? "en az 8 karakter gerekli" : "harf, rakam ve sembol karıştır");
  });

  $("#form-signin").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    formError(f, "");
    withButton(f, async () => {
      try {
        const user = await store.signIn({ email: f.email.value, password: f.password.value, remember: f.remember.checked });
        f.password.value = "";
        await signedIn(user);
      } catch (err) {
        formError(f, err.message || String(err));
        f.password.select();
      }
    });
  });

  $("#form-signup").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    formError(f, "");
    withButton(f, async () => {
      try {
        const { user, recoveryCode } = await store.register({ name: f.elements.namedItem("name").value, email: f.email.value, password: f.password.value, remember: f.remember.checked });
        f.password.value = "";
        await showRecoveryCode(recoveryCode, true);
        await signedIn(user);
        toast(`Hoş geldin, ${user.name.split(" ")[0]}!`, "ok");
      } catch (err) {
        formError(f, err.message || String(err));
      }
    });
  });

  $("#form-recover").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    formError(f, "");
    withButton(f, async () => {
      try {
        const user = await store.recoverAccount({ email: f.email.value, code: f.code.value, password: f.password.value });
        f.password.value = "";
        f.code.value = "";
        await signedIn(user);
        toast("Şifren yenilendi. Kurtarma kodun geçerliliğini koruyor.", "ok");
      } catch (err) {
        formError(f, err.message || String(err));
      }
    });
  });
}

function showRecoveryCode(code, firstTime) {
  const cb = h("input", { type: "checkbox" });
  const body = h("div", { style: { display: "grid", gap: "14px" } },
    h("p.muted", { html: firstTime
      ? "Hesabın yalnızca bu tarayıcıda yaşar ve belgelerin şifrenden türetilen bir anahtarla şifrelenir. <strong>Şifreni unutursan belgelerine yalnızca bu kodla ulaşabilirsin.</strong> Kimse — biz dahil — sıfırlayamaz."
      : "Eski kurtarma kodun artık geçersiz. Bu yeni kodu güvenli bir yerde sakla." }),
    h("code.code", { text: code }),
    h("div.pactions", {},
      h("button.btn.btn--sm", { type: "button", html: icon("copy") + "Kopyala", onclick: () => navigator.clipboard.writeText(code).then(() => toast("Kopyalandı.", "ok")) }),
      h("button.btn.btn--sm", { type: "button", html: icon("download") + "Metin dosyası indir", onclick: () => downloadBytes(new TextEncoder().encode(`Mühür kurtarma kodu\n\n${code}\n\nHesap: ${store.currentUser() ? store.currentUser().email : ""}\nOluşturma: ${new Date().toLocaleString("tr-TR")}\n`), "muhur-kurtarma-kodu.txt", "text/plain") })),
    h("label.check", {}, cb, h("span", { text: "Kodu güvenli bir yere kaydettim" })));
  const d = dialog({
    title: "Kurtarma kodun", sub: "Bunu yalnızca bir kez göreceksin.", body, size: "sm", dismissable: false,
    actions: [{ label: "Devam et", kind: "primary", onClick: () => {
      if (!cb.checked) { toast("Devam etmeden önce kodu kaydettiğini onayla.", "warn"); return false; }
      return true;
    } }],
  });
  return d.result;
}

async function signedIn(user) {
  app.user = user;
  setUserUi();
  resetIdle();
  if (!location.hash || location.hash === "#") location.hash = "#/";
  await route();
}

async function lock(reason) {
  if (!app.user) return;
  try { await flushEditor(); } catch (e) { /* best effort */ }
  if (editorIsOpen()) await closeEditor();
  app.user = null;
  await store.signOut();
  setUserUi();
  showAuth(reason);
}

/* ------------------------------ Idle lock ------------------------------ */
let idleTimer = 0;
function resetIdle() {
  clearTimeout(idleTimer);
  if (app.user) idleTimer = setTimeout(() => lock("Oturum 30 dakika hareketsiz kaldığı için kilitlendi. Devam etmek için şifreni gir."), IDLE_LIMIT);
}
function initIdle() {
  const bump = debounce(resetIdle, 1000);
  for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, bump, { passive: true });
}

/* ------------------------------- Library ------------------------------- */
async function loadLibrary() {
  app.docs = await store.listDocs();
  app.selected = new Set([...app.selected].filter((id) => app.docs.some((d) => d.id === id)));
  renderLibrary();
  renderStorage();
}

function renderLibrary() {
  const grid = $("#doc-grid");
  grid.textContent = "";
  const q = app.filter.toLocaleLowerCase("tr-TR");
  const list = app.docs.filter((d) => !q || d.name.toLocaleLowerCase("tr-TR").includes(q));
  $("#doc-count").textContent = app.docs.length;
  $("#doc-empty").hidden = app.docs.length > 0;
  if (app.docs.length && !list.length) grid.append(h("li.empty", { style: { gridColumn: "1 / -1" } }, h("p", { text: `“${app.filter}” ile eşleşen belge yok.` })));
  for (const d of list) {
    const ver = d.versions[d.versions.length - 1];
    const card = h("li.card", { class: "card" + (app.selected.has(d.id) ? " is-selected" : ""), dataset: { id: d.id } });
    const thumb = h("button.card__thumb", { type: "button", "aria-label": d.name + " belgesini aç", class: "card__thumb" + (d.thumb ? "" : " card__thumb--empty"), onclick: () => openDoc(d.id) });
    if (d.thumb) thumb.append(h("img", { src: d.thumb, alt: "", loading: "lazy" }));
    const badges = h("div.card__badges");
    if (d.signed) badges.append(h("span.badge.badge--ok", { html: icon("badge-check") + "İmzalı" }));
    if (d.versions.length > 1) badges.append(h("span.badge", { text: d.versions.length + " sürüm" }));
    thumb.append(badges);
    const cb = h("input.card__select", { type: "checkbox", "aria-label": "Seç", checked: app.selected.has(d.id) });
    cb.addEventListener("change", () => { if (cb.checked) app.selected.add(d.id); else app.selected.delete(d.id); renderBulk(); card.classList.toggle("is-selected", cb.checked); });
    card.append(thumb, cb, h("div.card__meta", {},
      h("div.card__text", {}, h("span.card__name", { text: d.name, title: d.name }), h("span.card__sub", { text: `${d.pages} sayfa · ${formatBytes(ver.size || d.size || 0)} · ${formatRelative(d.modified)}` })),
      h("button.ibtn.ibtn--sm.card__menu", { type: "button", "aria-label": "Belge işlemleri", html: icon("ellipsis"), onclick: (e) => docMenu(e.currentTarget, d) })));
    grid.append(card);
  }
  grid.classList.toggle("is-selecting", app.selected.size > 0);
  renderBulk();
}

function renderBulk() {
  const n = app.selected.size;
  $("#bulk").hidden = !n;
  $("#bulk-count").textContent = n + " seçili";
  $('[data-bulk="merge"]').disabled = n < 2;
  $("#doc-grid").classList.toggle("is-selecting", n > 0);
}

async function renderStorage() {
  const info = await store.storageInfo();
  const total = app.docs.reduce((s, d) => s + d.versions.reduce((a, v) => a + (v.size || 0), 0), 0);
  $("#storage-line").textContent = `${app.docs.length} belge · ${formatBytes(total)} · Bu cihazda AES-256 ile şifreli` + (info.quota ? ` · Kota ${formatBytes(info.quota)}` : "");
  $("#persist-btn").hidden = info.persisted || !(navigator.storage && navigator.storage.persist);
}

function openDoc(id) { location.hash = "#/belge/" + id; }

function docMenu(anchor, d) {
  menu(anchor, [
    { label: "Aç", icon: "file-pen-line", onClick: () => openDoc(d.id) },
    { label: "Yeniden adlandır", icon: "pencil", onClick: async () => {
      const name = await promptDialog({ title: "Yeniden adlandır", label: "Belge adı", value: d.name });
      if (!name) return;
      d.name = name.trim();
      await store.putDoc(d);
      renderLibrary();
    } },
    { label: "İndir", sub: "Son sürüm, düzenlemelerle", icon: "download", onClick: () => downloadDoc(d) },
    { label: "Kopyasını oluştur", icon: "copy", onClick: async () => {
      const b = busy("Kopyalanıyor…");
      try { await docs.duplicateDoc(d); await loadLibrary(); toast("Kopya oluşturuldu.", "ok"); } catch (err) { toast(err.message, "error"); } finally { b.done(); }
    } },
    "sep",
    { label: "Sil", icon: "trash-2", danger: true, onClick: () => deleteDocs([d]) },
  ], { align: "right" });
}

async function downloadDoc(d) {
  const b = busy("PDF hazırlanıyor…");
  try {
    downloadBytes(await docs.renderedBytes(d), safeFileName(d.name, "pdf"));
  } catch (err) {
    toast("İndirilemedi: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

async function deleteDocs(list) {
  const ok = await confirmDialog({
    title: list.length > 1 ? `${list.length} belge silinsin mi?` : "Belge silinsin mi?",
    message: list.length > 1 ? "Seçili belgeler, tüm sürümleri ve düzenlemeleriyle birlikte bu cihazdan kalıcı olarak silinecek." : `“${esc(list[0].name)}” tüm sürümleri ve düzenlemeleriyle birlikte bu cihazdan kalıcı olarak silinecek.`,
    confirm: "Kalıcı olarak sil", danger: true,
  });
  if (!ok) return;
  for (const d of list) { await store.deleteDoc(d); app.selected.delete(d.id); }
  await loadLibrary();
  toast(list.length > 1 ? "Belgeler silindi." : "Belge silindi.", "ok");
}

async function importFiles(files) {
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  const images = files.filter((f) => /^image\//.test(f.type));
  const skipped = files.length - pdfs.length - images.length;
  if (!pdfs.length && !images.length) { toast("Yalnızca PDF ve görsel dosyaları eklenebilir.", "warn"); return; }
  await pdflib();
  store.requestPersistence();
  let b = busy("Belgeler ekleniyor…");
  const created = [];
  try {
    for (const [i, f] of pdfs.entries()) {
      b.set(`Ekleniyor ${i + 1}/${pdfs.length}: ${f.name}`);
      let bytes = new Uint8Array(await f.arrayBuffer());
      const info = await docs.inspectPdf(bytes);
      if (!info.ok) { toast(`${f.name}: ${info.error}`, "error"); continue; }
      if (info.encrypted) {
        b.done();
        bytes = await unlockEncrypted(f.name, bytes);
        b = busy("Belgeler ekleniyor…");
        if (!bytes) continue;
      }
      created.push(await docs.createDoc(f.name, bytes));
    }
    if (images.length) {
      b.set("Görseller PDF'e dönüştürülüyor…");
      const bytes = await imagesToPdf(images);
      created.push(await docs.createDoc(images.length > 1 ? `${images[0].name.replace(/\.[^.]+$/, "")} ve ${images.length - 1} görsel` : images[0].name, bytes));
    }
  } catch (err) {
    console.error(err);
    toast("Eklenemedi: " + (err.message || err), "error");
  } finally {
    b.done();
  }
  if (skipped) toast(`${skipped} dosya desteklenmediği için atlandı.`, "warn");
  if (created.length === 1) { openDoc(created[0].id); return; }
  await loadLibrary();
  if (created.length) toast(`${created.length} belge eklendi.`, "ok");
}

async function unlockEncrypted(name, bytes) {
  const ok = await confirmDialog({
    title: "Şifreli PDF",
    message: `“${esc(name)}” şifreyle ya da izinlerle korunuyor. Düzenleyebilmek için sayfaları yüksek çözünürlüklü görüntülere dönüştürülmüş, korumasız bir kopya oluşturulacak; metin seçilebilirliği kaybolur.`,
    confirm: "Kopya oluştur",
  });
  if (!ok) return null;
  let password;
  for (let attempt = 0; attempt < 3; attempt++) {
    const b = busy("Sayfalar dönüştürülüyor…");
    try {
      return await docs.rasterizePdf(bytes, password, (i, n) => b.set(`Sayfa ${i}/${n} dönüştürülüyor…`));
    } catch (err) {
      b.done();
      if (err && err.name === "PasswordException") {
        password = await promptDialog({ title: "PDF parolası", label: `“${name}” için parola`, type: "password", confirm: "Aç", sub: attempt ? "Parola yanlış, tekrar dene." : "" });
        if (password == null) return null;
        continue;
      }
      toast("PDF açılamadı: " + (err.message || err), "error");
      return null;
    } finally {
      b.done();
    }
  }
  return null;
}

function initLibrary() {
  const lib = $("#library");
  if (!lib) return;
  $("#lib-search").addEventListener("input", debounce((e) => { app.filter = e.target.value.trim(); renderLibrary(); }, 120));
  lib.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) {
      const isPdf = pick.dataset.pick === "pdf";
      const files = await pickFiles(isPdf ? $("#file-pdf") : $("#file-image"), { multiple: true, accept: isPdf ? "application/pdf,.pdf" : "image/png,image/jpeg,image/webp,image/gif" });
      if (files.length) importFiles(files);
      return;
    }
    if (e.target.closest("[data-new-blank]")) {
      await pdflib();
      const d = await docs.createDoc("Yeni belge", await blankPdf());
      openDoc(d.id);
      return;
    }
    const bulk = e.target.closest("[data-bulk]");
    if (bulk) {
      const list = app.docs.filter((d) => app.selected.has(d.id));
      if (bulk.dataset.bulk === "clear") { app.selected.clear(); renderLibrary(); }
      if (bulk.dataset.bulk === "delete") deleteDocs(list);
      if (bulk.dataset.bulk === "merge") mergeDocs(list);
    }
  });
  $("#persist-btn").addEventListener("click", async () => {
    const ok = await store.requestPersistence();
    toast(ok ? "Tarayıcı bu siteye kalıcı depolama izni verdi." : "Tarayıcı kalıcı depolamayı onaylamadı; yer azaldığında veriler silinebilir.", ok ? "ok" : "warn");
    renderStorage();
  });

  // drag & drop anywhere on the library
  const drop = $("#drop");
  let depth = 0;
  const view = $(".view--library");
  view.addEventListener("dragenter", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { depth++; drop.classList.add("is-over"); e.preventDefault(); } });
  view.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove("is-over"); });
  view.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  view.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove("is-over");
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) importFiles(files);
  });
}

async function mergeDocs(list) {
  if (list.length < 2) return;
  const order = app.docs.filter((d) => list.includes(d));
  const b = busy("Belgeler birleştiriliyor…");
  try {
    await pdflib();
    const parts = [];
    for (const d of order) parts.push(await docs.renderedBytes(d));
    const bytes = await mergePdfs(parts);
    // signatures of the parts do not survive a merge; do not badge it as signed
    const d = await docs.createDoc(`${order[0].name} + ${order.length - 1} belge`, bytes, { meta: { signed: false } });
    app.selected.clear();
    b.done();
    toast("Belgeler birleştirildi.", "ok");
    openDoc(d.id);
  } catch (err) {
    toast("Birleştirilemedi: " + (err.message || err), "error");
  } finally {
    b.done();
  }
}

/* ------------------------------- Account ------------------------------- */
function accountMenu(anchor) {
  const u = app.user;
  if (!u) return;
  menu(anchor, [
    { node: h("div.menu__user", {}, h("strong", { text: u.name }), h("span", { text: u.email })) },
    "sep",
    { label: "Hesap ayarları", icon: "settings", onClick: openAccount },
    { label: "İmzalarım", icon: "signature", onClick: openSignatures },
    { label: "Dijital kimlik", icon: "fingerprint", onClick: () => openIdentity() },
    "sep",
    { label: "Kilitle", icon: "lock", hint: "", onClick: () => lock("Oturum kilitlendi.") },
    { label: "Çıkış yap", icon: "log-out", onClick: async () => { await lock(null); toast("Çıkış yapıldı.", "ok"); } },
  ], { align: "right" });
}

function openSignatures() {
  const body = h("div", { style: { display: "grid", gap: "12px" } },
    h("p.muted", { text: "Kaydedilmiş imza ve paraflar. Düzenleyicide İmza aracıyla yerleştirebilirsin." }),
    signatureTiles(() => null));
  dialog({ title: "İmzalarım", body, size: "md", actions: [{ label: "Kapat", value: true }] });
}

function openAccount() {
  const u = app.user;
  const name = h("input.input", { type: "text", value: u.name });
  const initials = h("input.input", { type: "text", value: u.initials || "", maxlength: 4, style: { width: "90px" } });
  const cur = h("input.input", { type: "password", autocomplete: "current-password" });
  const next = h("input.input", { type: "password", autocomplete: "new-password" });
  const field = (label, input, hint) => h("label.field", {}, h("span.field__label", { text: label }), input, hint ? h("span.field__hint", { text: hint }) : null);
  const section = (title, ...kids) => h("div.pgroup", {}, h("div.pgroup__title", { text: title }), ...kids);
  const body = h("div", {},
    section("Profil",
      h("div", { style: { display: "grid", gridTemplateColumns: "1fr auto", gap: "12px" } }, field("Ad soyad", name), field("Paraf", initials)),
      h("div.form__row", {}, h("span.fineprint", { text: u.email }), h("button.btn.btn--sm", { type: "button", text: "Profili kaydet", onclick: async () => {
        if (!name.value.trim()) return;
        app.user = await store.updateProfile({ name: name.value.trim(), initials: initials.value.trim().toLocaleUpperCase("tr-TR") || app.user.initials });
        setUserUi();
        toast("Profil güncellendi.", "ok");
      } }))),
    section("Şifre",
      field("Mevcut şifre", cur), field("Yeni şifre", next, "En az 8 karakter. Belgeler yeniden şifrelenmez; yalnızca anahtarın kilidi değişir."),
      h("div", {}, h("button.btn.btn--sm", { type: "button", text: "Şifreyi değiştir", onclick: async () => {
        try {
          await store.changePassword(cur.value, next.value);
          cur.value = next.value = "";
          toast("Şifre değiştirildi.", "ok");
        } catch (err) { toast(err.message, "error"); }
      } }))),
    section("Kurtarma kodu",
      h("p.fineprint", { text: "Şifreni unutursan hesabını yalnızca kurtarma koduyla açabilirsin. Kodu kaybettiysen yenisini oluştur; eskisi geçersiz olur." }),
      h("div", {}, h("button.btn.btn--sm", { type: "button", html: icon("key-round") + "Yeni kurtarma kodu oluştur", onclick: async () => {
        const pw = await promptDialog({ title: "Şifreni doğrula", label: "Şifre", type: "password", confirm: "Devam" });
        if (!pw) return;
        try { await showRecoveryCode(await store.newRecoveryCode(pw), false); } catch (err) { toast(err.message, "error"); }
      } }))),
    section("Tehlikeli bölge",
      h("p.fineprint", { text: "Hesabı silmek bu cihazdaki tüm belgeleri, sürümleri, imzaları ve dijital kimliği kalıcı olarak siler." }),
      h("div", {}, h("button.btn.btn--sm.btn--danger-ghost", { type: "button", html: icon("trash-2") + "Hesabı sil", onclick: async () => {
        const pw = await promptDialog({ title: "Hesabı sil", sub: "Bu işlem geri alınamaz.", label: "Onaylamak için şifreni gir", type: "password", confirm: "Hesabı kalıcı olarak sil" });
        if (!pw) return;
        try {
          if (editorIsOpen()) await closeEditor();
          await store.deleteAccount(pw);
          app.user = null;
          d.close(true);
          setUserUi();
          showAuth(null);
          toast("Hesap ve tüm veriler silindi.", "ok");
        } catch (err) { toast(err.message, "error"); }
      } }))));
  for (const el of body.querySelectorAll("input")) el.addEventListener("keydown", (e) => e.stopPropagation());
  const d = dialog({ title: "Hesap ayarları", body, size: "md", actions: [{ label: "Kapat", value: true }] });
}

function initAccount() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-account-menu]");
    if (b) accountMenu(b);
  });
}

/* -------------------------------- Boot --------------------------------- */
async function boot() {
  initAuth();
  initLibrary();
  initAccount();
  initIdle();
  window.addEventListener("hashchange", () => { route().catch((e) => console.error(e)); });
  window.addEventListener("pagehide", () => { flushEditor().catch(() => null); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushEditor().catch(() => null); });
  if (!window.indexedDB || !window.crypto || !crypto.subtle) {
    show("auth");
    const n = $("#auth-notice");
    n.hidden = false;
    n.textContent = "Bu tarayıcı gerekli güvenlik özelliklerini (IndexedDB, WebCrypto) desteklemiyor. Güncel bir Chrome, Edge, Firefox ya da Safari kullan.";
    return;
  }
  try {
    app.user = await store.restoreSession();
  } catch (err) {
    console.error(err);
    app.user = null;
  }
  setUserUi();
  if (app.user) { resetIdle(); await route(); } else showAuth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

export { createSignature };
