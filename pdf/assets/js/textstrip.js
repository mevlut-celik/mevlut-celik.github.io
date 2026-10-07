/* ==========================================================================
   Mühür — textstrip.js
   "Edit text" draws the new line over a cover; this takes the old line
   out of the page's content stream as well, so it can no longer be
   selected, searched or copied — the edit replaces, not just hides.

   The content stream is tokenised and interpreted far enough to know
   where each text-showing operator starts and ends (graphics and text
   state, font widths from the font dictionaries). An operator is removed
   only when its whole run lies inside a cover; it is replaced by an empty
   TJ that advances by the same width, so text after it on the same line
   keeps its place. Anything the interpreter cannot measure (Type3 fonts,
   non-identity CMaps, standard fonts without /Widths) is left alone and
   stays hidden by the cover, which is the safe failure.
   ========================================================================== */

const lib = () => globalThis.PDFLib;

const IDENT = [1, 0, 0, 1, 0, 0];
function mul(m1, m2) {
  // apply m2 first, then m1
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
function pt(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

/* --------------------------------- Fonts -------------------------------- */
function num(obj) { return obj && obj.asNumber ? obj.asNumber() : 0; }

function fontInfo(doc, fontDict) {
  const P = lib();
  const ctx = doc.context;
  const get = (d, k) => (d ? d.lookup(P.PDFName.of(k)) : undefined);
  const subtype = get(fontDict, "Subtype");
  const sub = subtype ? subtype.asString() : "";
  if (sub === "/Type0") {
    const enc = get(fontDict, "Encoding");
    const encName = enc instanceof P.PDFName ? enc.asString() : "";
    if (encName !== "/Identity-H") return { known: false };
    const desc = get(fontDict, "DescendantFonts");
    const cid = desc instanceof P.PDFArray ? ctx.lookup(desc.get(0)) : null;
    if (!cid) return { known: false };
    const dw = get(cid, "DW");
    const widths = new Map();
    const W = get(cid, "W");
    if (W instanceof P.PDFArray) {
      const arr = W.asArray().map((x) => ctx.lookup(x));
      for (let i = 0; i < arr.length;) {
        const first = num(arr[i]);
        const next = arr[i + 1];
        if (next instanceof P.PDFArray) {
          next.asArray().forEach((w, j) => widths.set(first + j, num(ctx.lookup(w))));
          i += 2;
        } else {
          const last = num(next);
          const w = num(arr[i + 2]);
          for (let c = first; c <= last; c++) widths.set(c, w);
          i += 3;
        }
      }
    }
    return { known: true, twoByte: true, width: (code) => (widths.has(code) ? widths.get(code) : dw ? num(dw) : 1000) };
  }
  if (sub === "/Type1" || sub === "/TrueType" || sub === "/MMType1") {
    const Widths = get(fontDict, "Widths");
    if (!(Widths instanceof P.PDFArray)) return { known: false };
    const first = num(get(fontDict, "FirstChar"));
    const list = Widths.asArray().map((w) => num(ctx.lookup(w)));
    const fd = get(fontDict, "FontDescriptor");
    const missing = fd ? num(get(fd, "MissingWidth")) : 0;
    return { known: true, twoByte: false, width: (code) => { const w = list[code - first]; return w == null ? missing : w; } };
  }
  return { known: false };
}

function pageFonts(doc, page) {
  const P = lib();
  const map = new Map();
  let res;
  try { res = page.node.Resources(); } catch (e) { return map; }
  const fonts = res && res.lookup(P.PDFName.of("Font"));
  if (!(fonts instanceof P.PDFDict)) return map;
  for (const [name, ref] of fonts.entries()) {
    try { map.set(name.asString().slice(1), fontInfo(doc, doc.context.lookup(ref))); } catch (e) { map.set(name.asString().slice(1), { known: false }); }
  }
  return map;
}

/* ------------------------------- Tokeniser ------------------------------ */
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

function lexer(b) {
  let i = 0;
  const n = b.length;
  const skip = () => {
    for (;;) {
      while (i < n && WS.has(b[i])) i++;
      if (b[i] === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
      return;
    }
  };
  const literal = () => {
    const out = [];
    let depth = 1;
    i++;
    while (i < n) {
      const c = b[i++];
      if (c === 92) {
        const e = b[i++];
        if (e === 110) out.push(10); else if (e === 114) out.push(13); else if (e === 116) out.push(9);
        else if (e === 98) out.push(8); else if (e === 102) out.push(12);
        else if (e === 13) { if (b[i] === 10) i++; } else if (e === 10) { /* continuation */ }
        else if (e >= 48 && e <= 55) {
          let v = e - 48;
          for (let k = 0; k < 2 && b[i] >= 48 && b[i] <= 55; k++) v = v * 8 + (b[i++] - 48);
          out.push(v & 255);
        } else out.push(e);
      } else if (c === 40) { depth++; out.push(c); }
      else if (c === 41) { if (--depth === 0) break; out.push(c); }
      else out.push(c);
    }
    return new Uint8Array(out);
  };
  const hex = () => {
    i++;
    let s = "";
    while (i < n && b[i] !== 62) { const c = b[i++]; if (!WS.has(c)) s += String.fromCharCode(c); }
    i++;
    if (s.length % 2) s += "0";
    const out = new Uint8Array(s.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = parseInt(s.substr(k * 2, 2), 16) || 0;
    return out;
  };
  const regular = () => {
    const s = i;
    while (i < n && !WS.has(b[i]) && !DELIM.has(b[i])) i++;
    return String.fromCharCode.apply(null, b.subarray(s, i));
  };
  const next = () => {
    skip();
    if (i >= n) return null;
    const start = i;
    const c = b[i];
    if (c === 40) return { t: "str", v: literal(), start, end: i };
    if (c === 60 && b[i + 1] === 60) {
      i += 2;
      const items = [];
      for (;;) {
        skip();
        if (i >= n) break;
        if (b[i] === 62 && b[i + 1] === 62) { i += 2; break; }
        const tok = next();
        if (!tok) break;
        items.push(tok);
      }
      return { t: "dict", v: items, start, end: i };
    }
    if (c === 60) return { t: "str", v: hex(), start, end: i };
    if (c === 91) {
      i++;
      const items = [];
      for (;;) {
        skip();
        if (i >= n) break;
        if (b[i] === 93) { i++; break; }
        const tok = next();
        if (!tok) break;
        items.push(tok);
      }
      return { t: "arr", v: items, start, end: i };
    }
    if (c === 47) { i++; return { t: "name", v: regular(), start, end: i }; }
    if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) { i++; return { t: "junk", start, end: i }; }
    const word = regular();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: "num", v: parseFloat(word), start, end: i };
    if (word === "true" || word === "false" || word === "null") return { t: "kw", v: word, start, end: i };
    return { t: "op", v: word, start, end: i };
  };
  // after "ID": skip one whitespace, then binary data up to whitespace + "EI"
  const skipInlineImage = () => {
    i++;
    while (i < n - 1) {
      if (b[i] === 69 && b[i + 1] === 73 && WS.has(b[i - 1]) && (i + 2 >= n || WS.has(b[i + 2]))) { i += 2; return; }
      i++;
    }
    i = n;
  };
  return { next, skipInlineImage };
}

/* ------------------------------ Interpreter ----------------------------- */
function rewrite(bytes, fonts, rects) {
  const lx = lexer(bytes);
  const splices = [];
  let operands = [];
  let st = { ctm: IDENT, Tc: 0, Tw: 0, Th: 1, TL: 0, Tfs: 0, Ts: 0, font: null };
  const stack = [];
  let tm = IDENT, tlm = IDENT;
  let tmKnown = true;
  const tol = 1.5;
  const inside = ([x, y]) => rects.some((r) => x >= r.x0 - tol && x <= r.x1 + tol && y >= r.y0 - tol && y <= r.y1 + tol);
  const fmt = (v) => String(Math.round(v * 1000) / 1000);
  const newline = (tx, ty) => { tlm = mul(tlm, [1, 0, 0, 1, tx, ty]); tm = tlm; tmKnown = true; };

  const advance = (elements) => {
    const f = st.font && fonts.get(st.font);
    if (!f || !f.known) return null;
    let tx = 0;
    for (const el of elements) {
      if (el.t === "num") { tx += (-el.v / 1000) * st.Tfs * st.Th; continue; }
      if (el.t !== "str") continue;
      const s = el.v;
      if (f.twoByte) {
        for (let k = 0; k + 1 < s.length; k += 2) tx += ((f.width((s[k] << 8) | s[k + 1]) / 1000) * st.Tfs + st.Tc) * st.Th;
      } else {
        for (let k = 0; k < s.length; k++) tx += ((f.width(s[k]) / 1000) * st.Tfs + st.Tc + (s[k] === 32 ? st.Tw : 0)) * st.Th;
      }
    }
    return tx;
  };

  const show = (elements, spanStart, spanEnd, prefix) => {
    const tx = advance(elements);
    if (tx == null) { tmKnown = false; return; }
    if (tmKnown) {
      const trm = mul(st.ctm, tm);
      const a = pt(trm, 0, st.Ts);
      const z = pt(trm, tx, st.Ts);
      const hasGlyphs = elements.some((el) => el.t === "str" && el.v.length);
      if (hasGlyphs && inside(a) && inside(z)) {
        const scale = st.Tfs * st.Th;
        const move = scale ? `[${fmt((-tx / scale) * 1000)}] TJ` : "";
        splices.push({ start: spanStart, end: spanEnd, text: (prefix || "") + move });
      }
    }
    tm = mul(tm, [1, 0, 0, 1, tx, 0]);
  };

  for (;;) {
    const tok = lx.next();
    if (!tok) break;
    if (tok.t !== "op") { operands.push(tok); continue; }
    const op = tok.v;
    const nums = operands.map((o) => o.v);
    const spanStart = operands.length ? operands[0].start : tok.start;
    switch (op) {
      case "q": stack.push({ ...st }); break;
      case "Q": if (stack.length) st = stack.pop(); break;
      case "cm": if (nums.length === 6) st.ctm = mul(st.ctm, nums); break;
      case "BT": tm = tlm = IDENT; tmKnown = true; break;
      case "Td": newline(nums[0] || 0, nums[1] || 0); break;
      case "TD": st.TL = -(nums[1] || 0); newline(nums[0] || 0, nums[1] || 0); break;
      case "Tm": if (nums.length === 6) { tm = tlm = nums.slice(); tmKnown = true; } break;
      case "T*": newline(0, -st.TL); break;
      case "TL": st.TL = nums[0] || 0; break;
      case "Tc": st.Tc = nums[0] || 0; break;
      case "Tw": st.Tw = nums[0] || 0; break;
      case "Tz": st.Th = (nums[0] == null ? 100 : nums[0]) / 100; break;
      case "Ts": st.Ts = nums[0] || 0; break;
      case "Tf": st.font = operands[0] && operands[0].t === "name" ? operands[0].v : null; st.Tfs = nums[1] || 0; break;
      case "Tj": show(operands.filter((o) => o.t === "str").slice(0, 1), spanStart, tok.end); break;
      case "TJ": show(operands[0] && operands[0].t === "arr" ? operands[0].v : [], spanStart, tok.end); break;
      case "'": newline(0, -st.TL); show(operands.filter((o) => o.t === "str").slice(0, 1), spanStart, tok.end, "T* "); break;
      case '"': {
        st.Tw = nums[0] || 0;
        st.Tc = nums[1] || 0;
        newline(0, -st.TL);
        show(operands.filter((o) => o.t === "str").slice(0, 1), spanStart, tok.end, `${fmt(st.Tw)} Tw ${fmt(st.Tc)} Tc T* `);
        break;
      }
      case "ID": lx.skipInlineImage(); break;
      default: break;
    }
    operands = [];
  }
  if (!splices.length) return null;
  const enc = new TextEncoder();
  const parts = [];
  let at = 0;
  for (const s of splices.sort((x, y) => x.start - y.start)) {
    if (s.start < at) continue;
    parts.push(bytes.subarray(at, s.start), enc.encode(s.text));
    at = s.end;
  }
  parts.push(bytes.subarray(at));
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { bytes: out, removed: splices.length };
}

/* --------------------------------- Entry -------------------------------- */
// rects: [{ x0, y0, x1, y1 }] in PDF user space. Returns how many text
// operators were taken out (0 when the page was left as it was).
export function stripTextInRects(doc, page, rects) {
  const P = lib();
  if (!rects.length) return 0;
  const ctx = doc.context;
  const raw = page.node.get(P.PDFName.of("Contents"));
  const c = ctx.lookup(raw);
  const streams = c instanceof P.PDFArray ? c.asArray().map((r) => ctx.lookup(r)) : c ? [c] : [];
  if (!streams.length) return 0;
  const chunks = [];
  for (const s of streams) {
    if (s instanceof P.PDFRawStream) chunks.push(P.decodePDFRawStream(s).decode());
    else if (s instanceof P.PDFContentStream) chunks.push(s.getUnencodedContents());
    else return 0;
    chunks.push(new Uint8Array([10]));
  }
  let size = 0;
  for (const ch of chunks) size += ch.length;
  const bytes = new Uint8Array(size);
  let o = 0;
  for (const ch of chunks) { bytes.set(ch, o); o += ch.length; }

  const result = rewrite(bytes, pageFonts(doc, page), rects);
  if (!result) return 0;
  const ref = ctx.register(ctx.flateStream(result.bytes));
  page.node.set(P.PDFName.of("Contents"), ctx.obj([ref]));
  // pdf-lib caches the stream it draws into; start a fresh one after ours
  page.contentStream = undefined;
  page.contentStreamRef = undefined;
  return result.removed;
}
