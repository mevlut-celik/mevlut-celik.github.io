#!/usr/bin/env python3
"""Kabuğu (KABUK + ALTBİLGİ blokları) index.html'den diğer tüm sayfalara kopyalar.
Her sayfada yalnızca aktif menü işareti farklı olur.
Kullanım: python3 _tools/sync-shell.py"""
import re, os, sys, importlib.util
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

spec = importlib.util.spec_from_file_location('bp', '_tools/build_page.py')
bp = importlib.util.module_from_spec(spec); spec.loader.exec_module(bp)

NAV = {
    'index.html': 'index.html',   'hakkinda.html': 'hakkinda.html',
    'yazarlar.html': 'yazarlar.html', 'program.html': 'program.html',
    'yarisma.html': 'yarisma.html', 'katilim.html': 'katilim.html',
    'kayit.html': 'katilim.html', 'komiteler.html': 'komiteler.html',
    'arsiv.html': 'arsiv.html',   'iletisim.html': 'iletisim.html',
    'kvkk.html': None,            '404.html': None,
}

def blok(h, tag):
    m = re.search(r'<!-- %s:BAŞ.*?<!-- %s:SON -->' % (tag, tag), h, re.S)
    return m

src = open('index.html', encoding='utf-8').read()
kaynak = {t: blok(src, t).group(0) for t in ('KABUK', 'ALTBİLGİ')}

degisen = 0
for sayfa, nav in NAV.items():
    if not os.path.exists(sayfa): continue
    h = open(sayfa, encoding='utf-8').read(); onceki = h
    for tag in ('KABUK', 'ALTBİLGİ'):
        m = blok(h, tag)
        if not m:
            print('  ! %s içinde %s bloğu yok' % (sayfa, tag), file=sys.stderr); continue
        yeni = bp.set_active(kaynak[tag], nav)
        h = h[:m.start()] + yeni + h[m.end():]
    # 404 kök yollu kalır
    if sayfa == '404.html':
        h = re.sub(r'(<(?:a|img|link|script)[^>]*?(?:href|src)=")(?!https?:|mailto:|#|/)', r'\1/', h)
    if h != onceki:
        open(sayfa, 'w', encoding='utf-8').write(h); degisen += 1
        print('güncellendi: %s' % sayfa)
print('%d sayfada kabuk eşitlendi' % degisen)
