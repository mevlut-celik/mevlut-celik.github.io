#!/usr/bin/env python3
"""Sayfa metinlerini js/main.js sözlüğüyle yeniden eşitler.

data-i18n="anahtar"      -> elemanın içeriği sözlükteki düz metin olur
data-i18n-html="anahtar" -> elemanın içeriği sözlükteki HTML olur

Eleman sınırları HTMLParser ile derinlik sayılarak bulunur, bu yüzden iç içe
aynı adlı etiketler sorun çıkarmaz. Kullanım:
    python3 _tools/sync-i18n.py [sayfa.html ...]     (boşsa tüm *.html)
"""
import re, sys, os, json, glob
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
VOID = {'area','base','br','col','embed','hr','img','input','link','meta',
        'param','source','track','wbr'}

def sozluk():
    js = open('js/main.js', encoding='utf-8').read()
    m = re.search(r'const i18nDictionary = \{\n  tr: \{(.*?)\n  \},\n  en: \{(.*?)\n  \}\n\};', js, re.S)
    def ayristir(b):
        return {k: json.loads(v) for k, v in
                re.findall(r'^    ([A-Za-z0-9_]+): ("(?:[^"\\]|\\.)*"),', b, re.M)}
    return ayristir(m.group(1)), ayristir(m.group(2))

TR, EN = sozluk()

class Bulucu(HTMLParser):
    """data-i18n taşıyan elemanların (anahtar, tip, ic_bas, ic_son) listesini çıkarır."""
    def __init__(s):
        super().__init__(convert_charrefs=False)
        s.yigin = []      # (etiket, hedef_mi)
        s.bulgu = []
    def _konum(s):
        satir, sutun = s.getpos()
        return s.satir_ofset[satir - 1] + sutun
    def handle_starttag(s, tag, attrs):
        a = dict(attrs)
        if tag in VOID: return
        anahtar = a.get('data-i18n') or a.get('data-i18n-html')
        tip = 'html' if 'data-i18n-html' in a else ('text' if 'data-i18n' in a else None)
        bas = s._konum() + len(s.get_starttag_text())
        s.yigin.append((tag, anahtar, tip, bas))
    def handle_endtag(s, tag):
        if tag in VOID or not s.yigin: return
        for i in range(len(s.yigin) - 1, -1, -1):
            if s.yigin[i][0] == tag:
                etiket, anahtar, tip, bas = s.yigin[i]
                if anahtar:
                    s.bulgu.append((anahtar, tip, bas, s._konum()))
                del s.yigin[i:]
                return

def isle(yol):
    kaynak = open(yol, encoding='utf-8').read()
    p = Bulucu()
    p.satir_ofset = []
    o = 0
    for satir in kaynak.splitlines(keepends=True):
        p.satir_ofset.append(o); o += len(satir)
    p.satir_ofset.append(o)
    p.feed(kaynak); p.close()

    degisen = 0; eksik = []
    for anahtar, tip, bas, son in sorted(p.bulgu, key=lambda x: -x[2]):
        if anahtar not in TR:
            eksik.append(anahtar); continue
        yeni = TR[anahtar]
        if tip == 'text':
            # düz metin: sözlükte HTML yoksa aynen yaz
            if '<' in yeni: eksik.append(anahtar + ' (HTML ama data-i18n)'); continue
        if kaynak[bas:son] != yeni:
            kaynak = kaynak[:bas] + yeni + kaynak[son:]
            degisen += 1
    if eksik:
        print('  ! sorunlu anahtar:', sorted(set(eksik)), file=sys.stderr)
    open(yol, 'w', encoding='utf-8').write(kaynak)
    return degisen

if __name__ == '__main__':
    hedef = sys.argv[1:] or sorted(glob.glob('*.html'))
    toplam = 0
    for y in hedef:
        n = isle(y); toplam += n
        print('%-16s %d metin güncellendi' % (y, n))
    print('toplam %d' % toplam)
