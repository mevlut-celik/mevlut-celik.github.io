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
  the sitemap on purpose; `siu2027/` and `siu2027gorsel/` keep their own robots and sitemap.

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
| `mescid/` | The app's own brand — #0D0D0D and #CC0000, phone mock-up |
| `parlar-kariyer/` | Institutional job notice — foundation navy, numbered sections, sticky summary |
| `ptns/` | University research instrument — quiet paper, METU red signals, step rail |
| `simulation/` | Lab notebook — graph paper, blueprint ink, red pen for the force |
| `waves/` | Bench oscilloscope — phosphor screen, instrument keys |

`siu2027/` is maintained separately and is not part of this skeleton.
`siu2027gorsel/` is an independent copy of it for visual experiments; the
siu2027 publish script never touches it.

## Local preview

```bash
python3 -m http.server 4321
```

Then open <http://localhost:4321>.
