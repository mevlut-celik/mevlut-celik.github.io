# mevlut-celik.github.io

Personal site of Mevlüt Çelik — frontend, backend and platform development.

Written from scratch: no Jekyll theme, no fork, no framework, no build step.
Three files carry the homepage; every subproject repeats the same layout.

```
index.html            markup + content
assets/css/main.css   design tokens, components, responsive rules
assets/js/main.js     nav, active-section tracking, reveal-on-scroll
assets/files/         curriculum vitae (PDF)
assets/img/           favicon
.nojekyll             served as plain static files by GitHub Pages
```

## Design language

A Swiss engineering dossier: warm white paper, a faint twelve-column grid
drawn behind the page, very large tight Geist headlines, Geist Mono indices,
hairline rules and a single signal colour — international orange `#ff4d00`.
Sections are numbered `(01)…(05)` with a sticky label rail on the left.

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
| `/` | Swiss engineering dossier — paper, visible grid, huge grotesk type, one orange signal |
| `busra/` | Literary journal — warm paper, plum tulip, serif masthead, arched frame |
| `davetiye/` | The printed invitation — beige paper, spaced serif caps, pink script names |
| `mescid/` | The app's own brand — #0D0D0D and #CC0000, phone mock-up |
| `parlar-kariyer/` | Institutional job notice — foundation navy, numbered sections, sticky summary |
| `ptns/` | University research instrument — quiet paper, METU red signals, step rail |
| `simulation/` | Lab notebook — graph paper, blueprint ink, red pen for the force |
| `waves/` | Bench oscilloscope — phosphor screen, instrument keys |

`siu2027/` is maintained separately and is not part of this skeleton.

## Local preview

```bash
python3 -m http.server 4321
```

Then open <http://localhost:4321>.
