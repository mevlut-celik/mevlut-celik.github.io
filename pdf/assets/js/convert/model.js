/* ==========================================================================
   Mühür — convert/model.js
   The one document model every converter speaks. Readers turn a format
   into it, writers turn it into a format, and layout.js turns it into a
   PDF — so N formats need 2N modules, not N².

   Two shapes:
   - FlowDocument  — text that flows and paginates (Word, text, HTML,
                     Markdown, a PDF read back as paragraphs).
   - FixedDocument — pages with absolutely placed items (PowerPoint
                     slides, a PDF page kept as a page).

   Units are points (1/72 in). Coordinates are top-left based, y down.
   Colours are "#rrggbb". Font names are the source's own family names
   ("Calibri", "Times New Roman"); fonts.js maps them to bundled files.
   ========================================================================== */

/**
 * @typedef {Object} Run
 * @property {string} text
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {boolean} [underline]
 * @property {boolean} [strike]
 * @property {number} [size]        points
 * @property {string} [color]       "#rrggbb"
 * @property {string} [highlight]   "#rrggbb" background
 * @property {string} [font]        family name from the source
 * @property {string} [link]        absolute URL
 * @property {"super"|"sub"} [valign]
 * @property {boolean} [break]      a line break (text is ignored)
 * @property {boolean} [tab]        a tab (text is ignored)
 */

/**
 * @typedef {Object} ListInfo
 * @property {boolean} ordered
 * @property {number} level         0-based nesting level
 * @property {string} [marker]      literal marker to print ("•", "1.", "a)")
 * @property {number} [start]
 */

/**
 * @typedef {Object} ParagraphStyle
 * @property {"left"|"center"|"right"|"justify"} [align]
 * @property {number} [heading]     1..6
 * @property {number} [indent]      left indent, points
 * @property {number} [indentRight] right indent, points
 * @property {number} [firstLine]   first-line indent, points (negative = hanging)
 * @property {number} [spaceBefore] points
 * @property {number} [spaceAfter]  points
 * @property {number} [lineHeight]  multiple of the font size (1.15 = Word default)
 * @property {ListInfo} [list]
 * @property {string} [shading]     "#rrggbb"
 * @property {boolean} [keepWithNext]
 * @property {boolean} [pageBreakBefore]
 * @property {{width:number,color:string}} [borderBottom]
 */

/** @typedef {{type:"paragraph", runs: Run[], style: ParagraphStyle}} Paragraph */

/**
 * @typedef {Object} ImageBlock
 * @property {"image"} type
 * @property {Uint8Array} data
 * @property {"image/png"|"image/jpeg"} mime
 * @property {number} width   points (display size)
 * @property {number} height  points
 * @property {"left"|"center"|"right"} [align]
 * @property {string} [alt]
 */

/**
 * @typedef {Object} TableCell
 * @property {Block[]} blocks
 * @property {number} [colspan]
 * @property {number} [rowspan]
 * @property {string} [shading]
 * @property {"top"|"middle"|"bottom"} [valign]
 */

/** @typedef {{cells: TableCell[], height?: number, header?: boolean}} TableRow */

/**
 * @typedef {Object} TableBlock
 * @property {"table"} type
 * @property {TableRow[]} rows
 * @property {number[]} [colWidths]  points; layout scales them to the frame
 * @property {{width:number,color:string}|null} [border]  null = no borders
 * @property {number} [headerRows]   repeated after a page break
 */

/** @typedef {{type:"pagebreak"}} PageBreak */
/** @typedef {{top:number,right:number,bottom:number,left:number}} Margins */
/** @typedef {{width:number,height:number,margin:Margins}} PageSetup */
/** @typedef {{type:"section", page: PageSetup}} SectionBreak  starts a new page with a new setup */

/** @typedef {Paragraph|ImageBlock|TableBlock|PageBreak|SectionBreak} Block */

/**
 * @typedef {Object} FlowDocument
 * @property {"flow"} kind
 * @property {PageSetup} page
 * @property {Block[]} blocks
 * @property {Block[]} [header]   repeated at the top of every page
 * @property {Block[]} [footer]   repeated at the bottom; "{n}" / "{t}" in text become page numbers
 * @property {{title?:string, author?:string, subject?:string}} [meta]
 */

/**
 * @typedef {Object} FixedText
 * @property {"text"} type
 * @property {number} x @property {number} y @property {number} w @property {number} h
 * @property {Paragraph[]} paragraphs
 * @property {number} [rotation]          degrees clockwise
 * @property {"top"|"middle"|"bottom"} [valign]
 * @property {string} [fill] @property {string} [stroke] @property {number} [strokeWidth]
 * @property {{top:number,right:number,bottom:number,left:number}} [inset]
 * @property {boolean} [autofit]          shrink text to fit the box
 */

/**
 * @typedef {Object} FixedImage
 * @property {"image"} type
 * @property {number} x @property {number} y @property {number} w @property {number} h
 * @property {Uint8Array} data
 * @property {"image/png"|"image/jpeg"} mime
 * @property {number} [rotation]
 */

/**
 * @typedef {Object} FixedShape
 * @property {"shape"} type
 * @property {"rect"|"roundRect"|"ellipse"|"line"} shape
 * @property {number} x @property {number} y @property {number} w @property {number} h
 * @property {string} [fill] @property {string} [stroke] @property {number} [strokeWidth]
 * @property {number} [rotation]
 */

/** @typedef {FixedText|FixedImage|FixedShape} FixedItem */

/**
 * @typedef {Object} FixedPage
 * @property {number} width @property {number} height
 * @property {{color?:string, image?:{data:Uint8Array, mime:string}}} [background]
 * @property {FixedItem[]} items
 * @property {string} [notes]   speaker notes / page notes (plain text)
 */

/** @typedef {{kind:"fixed", pages: FixedPage[], meta?: {title?:string, author?:string}}} FixedDocument */

/* ------------------------------- Page sizes ------------------------------ */
export const A4 = { width: 595.28, height: 841.89 };
export const LETTER = { width: 612, height: 792 };
export const MARGIN = { top: 72, right: 72, bottom: 72, left: 72 };

export function pageSetup(width, height, margin) {
  return { width: width || A4.width, height: height || A4.height, margin: { ...MARGIN, ...(margin || {}) } };
}

/* -------------------------------- Builders ------------------------------- */
export function run(text, props) {
  return { text: String(text == null ? "" : text), ...(props || {}) };
}

export function paragraph(runs, style) {
  const list = Array.isArray(runs) ? runs : [typeof runs === "string" ? run(runs) : runs];
  return { type: "paragraph", runs: list.filter(Boolean), style: { ...(style || {}) } };
}

export function heading(level, text, props) {
  return paragraph([run(text, props)], { heading: level, keepWithNext: true });
}

export function flowDocument(blocks, page, meta) {
  return { kind: "flow", page: page || pageSetup(), blocks: blocks || [], meta: meta || {} };
}

/* -------------------------------- Helpers -------------------------------- */
export function runsText(runs) {
  return (runs || []).map((r) => (r.break ? "\n" : r.tab ? "\t" : r.text)).join("");
}

// Plain text of a list of blocks, paragraphs separated by newlines and
// table cells by tabs. Used by the text writer and by tests.
export function blocksText(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === "paragraph") out.push(runsText(b.runs));
    else if (b.type === "table") {
      for (const row of b.rows) out.push(row.cells.map((c) => blocksText(c.blocks).replace(/\n+/g, " ")).join("\t"));
    } else if (b.type === "pagebreak" || b.type === "section") out.push("\f");
  }
  return out.join("\n");
}

// Merge neighbouring runs that look the same, so writers emit fewer spans.
export function mergeRuns(runs) {
  const out = [];
  const same = (a, b) => ["bold", "italic", "underline", "strike", "size", "color", "highlight", "font", "link", "valign"]
    .every((k) => (a[k] || null) === (b[k] || null));
  for (const r of runs || []) {
    const last = out[out.length - 1];
    if (last && !last.break && !last.tab && !r.break && !r.tab && same(last, r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export function sniffImageMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return "application/octet-stream";
}

// Turkish-aware number reading: "1.234,56" and "1,234.56" both become 1234.56.
export function parseNumber(text) {
  const s = String(text).trim().replace(/\s/g, "");
  if (!/^[-+(]?[₺$€£]?[-+]?\d[\d.,]*%?[)]?$/.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^[₺$€£]/, ""));
  let t = s.replace(/[()₺$€£%+-]/g, "");
  const lastComma = t.lastIndexOf(","), lastDot = t.lastIndexOf(".");
  if (lastComma > lastDot) t = t.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) t = t.replace(/,/g, "");
  else if (lastComma >= 0 && lastDot < 0) {
    // "1,5" decimal, "1,234" thousands
    t = /,\d{3}$/.test(t) && !/^0,/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const v = Number(t);
  if (!isFinite(v)) return null;
  const pct = /%$/.test(s);
  return (neg ? -v : v) / (pct ? 100 : 1);
}
