# Tasarım yönü C — İsviçre / uluslararası tipografik stil

## Kaldırılan AI izleri
- Gradient hero, `#signalCanvas`, pulse-dot rozet, cam/glow, tüm `box-shadow` ve `border-radius` (stil dosyasında tek bir gölge/gradient/radius yok).
- Her bölümdeki "kicker + h2 + açıklama + kart ızgarası" kalıbı: kicker'lar görünmez (`.visually-hidden`, i18n anahtarları korunur), bölümler sola dayalı 01–04 numarasıyla açılır; her bölümün düzeni farklı (tablo / 4×3 kolon / satır listesi / tek kolon not).
- 3'lü ikonlu key-fact kartları → hairline'lı `<dl>` olgu listesi (hero'da 9–12. kolon). 4 butonlu hero → 1 dolu + 1 çerçeveli buton + 2 metin bağlantısı.
- ~90 dekoratif SVG ikon ve chevron → sıfır. Büyük-harf + harf-aralığı etiket enflasyonu → CSS `text-transform: lowercase` (sözlük metni değişmedi; `SİU 2027` markası `text-transform: none`).
- Sponsor "logosu" olarak kalın metin → normal ağırlıkta kurum adı listesi; duyuru kartlarındaki illüstrasyonlar → yalnız tipografi.
- 3 dil değiştirici → masthead'de 1 (mobil çekmecede tekrar). Satır içi `style=""`: 0. Üç ayrı üst şerit → tek lacivert masthead (marka satırı + menü satırı).

## Uygulanan ilkeler
- Katı 12 kolon ızgara (`.grid`, `--gutter` 24px); asimetri: hero başlık 1–7, olgular 9–12 (8. kolon boş); bölüm numarası 1–2, başlık 3–12, açıklama 3–8; kulvar satırı 1–2 / 3–6 / 7–12 (konular iki sütun).
- Hiyerarşi kutuyla değil boyut/ağırlık/ölçü ile: `--step--2 … --step-5` (clamp'li), tek aile Source Sans 3 400/600/700, `tabular-nums` gövde genelinde; geri sayım rakamları `--step-5` ağırlık 400.
- Çizgi, kutu değil: `--hair` 1px `#C7CDD3` yatay/dikey kurallar, `--thick` 2px lacivert tablo ve liste üst çizgileri; tek koyu blok masthead ve footer.
- Tablo gerçek `<table>`; 640px altında satırlar `display:grid` ile katlanır, sütun etiketleri `:lang(tr|en)` ile pseudo-elemandan gelir (JS `documentElement.lang`'ı değiştirir).
- Butonlar: dikdörtgen, 2px kenarlık, `--step--1` 600; hover ters çevirme. Linkler alt çizgili; `:focus-visible` 2px turkuaz; `prefers-reduced-motion` tüm geçişleri kapatır; `@media print` kabuğu gizler, tabloları siyah çizgiyle basar.

## Token'lar
`--navy #002B49` `--navy-deep #001A2C` `--cyan #00A3E0` (yalnız vurgu) `--cyan-deep #0077A8` (beyaz üstünde AA link/tarih) · `--ink #121A22` `--ink-2` `--ink-3` · `--rule` / `--rule-soft` / `--rule-on-navy` · `--space-1…9` (4px taban) · `--wrap 1280px` · kırılımlar 1100 / 960 / 640.

## Jüriye notlar
- Kabuk (masthead, çekmece, arama modalı, footer) diğer 10 sayfaya aynen kopyalanabilir; JS'in ürettiği `.search-result-*`, `.mobile-drawer-backdrop`, `.modal-backdrop.open` sınıfları stillenmiştir. Komite kartı, form, tablo, modal ve `.prose` bileşenleri diğer sayfalar için hazırdır (bölüm 17).
- Taslak `/_design/C/style.css` yükler; canlıya alınırken `css/style.css?v=17` olur (head'deki yorum). Chrome headless'ın ~500px minimum pencere genişliği yüzünden `mobile.png`, 390px'lik bir iframe çerçevesinden kırpılarak alınmıştır; canlı tarayıcıda 375px'te yatay taşma yoktur (ölçüldü).
- Numaralı bölüm başlıklarında h2 küçük harfe CSS ile çevrilir; `text-transform` Türkçe İ/ı için `lang` özniteliğine duyarlıdır (Chrome/Safari/Firefox destekler).
