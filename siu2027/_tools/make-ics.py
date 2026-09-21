#!/usr/bin/env python3
"""SİU 2027 takvim dosyalarını üretir (assets/siu2027.ics, assets/siu2027-tarihler.ics).
Kaynak: aşağıdaki MILESTONES listesi — index.html'deki tarih tablosuyla aynı olmalı."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

STAMP = '20260918T090000Z'          # sabit: dosya her üretimde aynı kalsın
SITE  = 'https://siu2027.medipol.edu.tr'
ORG   = 'IEEE SİU 2027 — 35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı'
VENUE = 'İstanbul Medipol Üniversitesi, Kavacık Güney Yerleşkesi, Göztepe Mah. Atatürk Cad. No: 40/16, 34815 Beykoz / İstanbul'

# (uid, başlık TR, başlık EN, son tarih, sayfa) — kurulun nihai takvimi, tek tarih
MILESTONES = [
    ('ozel-oturum-davet',  'Özel oturum düzenleme daveti — son tarih',        'Call for special session proposals — deadline', '20261116', 'yazarlar.html#ozel-oturumlar'),
    ('seminer-davet',      'Eğitim semineri düzenleme daveti — son tarih',    'Call for tutorial proposals — deadline',        '20261116', 'program.html#seminerler'),
    ('ozel-oturum-kabul',  'Özel oturum kabullerinin bildirilmesi',           'Notification of special session acceptance',    '20261130', 'yazarlar.html#ozel-oturumlar'),
    ('seminer-kabul',      'Eğitim semineri kabullerinin bildirilmesi',       'Notification of tutorial acceptance',           '20261130', 'program.html#seminerler'),
    ('bildiri-gonderim',   'Bildirilerin gönderilmesi — son tarih',           'Paper submission — deadline',                   '20270201', 'yazarlar.html#gonderim'),
    ('sonuc',              'Sonuçların açıklanması',                          'Notification of acceptance',                    '20270430', 'yazarlar.html#cfp'),
    ('baskiya-hazir',      'Baskıya hazır bildiri ve yazar kaydı — son tarih','Camera-ready paper & author registration',      '20270524', 'yazarlar.html#baskiya-hazir'),
]

def esc(t):
    return t.replace('\\', '\\\\').replace(';', r'\;').replace(',', r'\,').replace('\n', r'\n')

def fold(line):
    """RFC 5545: satırlar 75 oktetten uzun olamaz."""
    b = line.encode('utf-8')
    if len(b) <= 75: return line
    out, cur = [], b''
    for ch in line:
        e = ch.encode('utf-8')
        if len(cur) + len(e) > (75 if not out else 74):
            out.append(cur.decode('utf-8')); cur = b''
        cur += e
    out.append(cur.decode('utf-8'))
    return '\r\n '.join(out)

def cal(events, name):
    L = ['BEGIN:VCALENDAR', 'VERSION:2.0',
         'PRODID:-//IEEE SIU 2027//Kurultay Takvimi//TR',
         'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
         'X-WR-CALNAME:' + esc(name), 'X-WR-TIMEZONE:Europe/Istanbul']
    L += events
    L.append('END:VCALENDAR')
    return '\r\n'.join(fold(x) for x in L) + '\r\n'

def day_after(d):
    import datetime
    dt = datetime.date(int(d[:4]), int(d[4:6]), int(d[6:])) + datetime.timedelta(days=1)
    return dt.strftime('%Y%m%d')

def vevent(uid, start, end, summary, desc, url, alarm_days=None, location=None):
    e = ['BEGIN:VEVENT', 'UID:%s@siu2027.medipol.edu.tr' % uid, 'DTSTAMP:' + STAMP,
         'DTSTART;VALUE=DATE:' + start, 'DTEND;VALUE=DATE:' + end,
         'SUMMARY:' + esc(summary), 'DESCRIPTION:' + esc(desc), 'URL:' + url,
         'TRANSP:TRANSPARENT', 'STATUS:CONFIRMED']
    if location: e.insert(7, 'LOCATION:' + esc(location))
    if alarm_days:
        e += ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P%dD' % alarm_days,
              'DESCRIPTION:' + esc(summary), 'END:VALARM']
    e.append('END:VEVENT')
    return e

# 1) Kurultayın kendisi
conf = vevent('siu2027-kurultay', '20270704', '20270708',
              ORG,
              '35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı (SİU 2027).\n'
              'Ayrıntılar: ' + SITE,
              SITE + '/', alarm_days=30, location=VENUE)
open('assets/siu2027.ics', 'w', encoding='utf-8', newline='').write(
    cal(conf, 'IEEE SİU 2027 — Kurultay'))

# 2) Tüm önemli tarihler (+ kurultay)
evs = []
for uid, tr, en, due, page in MILESTONES:
    evs += vevent('siu2027-' + uid, due, day_after(due),
                  'SİU 2027 · ' + tr,
                  '%s\n\n%s/%s' % (en, SITE, page),
                  '%s/%s' % (SITE, page), alarm_days=7)
evs += [l.replace('UID:siu2027-kurultay@', 'UID:siu2027-kurultay-tarihler@') for l in conf]
open('assets/siu2027-tarihler.ics', 'w', encoding='utf-8', newline='').write(
    cal(evs, 'IEEE SİU 2027 — Önemli Tarihler'))

for f in ('assets/siu2027.ics', 'assets/siu2027-tarihler.ics'):
    n = open(f, encoding='utf-8').read().count('BEGIN:VEVENT')
    print('%-32s %d etkinlik, %d bayt' % (f, n, os.path.getsize(f)))
