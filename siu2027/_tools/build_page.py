#!/usr/bin/env python3
"""Sayfa üreticisi: kabuğu index.html'den alır, i18n metinlerini js/main.js sözlüğünden doldurur.

Kaynak dosyada kısa gösterim kullanılır:
    <p i18n="yz012"></p>          → <p data-i18n="yz012">sözlükteki metin</p>
    <h2 i18n="yz010" id="x"></h2> → öznitelikler korunur; değer HTML içeriyorsa data-i18n-html olur
Kullanım: python3 _tools/build_page.py _tools/src/yazarlar.html yazarlar.html
"""
import re, sys, os, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

def dicts():
    js = open('js/main.js', encoding='utf-8').read()
    m = re.search(r'const i18nDictionary = \{\n  tr: \{(.*?)\n  \},\n  en: \{(.*?)\n  \}\n\};', js, re.S)
    def parse(b): return {k: json.loads(v) for k, v in re.findall(r'^    ([A-Za-z0-9_]+): ("(?:[^"\\]|\\.)*"),', b, re.M)}
    return parse(m.group(1)), parse(m.group(2))

TR, EN = dicts()

def shell():
    h = open('index.html', encoding='utf-8').read()
    def grab(a, b):
        i = h.index(a); j = h.index(b) + len(b)
        return h[i:j]
    return grab('<!-- KABUK:BAŞ', '<!-- KABUK:SON -->'), grab('<!-- ALTBİLGİ:BAŞ', '<!-- ALTBİLGİ:SON -->')

def set_active(block, href):
    """Kabuktaki aktif menü işaretini href'i bu sayfa olan bağlantıya taşı."""
    block = block.replace('site-nav__link active"', 'site-nav__link"')
    block = block.replace('mobile-nav-link active"', 'mobile-nav-link"')
    block = re.sub(r'(<a\s[^>]*?)\s+aria-current="page"', r'\1', block)   # yalnız <a> içinde; kabuk yorumuna dokunma
    if not href:
        return block
    n = 0
    def mark(m):
        nonlocal n
        tag = m.group(0)
        if 'active' in tag: return tag
        n += 1
        tag = re.sub(r'class="((?:site-nav__link|mobile-nav-link)[^"]*)"', r'class="\1 active"', tag, count=1)
        return tag[:-1] + ' aria-current="page">'
    block = re.sub(
        r'<a\s[^>]*href="%s"[^>]*class="(?:site-nav__link|mobile-nav-link)[^"]*"[^>]*>' % re.escape(href),
        mark, block)
    block = re.sub(
        r'<a\s[^>]*class="(?:site-nav__link|mobile-nav-link)[^"]*"[^>]*href="%s"[^>]*>' % re.escape(href),
        mark, block)
    if n == 0: print('  ! aktif menü işaretlenemedi:', href, file=sys.stderr)
    return block

def expand(html):
    """i18n="key" kısa gösterimini genişlet."""
    missing = []
    def rep(m):
        head, tag, attrs_before, key, attrs_after = m.group(0), m.group(1), m.group(2), m.group(3), m.group(4)
        if key not in TR: missing.append(key); return head
        v = TR[key]
        attr = 'data-i18n-html' if '<' in v else 'data-i18n'
        return '<%s%s %s="%s"%s>%s</%s>' % (tag, attrs_before, attr, key, attrs_after, v, tag)
    out = re.sub(r'<([a-zA-Z][a-zA-Z0-9]*)((?:\s+(?!i18n=)[a-zA-Z-]+="[^"]*")*)\s+i18n="([A-Za-z0-9_]+)"((?:\s+[a-zA-Z-]+="[^"]*")*)\s*>\s*</\1>', rep, html)
    if missing: print('  ! sözlükte yok:', sorted(set(missing)), file=sys.stderr)
    return out

def build(src, dest):
    s = open(src, encoding='utf-8').read()
    meta = json.loads(re.search(r'<!--META\n(.*?)\n-->', s, re.S).group(1))
    body = s.split('-->', 1)[1].strip()
    top, bottom = shell()
    top = set_active(top, meta.get('nav'))
    bottom = set_active(bottom, meta.get('nav'))
    css = '\n'.join('  <link rel="stylesheet" href="css/pages/%s.css?v=18">' % c for c in meta.get('pageCss', []))
    extra_head = meta.get('head', '')
    extra_body = meta.get('bodyEnd', '')
    if meta.get('bodyEndFile'):
        extra_body = open(meta['bodyEndFile'], encoding='utf-8').read().rstrip()
    page = f'''<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{meta['title']}</title>
  <meta name="description" content="{meta['desc']}">

  <link rel="canonical" href="https://siu2027.medipol.edu.tr/{dest}">

  <!-- Open Graph / Twitter -->
  <meta property="og:site_name" content="IEEE SİU 2027">
  <meta property="og:locale" content="tr_TR">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://siu2027.medipol.edu.tr/{dest}">
  <meta property="og:title" content="{meta['title']}">
  <meta property="og:description" content="{meta['ogDesc']}">
  <meta property="og:image" content="https://siu2027.medipol.edu.tr/assets/og-siu2027.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="IEEE SİU 2027 — 35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı, 04–07 Temmuz 2027, İstanbul Medipol Üniversitesi">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{meta['title']}">
  <meta name="twitter:description" content="{meta['ogDesc']}">
  <meta name="twitter:image" content="https://siu2027.medipol.edu.tr/assets/og-siu2027.jpg">

  <!-- CSS: tek kaynak, tasarım sistemi + sayfaya özel kurallar -->
  <link rel="stylesheet" href="css/style.css?v=18">
{css}
{extra_head}
  <link rel="icon" type="image/png" href="assets/favicon.png">
  <link rel="apple-touch-icon" href="assets/favicon.png">
</head>
<body data-title-key="{meta['titleKey']}">

  <a class="skip-link" href="#icerik">Ana içeriğe atla</a>

{top}

  <main id="icerik">

{expand(body)}

  </main>

{bottom}
{extra_body}
  <script src="js/main.js?v=18"></script>
</body>
</html>
'''
    page = re.sub(r'\n{3,}', '\n\n', page)
    open(dest, 'w', encoding='utf-8').write(page)
    print('yazıldı: %s (%d satır)' % (dest, page.count('\n')))

if __name__ == '__main__':
    build(sys.argv[1], sys.argv[2])
