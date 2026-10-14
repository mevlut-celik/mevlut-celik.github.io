# Mühür — conversion & OCR: status and contract

## Status (13 Ekim 2026)

Done and committed:
- Vendored: tesseract.js 7 (+ SIMD/plain LSTM cores, `tur` and `eng`
  best_int data), fflate 0.8.3, Carlito/Caladea fonts (Calibri/Cambria metrics).
- `assets/js/libs.js`: `fflate()`, `tesseract()`, `tesseractPaths()`, Node
  test hooks (`globalThis.__MUHUR_NODE__`). Backward compatible.
- Shared modules: `convert/model.js`, `convert/zip.js`, `convert/fonts.js`,
  `convert/canvas.js` (incl. textless page render via pdf.js `operationsFilter`).
- `convert/to-docx.js` (FlowDocument → .docx) — written, smoke-tested
  (python-docx and textutil open it), not yet reviewed in depth.

Done since (13 Ekim 2026, OCR + e-imza kartı oturumu):
- H `js/ocr.js` — as specified below, plus `removeRules(canvas)`: long
  horizontal/vertical rules are painted white on the copy sent to tesseract
  (ruled table cells were otherwise skipped), and PSM 3 is set explicitly
  (tesseract.js defaults to 6). Tests: `tests/ocr.mjs`, `tests/ocrtext.mjs`,
  `tests/ocr-overlay.mjs`, `tests/rules.mjs`.
- The OCR part of I: `js/ocrui.js` (dialog: language / pages / dpi, progress
  + cancel, result saved as version "OCR uygulandı"; `#ocr-banner` for
  scanned documents), toolbar button `data-action="ocr"`, page menu entry.
  The conversion part of I (`convert/index.js`, `convertui.js`) is still open.
- E-imza kartı (Kamu SM / TÜBİTAK AKİS, any PKCS#11): `kopru/` local bridge
  (Java 8+, SunPKCS11 + httpserver, 127.0.0.1:21730, origin allow-list),
  `js/kart.js` (fetch, or a relay window for Safari), `js/trust.js` (pinned
  Kamu SM NES roots/sub-CAs v6+v7), `sign.js` now writes PAdES B-B
  (ETSI.CAdES.detached, ESS signing-certificate-v2, digest by key: P-384 →
  SHA-384) with a pluggable signer, and verifies chains to the anchors.
  Tests: `tests/sign-cades.mjs`, `tests/kart-sign.mjs`, `tests/chain.mjs`.

Not started yet: modules A `pdf-analyze.js`, B `layout.js`, D `xlsx.js`,
E `pptx.js`, F `from-docx.js`, G `text-formats.js`, and the conversion UI
(`convert/index.js`, `convertui.js`).

Testing on any machine: `cd pdf/dev && npm install`, then e.g.
`node tests/quick-docx.mjs` or `node tests/smoke.mjs` (needs poppler, gs,
python-docx/openpyxl/python-pptx for the validation steps described below).
Paths in the sections below that point to a scratchpad now live in `pdf/dev/`
(harness.mjs, fixtures/, tests/).


Mühür is a browser-only PDF editor (no server) at
`/Users/mevlutcelik/Documents/GitHub/mevlut-celik.github.io/pdf/`. It is
deployed to GitHub Pages as static files. UI language is **Turkish**. We are
adding (1) PDF conversion in both directions (Word, Excel, PowerPoint,
images, text, Markdown, HTML) and (2) OCR (scanned PDFs → searchable PDFs).

## Ground rules (every module)

- Plain browser ES modules in `pdf/assets/js/…` (no bundler, no TypeScript,
  no npm imports). Third-party code is ONLY what is vendored and loaded
  through `pdf/assets/js/libs.js`:
  - `pdfjs()` → pdf.js 6 module (getDocument, OPS, AnnotationMode, Util…)
  - `openPdf(bytes)` / `closePdf(pdf)` → open/close a pdf.js document
  - `pdflib()` → `globalThis.PDFLib` (pdf-lib 1.17.1); `globalThis.fontkit` is also loaded
  - `fflate()` → zip; prefer the helpers in `convert/zip.js`
  - `tesseract()` + `tesseractPaths()` → tesseract.js 7 (`createWorker(langs, 1, paths)`)
  - `fontBytes(file)` → bytes of a bundled TTF in `pdf/assets/fonts/`
- **Read-only shared modules** (do not edit; if you need a change, say so in
  your final report under `shared_module_requests`):
  - `js/libs.js`, `js/convert/model.js` (THE document model — read its JSDoc
    typedefs first), `js/convert/zip.js`, `js/convert/fonts.js`,
    `js/convert/canvas.js`, `js/util.js`, and all existing app modules
    (`pdfwork.js`, `editor.js`, `main.js`, …) unless you are the UI owner.
- Only create/modify the files you own (listed in your task).
- Style like the existing code: a header comment block that explains the
  module's approach, `/* ---- section ---- */` separators, 2-space indent,
  double quotes, semicolons, small functions, comments that explain *why*.
  User-facing strings and thrown `Error` messages in Turkish.
- Must work in current Chrome, Safari, Firefox. Use `globalThis.DOMParser`
  for XML (xmldom in tests). Never use `document` directly for canvases —
  use `createCanvas`/`canvasToBytes`/`renderPage` from `convert/canvas.js`
  (they work in Node too). Do not use `Date.now()`-style nondeterminism in
  file contents except where a timestamp is semantically required.
- Units: points, top-left origin, y down. Colours `#rrggbb`.
- Turkish text must round-trip: ğ ü ş ı ö ç Ğ Ü Ş İ Ö Ç (and ₺ where the
  target format supports it; bundled fonts lack ₺ — substitute "TL" when
  drawing into a PDF with a font that lacks the glyph, never crash).
- Performance: a 50-page document must convert without freezing forever;
  report progress through an optional `onProgress(done, total, label)`.
- Robustness: malformed input → throw `Error` with a short Turkish message;
  unknown/unsupported features are skipped, never fatal.

## Fonts (convert/fonts.js)

Bundled: Liberation Sans/Serif/Mono (Arial/Times/Courier metrics), Carlito
(Calibri metrics), Caladea (Cambria metrics), each Regular/Bold/Italic/
BoldItalic. `familyKey(name)` maps any family name → `sans|serif|mono|carlito|caladea`;
`fontFile(key,bold,italic)` → file name for `fontBytes()`; `metrics(key)` →
ascent/descent in em; `officeName(name)` → Office family to write into
docx/pptx/xlsx; `styleFromName(psName)` → bold/italic hints.

## Model (convert/model.js) — summary

FlowDocument `{kind:"flow", page:{width,height,margin}, blocks, header?, footer?, meta?}`
Blocks: `paragraph{runs, style}`, `image{data,mime,width,height,align?}`,
`table{rows:[{cells:[{blocks,colspan?,rowspan?,shading?,valign?}],header?}], colWidths?, border?, headerRows?}`,
`pagebreak`, `section{page}`.
Run: `{text,bold,italic,underline,strike,size,color,highlight,font,link,valign,break,tab}`.
ParagraphStyle: `{align, heading, indent, indentRight, firstLine, spaceBefore, spaceAfter, lineHeight, list:{ordered,level,marker,start}, shading, keepWithNext, pageBreakBefore, borderBottom}`.
FixedDocument `{kind:"fixed", pages:[{width,height,background?:{color?,image?}, items, notes?}]}`;
items: `text{x,y,w,h,paragraphs,rotation?,valign?,fill?,stroke?,inset?,autofit?}`,
`image{x,y,w,h,data,mime,rotation?}`, `shape{shape:"rect"|"roundRect"|"ellipse"|"line",x,y,w,h,fill?,stroke?,strokeWidth?,rotation?}`.
Helpers: `run, paragraph, heading, flowDocument, pageSetup, A4, runsText, blocksText, mergeRuns, sniffImageMime, parseNumber`.

## Modules and exact APIs

### A. `js/convert/pdf-analyze.js` — PDF → structure
```js
export async function analyzePdf(bytes, opts = {}) // -> Analysis
//   opts: { pages?: number[] (0-based, default all), images?: true,
//           ocr?: async (pageIndex, canvas, scale) => OcrPage | null,   // called for scanned pages only
//           onProgress?(done,total,label) }
// Analysis = { meta:{title,author,subject}, pages: AnalyzedPage[] }
// AnalyzedPage = {
//   index, width, height,                 // display points (page rotation applied)
//   scanned: boolean,                     // little/no extractable text and a large image covers the page
//   runs:  [{x,y,w,h,baseline,text,size,font,bold,italic,color}],   // positioned text runs (display space)
//   lines: [{x,y,w,h,baseline,runs:Run[], text}],                  // reading order
//   blocks: Block[],                       // flow blocks for this page: paragraphs (merged lines,
//                                          //   headings by relative size/bold, lists by bullet/number
//                                          //   markers, alignment detection), tables (ruled tables from
//                                          //   drawn lines AND unruled column-aligned text), images
//                                          //   (cropped from a render at ≥150 dpi, PNG or JPEG)
//   tables: TableBlock[] with extra `bbox:{x,y,w,h}` (also present inside blocks),
//   images: [{x,y,w,h,data,mime}],
// }
export function analysisToFlow(analysis)   // -> FlowDocument (pages joined by pagebreak; page setup from page 1; margins estimated from text bounds)
export async function analysisToFixed(analysis, bytes, opts = {}) // -> FixedDocument for PowerPoint:
//   each page: background.image = textless render (renderPage(..., {textless:true})) at ~150 dpi JPEG,
//   items = editable text boxes, one per paragraph/line group, positioned exactly, with runs styled.
```
Use pdf.js `getTextContent()` (styles, transforms; `fontExtraProperties` is on, so
`page.commonObjs.get(fontName).name` gives the PostScript name after the page
has been rendered or `getOperatorList()` called), and `getOperatorList()` for
images (OPS.paintImageXObject / paintInlineImageXObject with the CTM tracked through
save/restore/transform) and for ruled-table lines (constructPath/rectangle strokes & fills).
For scanned pages call `opts.ocr` (if given) with a render and turn its words into runs/lines.
OcrPage format: see module H.

### B. `js/convert/layout.js` — model → PDF (pdf-lib)
```js
export async function flowToPdf(flow, opts = {})   // -> Uint8Array
export async function fixedToPdf(fixed, opts = {}) // -> Uint8Array
//   opts: { onProgress?, title? }
```
Flow layout: paginate blocks into page frames (page size/margins from
`flow.page`, changed by `section` blocks); runs with font mapping via
`fonts.js` (embed with `subset:true`, cache per file; one PDFFont per file —
NB pdf-lib serialises a font when form fields use it; not relevant here),
sizes, bold/italic/underline/strike, colours, highlight, links (URI link
annotations), super/subscript; paragraph align left/center/right/justify
(justify: distribute spaces, last line left), indents, first-line/hanging
indent, spacing before/after, line height (default 1.15), headings (default
sizes if run has no size: h1 20, h2 16, h3 14, h4 12, bold), keepWithNext,
lists (marker drawn in the hanging indent: "•", "◦", "▪" by level or the
ordered number `1.`/`a.`/`i.` with continuing counters; `list.marker`
overrides), tables (column widths scaled to frame; borders; shading;
colspan; rowspan best effort; cell padding 4pt; rows split across pages
when taller than a page, header rows repeated), images (scale down to fit
frame width/remaining height; move to next page if not fitting), header/
footer blocks on every page with `{n}`/`{t}` page numbers, page breaks.
Default font size 11pt, default family "Calibri"→Carlito when the run has
no font. Glyph fallback: characters missing from the chosen font are drawn
with Liberation Sans if it has them, else replaced ("₺"→"TL", "→"→"->",
others "?"). Must never throw on missing glyphs.
Fixed layout: one PDF page per FixedPage with background colour/image,
shapes, images, text boxes (paragraph layout inside the box with inset
default 7.2pt/3.6pt, valign, autofit shrink, rotation around box centre).
Set PDF metadata (title/author) and Producer "Mühür PDF".

### C. `js/convert/to-docx.js` — FlowDocument → .docx
```js
export async function flowToDocx(flow, opts = {}) // -> Uint8Array (valid OOXML, opens in Word, LibreOffice, Pages)
```
Parts: [Content_Types].xml, _rels/.rels, docProps/core.xml & app.xml,
word/document.xml, word/styles.xml (Normal + Heading1..6 + ListParagraph +
TableGrid + Hyperlink), word/numbering.xml (bullet and decimal multilevel
abstractNums; restart numbering per list), word/settings.xml,
word/fontTable.xml, word/_rels/document.xml.rels, media for images
(word/media/imageN.png|jpeg, inline wp:drawing with correct EMU extents),
hyperlinks (external rels), tables (w:tbl with tblGrid widths in twips,
borders, shading, gridSpan, vMerge), page breaks, sections (sectPr per
section with pgSz/pgMar incl. orientation), header/footer parts if
flow.header/footer (with PAGE field for `{n}`, NUMPAGES for `{t}`). Run
props: b, i, u, strike, sz (half-points), color, highlight→shd fill,
rFonts (officeName), vertAlign. Paragraph props: jc, ind, spacing
(before/after in twips, line in 240ths), pStyle HeadingN, numPr.
Escape XML; strip control chars.

### D. `js/convert/xlsx.js` — Excel both directions
```js
export async function sheetsToXlsx(sheets, opts = {}) // -> Uint8Array
//   sheets: [{ name, rows: Cell[][], colWidths?: number[] (characters), merges?: ["A1:C1"], freeze?: "A2" }]
//   Cell: string | number | boolean | Date | null | { v, bold?, italic?, color?, fill?, numFmt?, align? }
export function analysisToSheets(analysis)  // -> sheets: one sheet per PDF page that has tables
//   (every detected table, stacked with a blank row between, numbers parsed with parseNumber
//    so "1.234,50" becomes 1234.5 with a "#,##0.00" format); pages without tables → one sheet
//   with the page's lines split into columns by large x gaps. Sheet names unique, ≤31 chars, no []:*?/\
export async function xlsxToFlow(bytes, opts = {}) // -> FlowDocument
//   each worksheet → section (landscape A4 when the used range is wide) + heading(sheet name) +
//   table (cell text formatted with its number format: dates dd.mm.yyyy, thousands "1.234,50",
//   percent; shared strings, inline strings, booleans, formulas use cached <v>; bold/italic/
//   fill/font colour/alignment from styles.xml; merged cells → colspan/rowspan; column widths
//   from <cols>; empty trailing rows/cols trimmed). Very large sheets: cap at 5,000 rows per
//   sheet with a trailing paragraph saying how many rows were omitted.
```

### E. `js/convert/pptx.js` — PowerPoint both directions
```js
export async function fixedToPptx(fixed, opts = {}) // -> Uint8Array
//   slide size = first page size (points → EMU: ×12700); every page a slide (if a page has a
//   different size, scale its content to the slide size); background image as a full-slide
//   picture at the back (or p:bg with blipFill); text items → p:sp txBox with a:bodyPr insets,
//   paragraphs/runs (sz in 100ths pt, b, i, u, strike, solidFill colour, latin typeface via
//   officeName), alignment; images → p:pic; shapes → prstGeom; notes → notesSlide.
//   Include presentation.xml, presProps, viewProps, tableStyles, a minimal slideMaster +
//   slideLayout (blank) + theme1.xml so PowerPoint/Keynote/LibreOffice open it without repair.
export async function pptxToFixed(bytes, opts = {}) // -> FixedDocument
//   slide size from presentation.xml; for each slide in order (presentation.xml sldIdLst + rels):
//   background (slide bg, else layout, else master: solid colour or picture), shapes from the
//   slide AND inherited placeholders' positions from layout/master when the slide sp has no
//   xfrm; text bodies → paragraphs with runs (size: run sz, else list-style/placeholder defaults,
//   title ≈ 44pt, body ≈ 28/24/20pt by level; bullets for body placeholders), alignment, colours
//   (srgbClr; schemeClr resolved through theme), pictures (p:pic blip → media), basic preset
//   shapes rect/roundRect/ellipse/line with solid fill/outline, group shapes (grpSp with
//   chOff/chExt transform), tables (graphicFrame a:tbl → text boxes per cell with borders) best
//   effort, rotation. Notes text → page.notes.
```

### F. `js/convert/from-docx.js` — Word → FlowDocument
```js
export async function docxToFlow(bytes, opts = {}) // -> FlowDocument
```
Read document.xml body in order: paragraphs (w:p) with runs (w:r: w:t,
w:tab, w:br incl. page breaks, w:sym best effort), hyperlinks (w:hyperlink
r:id → external target), fields (keep displayed result text), styles.xml
(docDefaults rPr/pPr, paragraph style chain via basedOn incl. Heading1..6
→ `style.heading`, Title → heading 1 with large size, character styles),
direct formatting (b,i,u,strike,sz,color,highlight/shd,rFonts ascii/hAnsi
with theme fonts resolved via theme1.xml, vertAlign, caps→uppercase),
paragraph props (jc incl. both→justify, ind left/right/firstLine/hanging,
spacing before/after/line+lineRule, keepNext, pageBreakBefore, shd, pBdr
bottom), numbering.xml (numPr numId/ilvl → list{ordered,level,marker} with
real counters per numId/level incl. lvlText like "%1." and numFmt
decimal/lowerLetter/upperLetter/lowerRoman/upperRoman/bullet), tables
(w:tbl: tblGrid widths, gridSpan, vMerge restart/continue → rowspan, cell
shading, borders on/off, nested tables), images (w:drawing inline/anchor:
a:blip r:embed → media bytes; extent EMU → points; skip EMF/WMF with a
placeholder paragraph "[görsel]"; convert GIF/BMP/WEBP to PNG via canvas
if possible else skip), sections (sectPr in pPr and body: pgSz w/h/orient,
pgMar → SectionBreak / flow.page), header/footer of the first section
(default type) → flow.header/footer with PAGE/NUMPAGES fields mapped to
`{n}`/`{t}`, footnotes appended as a "Dipnotlar" list at the end (best
effort), core.xml title/creator → meta. Lists: Word's "List Bullet"/"List
Number" styles carry numPr in the style — resolve it.

### G. `js/convert/text-formats.js` — TXT / Markdown / HTML both directions + images export
```js
export function flowToText(flow)              // -> string (paragraphs separated by blank lines? no: one \n per paragraph, \n\n between blocks of different kinds; tables tab-separated; page breaks as \f)
export function flowToMarkdown(flow)          // -> string (GFM: #… headings, **bold**, *italic*, ~~strike~~, links, lists with nesting, pipe tables, images as ![alt](image-N.png) with the image bytes returned separately)
export function flowToHtml(flow, opts = {})   // -> string (complete standalone HTML5 doc, UTF-8, inline <style>, images embedded as data: URLs, tables, lists, alignment, colours, fonts)
export async function flowToMarkdownZip(flow) // -> Uint8Array zip with document.md + images/
export function textToFlow(text, opts = {})   // -> FlowDocument (paragraph per blank-line-separated block; single newlines inside a block become line breaks; monospace if it looks like a table/code; tabs kept)
export function markdownToFlow(md, opts = {}) // -> FlowDocument (CommonMark/GFM subset: ATX & setext headings, paragraphs, emphasis/strong/strike/code spans, links, images (data: URLs only; others → alt text), ordered/unordered nested lists, task lists, blockquotes (indent + shading), fenced/indented code (mono + shading), pipe tables with alignment, horizontal rules (borderBottom), hard breaks)
export function htmlToFlow(html, opts = {})   // -> FlowDocument (DOMParser text/html; h1-h6, p, div, br, b/strong, i/em, u, s/del, sup/sub, span/font with inline style color/font-size/font-weight/font-style/text-align/background-color/font-family, a, ul/ol/li nested, table/thead/tbody/tr/td/th with colspan/rowspan, img with data: src (others skipped), blockquote, pre/code, hr, page-break-before/after styles; ignore script/style/head)
export async function pdfToImages(bytes, opts = {}) // -> { files: [{name, data, mime}], zip?: Uint8Array }
//   opts: { format: "png"|"jpeg", dpi: 150, pages?: number[], quality: 0.9, onProgress? }; zip only when >1 page; names "<base>-sayfa-<n>.<ext>"
```
In Node tests, `DOMParser` from xmldom handles XML only; for `htmlToFlow`
parse with `new DOMParser().parseFromString(html, "text/html")` in the
browser — in Node tests use the `linkedom` style fallback: if
`globalThis.DOMParser` cannot parse "text/html" (xmldom), fall back to a
tolerant XHTML-ish parse after light normalisation (close void tags), but
code the browser path first.

### H. `js/ocr.js` — OCR and searchable PDFs
```js
export async function createOcr(opts = {})   // -> { recognize(canvasOrBytes) -> OcrPage, terminate() }
//   opts: { langs: "tur+eng", onProgress?(p:0..1, label) } ; uses tesseract() + tesseractPaths();
//   one worker reused across pages; PSM auto (3).
// OcrPage = { width, height (pixels of the input), words: [{text, x0,y0,x1,y1 (px), confidence, line}],
//             lines: [{text, x0,y0,x1,y1, baseline:[x0,y0,x1,y1]|null, words:number[]}], text }
export async function pageNeedsOcr(pdf, pageIndex) // -> boolean (no/very little text & has image content covering much of the page)
export async function ocrPdf(bytes, opts = {})     // -> { bytes: Uint8Array, pages: number[] (OCRed), text: string[] }
//   opts: { pages: "auto"|"all"|number[], langs, dpi: 300 (cap pixel count ~ 12 MP), onProgress?(done,total,label), signal?: AbortSignal }
//   Renders each page with renderPage (canvas.js), recognises it, and writes an INVISIBLE text
//   layer (text render mode 3) into the ORIGINAL page with pdf-lib: one TJ/Tj per word, Liberation
//   Sans subset, font size from word height, horizontal scale (Tz) so the word's advance matches its
//   OCR width, positioned on the baseline, honouring page rotation/crop box (map pixel → display →
//   PDF user space; see pdfwork.js displayToPdf). Words whose glyphs the font lacks get those
//   characters replaced. Pages that already contain text are skipped in "auto" mode.
//   Result: selectable, searchable, copyable text matching the image; visual appearance unchanged.
export function ocrPageToRuns(ocrPage, scale) // -> runs/lines in display points, for pdf-analyze's opts.ocr
```

### I. UI integration (owner of `js/convert/index.js`, `js/convertui.js`, and edits to `js/main.js`, `js/editor.js`, `index.html`, `assets/css/main.css`)
`js/convert/index.js` — facade used by the UI:
```js
export const IMPORT_TYPES  // accept list for <input type=file>: .pdf,.docx,.xlsx,.pptx,.txt,.md,.html,.htm, images
export function kindOf(file) // "pdf"|"docx"|"xlsx"|"pptx"|"text"|"markdown"|"html"|"image"|null (by extension + mime + magic bytes)
export async function toPdf(file, opts) // -> { bytes, name } using readers + layout (images via pdfwork.imagesToPdf)
export const EXPORT_FORMATS // [{id:"docx",label:"Word (.docx)",ext:"docx",mime}, xlsx, pptx, png, jpeg, txt, md, html]
export async function fromPdf(bytes, format, opts) // -> { bytes, name, mime } (runs analysis once; for scanned PDFs runs OCR first when opts.ocr !== false)
```
UI requirements:
- Library: the drop zone accepts Word/Excel/PowerPoint/text/Markdown/HTML in
  addition to PDF/images; non-PDF files are converted to PDF on import (busy
  overlay with progress, then the new document opens) — "Word, Excel,
  PowerPoint" button label/copy updated. Add a **"Dönüştür"** button in the
  drop zone that opens a converter dialog with two tabs: "PDF'ye
  dönüştür" (pick files → creates documents) and "PDF'den dönüştür" (pick a
  PDF from the device or a document from the library → choose format →
  download). Card menu gets "Dönüştür…" (export submenu).
- Editor: download menu gets an "Farklı dışa aktar" group (Word, Excel,
  PowerPoint, PNG, JPEG, Metin, Markdown, HTML) that exports the CURRENT
  edited document (use `E.buildBytes()` first). Add an **OCR** action:
  toolbar button (icon `scan-text` may not exist in the sprite — use an
  existing one like `text-cursor-input` or add a symbol to icons.svg with a
  Lucide path) and "Metni tanı (OCR)…" in the page/document menus. OCR
  dialog: language (Türkçe+İngilizce default, Türkçe, İngilizce), pages
  (taranmış sayfalar / tümü / geçerli sayfa), DPI (Hızlı 200 / Dengeli 300),
  progress with cancel; result saved as a new version "OCR uygulandı" and
  the editor reloads (`E.reloadVersion()`); toast with word count.
- When an opened document looks scanned (no text on the first pages), show
  a banner (reuse `#sig-banner` styling via a new element `#ocr-banner`):
  "Bu belge taranmış görünüyor. Metni seçilebilir ve aranabilir yapmak için
  OCR uygula." with a button.
- Keep the visual language (tokens, `.btn`, `dialog()`/`menu()`/`busy()`/
  `toast()` from ui.js). Mobile-friendly.
