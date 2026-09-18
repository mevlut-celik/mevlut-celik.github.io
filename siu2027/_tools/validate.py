#!/usr/bin/env python3
"""SİU 2027 — sayfa değişmezlerini doğrular.
Kullanım:  python3 _tools/validate.py index.html [diger.html ...]   veya   python3 _tools/validate.py --all
Çıkış kodu 0 = geçti. Referans: _tools/ref/ (yeniden tasarım öncesi anlık görüntü) ve js/main.js sözlüğü."""
import re, sys, os, json, glob, html as H
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
VOID = {'br','img','input','meta','link','hr','source','area','base','col','embed','param','track','wbr','path','circle','line','polyline','rect','polygon','stop','use','ellipse'}
REQUIRED_HOOKS = ['.lang-btn-tr', '.lang-btn-en', '.mobile-toggle', '#mobileDrawer', '.mobile-drawer-close', '.open-search-modal']
CMT = 'The Microsoft CMT service was used for managing the peer-reviewing process'

def dict_tr():
    js = open('js/main.js', encoding='utf-8').read()
    m = re.search(r'const i18nDictionary = \{\n  tr: \{(.*?)\n  \},\n  en: \{', js, re.S)
    return {k: json.loads(v) for k, v in re.findall(r'^    ([A-Za-z0-9_]+): ("(?:[^"\\]|\\.)*"),', m.group(1), re.M)}

def norm(s):
    return re.sub(r'\s+', ' ', H.unescape(s)).strip()

def tag_balance(h):
    b = re.sub(r'<!--.*?-->', '', h, flags=re.S); b = re.sub(r'<script.*?</script>', '', b, flags=re.S)
    st, er = [], []
    for m in re.finditer(r'<(/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(/?)>', b):
        c, t, sf = m.group(1), m.group(2).lower(), m.group(4)
        if t in VOID or sf == '/': continue
        if not c: st.append(t)
        elif st and st[-1] == t: st.pop()
        elif t in st:
            while st and st[-1] != t: er.append('kapatılmamış <%s>' % st.pop())
            st.pop()
        else: er.append('fazladan </%s>' % t)
    return er + ['açık kalan <%s>' % t for t in st]

def i18n_elems(h):
    """(key, ishtml, inner) — yalnızca tek seviyeli eşleme; iç içe blok yok varsayılır."""
    out = []
    for m in re.finditer(r'<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)\sdata-i18n(-html)?="([^"]+)"([^>]*)>', h):
        tag, key, ishtml = m.group(1), m.group(4), bool(m.group(3))
        # ilgili kapanış: aynı etiketin ilk kapanışı (iç içe aynı etiket varsayılmıyor)
        end = h.find('</%s>' % tag, m.end())
        inner = h[m.end():end] if end != -1 else ''
        out.append((key, ishtml, inner))
    return out

def check(page, D, all_ids):
    h = open(page, encoding='utf-8').read()
    refpath = REF_OVERRIDE or os.path.join('_tools/ref', page)
    ref = open(refpath, encoding='utf-8').read() if os.path.exists(refpath) else ''
    errs, warns = [], []
    # 1 yapı
    errs += tag_balance(h)
    ids = re.findall(r'\sid="([^"]+)"', h)
    dup = [x for x in set(ids) if ids.count(x) > 1]
    if dup: errs.append('mükerrer id: %s' % dup)
    # 2 i18n anahtar kümesi
    cur = i18n_elems(h); refk = {k for k, _, _ in i18n_elems(ref)} if ref else set()
    curk = {k for k, _, _ in cur}
    missing = refk - curk
    if missing: errs.append('kaybolan i18n anahtarı (%d): %s' % (len(missing), sorted(missing)[:15]))
    for k, ishtml, inner in cur:
        if k not in D: errs.append('sözlükte olmayan anahtar: %s' % k); continue
        v = D[k]
        if ('<' in v) != ishtml:
            errs.append('%s: sözlük değeri %s ama öznitelik %s' % (k, 'HTML içeriyor' if '<' in v else 'düz metin', 'data-i18n-html' if ishtml else 'data-i18n'))
        if norm(re.sub(r'<[^>]+>', '', inner)) != norm(re.sub(r'<[^>]+>', '', v)):
            errs.append('%s: sayfa metni sözlükle uyuşmuyor → "%s…" ≠ "%s…"' % (k, norm(re.sub(r'<[^>]+>', '', inner))[:40], norm(re.sub(r'<[^>]+>', '', v))[:40]))
    # 3 satır içi stil
    n_inline = len(re.findall(r'\sstyle="', h))
    if n_inline: errs.append('satır içi style özniteliği: %d (hedef 0)' % n_inline)
    # 4 JS kancaları
    for hook in REQUIRED_HOOKS:
        pat = (r'id="%s"' % hook[1:]) if hook.startswith('#') else (r'class="[^"]*\b%s\b' % re.escape(hook[1:]))
        if not re.search(pat, h): errs.append('JS kancası yok: %s' % hook)
    if 'data-title-key="' not in h: errs.append('body data-title-key yok')
    # 5 bağlantılar
    for href in sorted(set(re.findall(r'href="([^"]+)"', h))):
        if href.startswith(('http', 'mailto:', 'tel:')): continue
        if href.startswith('#'):
            if href[1:] and href[1:] not in set(ids): errs.append('kırık çapa %s' % href)
            continue
        t = href.split('#')[0].split('?')[0].lstrip('/'); f = href.split('#')[1] if '#' in href else None
        if t and not os.path.exists(t): errs.append('eksik dosya %s' % href)
        elif f and t in all_ids and f not in all_ids[t]: errs.append('kırık çapa %s' % href)
    for s in set(re.findall(r'src="([^"]+)"', h)):
        if not s.startswith('http') and not os.path.exists(s.split('?')[0].lstrip('/')): errs.append('eksik src %s' % s)
    # 6 gelen çapa hedefleri korunmalı
    for tgt in all_ids.get('__incoming__', {}).get(page, set()):
        if tgt not in set(ids): errs.append('başka sayfadan bağlanan id silinmiş: #%s' % tgt)
    # 7 zorunlu içerik / hijyen
    if CMT not in h: errs.append('CMT bilgilendirme metni yok')
    if 'fonts.googleapis' in h: errs.append('Google Fonts isteği var')
    if not re.search(r'css/style\.css\?v=', h): errs.append('style.css?v= yok')
    if not re.search(r'js/main\.js\?v=', h): errs.append('main.js?v= yok')
    if len(re.findall(r'<h1[\s>]', h)) != 1: errs.append('h1 sayısı %d (1 olmalı)' % len(re.findall(r'<h1[\s>]', h)))
    if '<main' not in h: errs.append('<main> yok')
    if not re.search(r'href="#icerik"', h): warns.append('"ana içeriğe atla" bağlantısı yok (#icerik)')
    if 'lang="tr"' not in h[:300]: errs.append('<html lang="tr"> yok')
    return errs, warns

REF_OVERRIDE = None

def main():
    global REF_OVERRIDE
    args = sys.argv[1:]
    if '--ref' in args:
        i = args.index('--ref'); REF_OVERRIDE = args[i+1]; del args[i:i+2]
    SKIP = set()
    pages = [p for p in sorted(glob.glob('*.html')) if p not in SKIP] if (not args or args == ['--all']) else args
    D = dict_tr()
    all_pages = [p for p in sorted(glob.glob('*.html')) if p not in SKIP]
    all_ids = {p: set(re.findall(r'\sid="([^"]+)"', open(p, encoding='utf-8').read())) for p in all_pages}
    incoming = {}
    for p in all_pages:
        for href in re.findall(r'href="([^"#]+)#([^"]+)"', open(p, encoding='utf-8').read()):
            t = href[0].split('?')[0].lstrip('/')
            if t in all_ids: incoming.setdefault(t, set()).add(href[1])
    all_ids['__incoming__'] = incoming
    fail = 0
    for p in pages:
        errs, warns = check(p, D, all_ids)
        status = 'GEÇTİ' if not errs else 'HATA'
        print('%-16s %s%s' % (p, status, ('  (%d uyarı)' % len(warns)) if warns else ''))
        for e in errs: print('   ✗', e)
        for w in warns: print('   !', w)
        fail += bool(errs)
    print('\n%d/%d sayfa geçti' % (len(pages) - fail, len(pages)))
    sys.exit(1 if fail else 0)

main()
