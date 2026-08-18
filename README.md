# mevlut-celik.github.io

Personal site of Mevlüt Çelik — frontend, backend and platform development.

Written from scratch: no Jekyll theme, no fork, no framework, no build step.
Three files carry the whole site.

```
index.html            markup + content
assets/css/main.css   design tokens, components, responsive rules
assets/js/main.js     nav, active-section tracking, reveal-on-scroll
assets/files/         curriculum vitae (PDF)
assets/img/           favicon
.nojekyll             served as plain static files by GitHub Pages
```

## Design language

Pure black canvas, uppercase condensed display type with wide tracking, hairline
rules, and a single ghost outlined pill CTA per band. No accent colors, no
shadows, no gradients — black, white and typography only.

Tokens live at the top of `assets/css/main.css` as CSS custom properties
(`--canvas-night`, `--hairline-dark`, `--size-display-xxl`, `--radius-pill`, …).
Everything below the token block uses them; nothing hard-codes a value.

## Conventions

- BEM-ish class names: `block__element--modifier`.
- Every section is a `.band` with a `.band__inner` reading column (max 1200px).
- Repeating content uses one of four patterns: `.specs`, `.manifest`, `.entries`, `.grid`.
- `main.js` is a set of `initX()` modules, each querying its own nodes, bailing
  out when they are missing, and started from a single `boot()`.

## Local preview

```bash
python3 -m http.server 4321
```

Then open <http://localhost:4321>.

## Subsites

Standalone projects live in their own directories and are untouched by the
rewrite: `simulation/`, `mescid/`, `parlar-kariyer/`, `ptns/`, `busra/`,
`davetiye/`, `waves/`.
