# mevlut-celik.github.io

Personal site of Mevlüt Çelik — frontend, backend and platform development.

Written from scratch: no Jekyll theme, no fork, no framework, no build step.
Three files carry the homepage; every subproject repeats the same layout.

```
index.html            markup + content
assets/css/main.css   design tokens, components, responsive rules
assets/js/main.js     current year in the footer
assets/files/         curriculum vitae (PDF)
assets/img/           favicon
.nojekyll             served as plain static files by GitHub Pages
```

## Design language

Plain and quiet: a dark page, one typeface (Inter), a single 720px reading
column, hairline rules and muted secondary text. No imagery, grid overlays
or animation — the content is the design.

Stack logos in `assets/img/stack/` come from [Simple Icons](https://simpleicons.org)
(CC0), recoloured to `#d4d4d8`; the Windows mark is a plain four-square glyph
because Simple Icons no longer ships Microsoft logos. The trademarks belong to
their owners. Company and school logos in `assets/img/orgs/` are shown as
small white tiles beside each entry.

## SEO

- `<head>`: descriptive title and meta description, canonical URL, Open Graph
  and Twitter card tags with `assets/img/og.png` (1200×630), apple-touch-icon.
- JSON-LD `Person` + `WebSite` structured data (name variants, job, employer,
  alma mater, location, GitHub / LinkedIn / YouTube profiles).
- `robots.txt`, `sitemap.xml` (homepage, mescid, simulation, waves) and a
  root `404.html`. Client, research and personal subprojects are left out of
  the sitemap on purpose.

## Shared skeleton

The homepage and every subproject below follow the same structure, while
each keeps its own visual character. Projects that are deployed on their
own (`ptns/` on Vercel, `parlar-kariyer/public/` on a PHP host) carry their
own copy, so nothing is loaded across folders.

```
<project>/
  *.html                pages
  assets/css/main.css   Tokens → Reset → Typography → Button → Nav → Bands
                        → components → Footer → Responsive
  assets/js/main.js     Helpers → one initX() per feature → boot()
  assets/img/           images (when the project has any)
```

- The **Reset** block, the JS **Helpers** (`$`, `$$`) and the **boot** sequence
  are byte-identical in every project. Change them everywhere or nowhere.
- Every stylesheet uses the same token names — `--canvas`, `--surface`, `--ink`,
  `--ink-mute`, `--accent`, `--accent-ink`, `--hairline`, `--focus`,
  `--font-display`, `--font-body`, `--size-body`, `--space-*`, `--radius-*`,
  `--column`, `--ease`. The values are what give each project its character.
- Class names are BEM-ish: `block__element--modifier`. Every page uses `.nav`,
  `.band` / `.band__inner`, `.eyebrow`, `.display`, `.lead`, `.btn`.
- Each `initX()` queries its own nodes, returns early when they are missing,
  and binds its own listeners — so one `main.js` can serve several pages.

| Folder | Character |
|---|---|
| `/` | Plain dark page — one typeface, one column, hairline rules |
| `busra/` | Literary journal — warm paper, plum tulip, serif masthead, arched frame |
| `davetiye/` | The printed invitation — beige paper, spaced serif caps, pink script names |
| `freshdata-sn/` | Provisioning bench — workshop grey, FRESHDATA orange, the S/N printed as a device label |
| `mescid/` | The app's own brand — #0D0D0D and #CC0000, phone mock-up |
| `parlar-kariyer/` | Institutional job notice — foundation navy, numbered sections, sticky summary |
| `pdf/` | Signing desk — warm grey desk under white pages, ink-blue tools, wax-seal red for signing |
| `ptns/` | University research instrument — quiet paper, METU red signals, step rail |
| `simulation/` | Lab notebook — graph paper, blueprint ink, red pen for the force |
| `waves/` | Bench oscilloscope — phosphor screen, instrument keys |

IEEE SİU 2027 is published at https://siu2027.medipol.edu.tr/ (source kept in a private repository).

`pdf/` (Mühür) is an application rather than a page, so its `main.js` is an
ES module that boots the same way and imports its neighbours: `store.js`
(accounts, AES-GCM, IndexedDB), `docs.js`, `editor.js` with `ed.js`,
`panels.js` and `sigui.js`, `pdfwork.js` (state → PDF), `textstrip.js`
(removes edited text from content streams), `sign.js` (PAdES B-B signing and
verification, chains to the Kamu SM roots pinned in `trust.js`), `ocr.js` /
`ocrui.js` (tesseract.js OCR into an invisible text layer) and `kart.js`
(e-signature cards through the local bridge). Its Reset block and `$`/`$$`
helpers are the shared ones. Third-party code is vendored under
`pdf/assets/vendor/` and loaded on first use: pdf.js 6 (Apache-2.0), pdf-lib
and @pdf-lib/fontkit (MIT), node-forge (BSD), tesseract.js 7 (Apache-2.0),
fflate (MIT); fonts are Liberation, Carlito and Caladea (OFL) and icons
Lucide (ISC), each with its licence file next to it. Nothing is sent to a
server.

`pdf/kopru/` is the one piece that runs outside the browser: Mühür İmza
Köprüsü, a single-file Java program (source + a jar built with
`javac --release 8`) that lets the page sign with a qualified e-signature
card (Kamu SM / TÜBİTAK AKİS or any PKCS#11 token). It listens on
127.0.0.1:21730 only, answers only the site's origins, hashes and signs the
CMS signed attributes on the card after the PIN, and returns the signature
with the CA chain. Rebuild the jar after editing the source:

```bash
mkdir -p /tmp/kopru && javac --release 8 -d /tmp/kopru pdf/kopru/MuhurImzaKoprusu.java && printf "Main-Class: MuhurImzaKoprusu\n" > /tmp/kopru.mf && jar cfm pdf/kopru/MuhurImzaKoprusu.jar /tmp/kopru.mf -C /tmp/kopru .
```

## Local preview

```bash
python3 -m http.server 4321
```

Then open <http://localhost:4321>.
