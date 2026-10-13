/* ==========================================================================
   Mühür — convert/fonts.js
   Source documents name fonts we cannot ship (Calibri, Times New Roman,
   Arial…). Each is mapped to a bundled, metric-compatible open font so
   line breaks land where the author saw them:

     Calibri / Aptos-era Office sans  -> Carlito   (Calibri metrics)
     Cambria                          -> Caladea   (Cambria metrics)
     Arial / Helvetica / sans         -> Liberation Sans
     Times New Roman / serif          -> Liberation Serif
     Courier New / monospace          -> Liberation Mono

   All five cover Turkish (ğ ş ı İ …). Writers going the other way (PDF ->
   docx/pptx) use officeName() to put a familiar name back in the file.
   ========================================================================== */

export const FAMILIES = {
  sans:    { file: "LiberationSans",  upm: 2048, ascent: 1854, descent: 434, office: "Arial" },
  serif:   { file: "LiberationSerif", upm: 2048, ascent: 1825, descent: 443, office: "Times New Roman" },
  mono:    { file: "LiberationMono",  upm: 2048, ascent: 1705, descent: 615, office: "Courier New" },
  carlito: { file: "Carlito",         upm: 2048, ascent: 1950, descent: 550, office: "Calibri" },
  caladea: { file: "Caladea",         upm: 1000, ascent: 900,  descent: 250, office: "Cambria" },
};

const RULES = [
  [/calibri|carlito|aptos|segoe|candara|corbel|trebuchet|gill sans|myriad|source sans|open sans|lato|roboto|noto sans|inter\b/i, "carlito"],
  [/cambria|caladea/i, "caladea"],
  [/courier|mono|consol|menlo|lucida console|typewriter|cmtt/i, "mono"],
  [/times|serif|georgia|garamond|book antiqua|palatino|baskerville|minion|constantia|century|charter|liberation serif|tinos|cmr|lmroman|roman/i, "serif"],
  [/arial|helvet|liberation sans|arimo|verdana|tahoma|sans|futura|frutiger|nimbus/i, "sans"],
];

// Family name (anything a document says) -> key of FAMILIES.
export function familyKey(name) {
  if (!name) return "sans";
  const n = String(name).replace(/^[A-Z]{6}\+/, "");
  if (FAMILIES[n]) return n;
  for (const [re, key] of RULES) {
    // "sans-serif" must not fall into the serif rule
    if (key === "serif" && /sans/i.test(n)) continue;
    if (re.test(n)) return key;
  }
  return "sans";
}

export function fontFile(key, bold, italic) {
  const f = FAMILIES[key] || FAMILIES.sans;
  const style = bold && italic ? "BoldItalic" : bold ? "Bold" : italic ? "Italic" : "Regular";
  return f.file + "-" + style + ".ttf";
}

// Ascent / descent in em, for baselines and line boxes.
export function metrics(key) {
  const f = FAMILIES[key] || FAMILIES.sans;
  return { ascent: f.ascent / f.upm, descent: f.descent / f.upm };
}

// The Office family a writer should name for a bundled or PDF font.
export function officeName(name) {
  return (FAMILIES[familyKey(name)] || FAMILIES.sans).office;
}

// Bold / italic hints hidden in a PostScript font name ("Arial-BoldMT").
export function styleFromName(name) {
  const n = String(name || "").toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi|cmbx|sfbx|bx\d|-bd\b/.test(n),
    italic: /italic|oblique|cmti|cmsl|sfti|-it\b/.test(n),
  };
}
