/* ==========================================================================
   Mühür — ui.js
   The few interface primitives every screen shares: a DOM builder, icons,
   toasts, dialogs (native <dialog>), popover menus and a busy overlay.
   ========================================================================== */

export const ICONS = "./assets/img/icons.svg";

export function $(selector, root) { return (root || document).querySelector(selector); }
export function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

export function icon(name, cls) {
  return `<svg class="icon${cls ? " " + cls : ""}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;
}

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// h("div.card", { onclick, dataset: {...}, html: "..." }, children...)
export function h(tag, props, ...children) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || "div");
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === ".") el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "html") el.innerHTML = v;
    else if (k === "text") el.textContent = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* -------------------------------- Toasts -------------------------------- */
export function toast(message, type, opts) {
  const host = document.getElementById("toasts");
  const iconName = { ok: "circle-check", error: "circle-alert", warn: "triangle-alert" }[type] || "info";
  const el = h("div.toast", { role: "status", class: "toast toast--" + (type || "info"), html: icon(iconName) });
  el.append(h("span", { text: message }));
  if (opts && opts.action) {
    el.append(h("button.toast__action", { type: "button", text: opts.action.label, onclick: () => { opts.action.run(); close(); } }));
  }
  host.append(el);
  let timer = setTimeout(close, (opts && opts.timeout) || (type === "error" ? 6500 : 3800));
  function close() {
    clearTimeout(timer);
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 200);
  }
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => { timer = setTimeout(close, 2000); });
  return close;
}

/* -------------------------------- Dialogs ------------------------------- */
// Returns { el, body, close(value), result: Promise }.
export function dialog({ title, sub, body, actions, size, dismissable = true, onOpen, className }) {
  const el = h("dialog.dialog", { class: "dialog" + (size ? " dialog--" + size : "") + (className ? " " + className : "") });
  const head = h("div.dialog__head");
  const titles = h("div.dialog__titles", {}, h("h2.dialog__title", { text: title || "" }), sub ? h("p.dialog__sub", { html: sub }) : null);
  head.append(titles);
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  let done = false;
  const close = (value) => {
    if (done) return;
    done = true;
    resolve(value);
    el.close();
    setTimeout(() => el.remove(), 10);
  };
  if (dismissable) {
    head.append(h("button.ibtn.dialog__close", { type: "button", "aria-label": "Kapat", html: icon("x"), onclick: () => close(null) }));
  }
  el.append(head);
  const bodyEl = h("div.dialog__body");
  if (typeof body === "string") bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  el.append(bodyEl);
  if (actions && actions.length) {
    const foot = h("div.dialog__foot");
    for (const a of actions) {
      if (a === "spacer") { foot.append(h("span.spacer")); continue; }
      const btn = h("button.btn", {
        type: "button",
        class: "btn" + (a.kind ? " btn--" + a.kind : ""),
        html: (a.icon ? icon(a.icon) : "") + esc(a.label),
        onclick: async () => {
          if (a.onClick) {
            const r = await a.onClick({ close, body: bodyEl, el, button: btn });
            if (r === false) return;
            if (r !== undefined) { close(r); return; }
          }
          if (a.value !== undefined) close(a.value);
        },
      });
      if (a.id) btn.dataset.action = a.id;
      foot.append(btn);
    }
    el.append(foot);
  }
  el.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (dismissable) close(null);
  });
  el.addEventListener("click", (e) => {
    if (e.target === el && dismissable) {
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close(null);
    }
  });
  document.body.append(el);
  el.showModal();
  if (onOpen) onOpen({ el, body: bodyEl, close });
  return { el, body: bodyEl, close, result };
}

export function confirmDialog({ title, message, confirm = "Tamam", cancel = "Vazgeç", danger = false }) {
  return dialog({
    title, size: "sm",
    body: h("p.muted", { html: message }),
    actions: [{ label: cancel, value: false }, { label: confirm, kind: danger ? "danger" : "primary", value: true }],
  }).result.then((v) => v === true);
}

export function promptDialog({ title, label, value = "", type = "text", placeholder = "", confirm = "Kaydet", hint, sub, required = true }) {
  const input = h("input.input", { type, value, placeholder, autocomplete: type === "password" ? "current-password" : "off" });
  const err = h("p.form__error", { hidden: true });
  const body = h("div.form", {},
    h("label.field", {}, h("span.field__label", { text: label || "" }), input, hint ? h("span.field__hint", { html: hint }) : null),
    err);
  const d = dialog({
    title, sub, size: "sm", body,
    actions: [{ label: "Vazgeç", value: null }, {
      label: confirm, kind: "primary", onClick: () => {
        if (required && !input.value.trim()) { err.textContent = "Bu alan boş bırakılamaz."; err.hidden = false; input.focus(); return false; }
        return input.value;
      },
    }],
    onOpen: () => { input.focus(); input.select(); },
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); d.el.querySelector(".dialog__foot .btn--primary").click(); }
  });
  return d.result;
}

/* --------------------------------- Menus -------------------------------- */
let openMenu = null;

export function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
}

// items: [{ label, sub, icon, hint, onClick, danger, disabled, active } | "sep" | { head }]
export function menu(anchor, items, opts) {
  closeMenu();
  const el = h("div.menu", { role: "menu" });
  for (const it of items) {
    if (!it) continue;
    if (it === "sep") { el.append(h("div.menu__sep")); continue; }
    if (it.head) { el.append(h("div.menu__head", { text: it.head })); continue; }
    if (it.node) { el.append(it.node); continue; }
    const btn = h("button.menu__item", {
      type: "button", role: "menuitem", disabled: !!it.disabled,
      class: "menu__item" + (it.danger ? " is-danger" : "") + (it.active ? " is-active" : ""),
      html: (it.icon ? icon(it.icon) : "") +
        `<span class="menu__label">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span>` +
        (it.hint ? `<span class="menu__hint">${esc(it.hint)}</span>` : "") +
        (it.active ? icon("check") : ""),
      onclick: (e) => { e.stopPropagation(); closeMenu(); if (it.onClick) it.onClick(); },
    });
    el.append(btn);
  }
  document.body.append(el);
  openMenu = el;
  position(el, anchor, opts && opts.align);
  const first = el.querySelector(".menu__item:not(:disabled)");
  if (first && !(opts && opts.noFocus)) first.focus({ preventScroll: true });
  el.addEventListener("keydown", (e) => {
    const list = $$(".menu__item:not(:disabled)", el);
    const i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
  });
  return el;
}

function position(el, anchor, align) {
  const pad = 8;
  let x, y;
  if (anchor && anchor.getBoundingClientRect) {
    const r = anchor.getBoundingClientRect();
    x = align === "right" ? r.right - el.offsetWidth : r.left;
    y = r.bottom + 6;
    if (y + el.offsetHeight > innerHeight - pad) y = Math.max(pad, r.top - el.offsetHeight - 6);
  } else {
    x = anchor.x;
    y = anchor.y;
    if (y + el.offsetHeight > innerHeight - pad) y = Math.max(pad, y - el.offsetHeight);
  }
  x = Math.max(pad, Math.min(x, innerWidth - el.offsetWidth - pad));
  el.style.left = x + "px";
  el.style.top = y + "px";
}

document.addEventListener("pointerdown", (e) => {
  if (openMenu && !openMenu.contains(e.target)) closeMenu();
}, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openMenu) { closeMenu(); e.stopPropagation(); }
}, true);
window.addEventListener("resize", closeMenu);

/* --------------------------------- Busy --------------------------------- */
export function busy(label) {
  const el = h("div.busy", { role: "alert", "aria-live": "assertive" },
    h("div.busy__card", { html: icon("loader-circle", "spin") + `<span>${esc(label || "Çalışıyor…")}</span>` }));
  document.body.append(el);
  return {
    set(text) { el.querySelector("span").textContent = text; },
    done() { el.remove(); },
  };
}

/* ------------------------------- Helpers -------------------------------- */
export function pickFiles(input, { accept, multiple } = {}) {
  return new Promise((resolve) => {
    if (accept != null) input.accept = accept;
    input.multiple = !!multiple;
    input.value = "";
    const onChange = () => { input.removeEventListener("change", onChange); resolve(Array.from(input.files || [])); };
    input.addEventListener("change", onChange);
    input.click();
  });
}

export function swatchRow(colors, current, onPick, { allowNone, custom = true } = {}) {
  const row = h("div.swatches");
  const all = allowNone ? [null].concat(colors) : colors;
  for (const c of all) {
    const b = h("button.swatch", {
      type: "button",
      class: "swatch" + (c ? "" : " swatch--none") + ((c || null) === (current || null) ? " is-active" : ""),
      "aria-label": c || "Yok",
      title: c || "Yok",
      style: c ? { background: c } : null,
      onclick: () => onPick(c),
    });
    row.append(b);
  }
  if (custom) {
    const inp = h("input", { type: "color", value: current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#000000", "aria-label": "Özel renk" });
    inp.addEventListener("input", () => onPick(inp.value));
    const isCustom = current && !colors.includes(current);
    row.append(h("label.swatch.swatch--custom", { class: "swatch swatch--custom" + (isCustom ? " is-active" : ""), title: "Özel renk" }, inp));
  }
  return row;
}
