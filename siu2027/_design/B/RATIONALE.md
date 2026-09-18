# Tasarım Yönü B — Kurumsal portal / kamu üniversitesi

**Kaldırılan AI izleri**
- Gradient/canvas hero, `#signalCanvas`, "pulse dot" rozet, cam/glow kutular, gölgeli kartlar: hiçbiri yok. Hero beyaz zemin, tek hairline.
- 3 ikonlu "key fact" kartı → hairline'larla ayrılmış tek satırlık `<dl>` (etiket / değer / not). 4 buton → 2 buton + 2 metin bağlantısı.
- Her bölümde kicker+h2+açıklama+kart ızgarası kalıbı kırıldı: tarihler gerçek tablo, kulvarlar satır listesi, konuşmacılar sol çizgili bilgi bloğu, duyurular yan sütunda liste.
- Dekoratif SVG ikonlar (takvim, pin, ok, chevron) silindi; chevron CSS ile, durum işareti 7px kare. Görselli duyuru kartları → metin listesi.
- ~700 satır içi `style` → 0. Üç dil değiştirici → tek (üst şerit; çekmecede tekrar). `#signalCanvas` çıkarıldı; geri sayım korundu ama bilgi kutusunun altına tabular bir satır olarak indirgendi.

**Uygulanan ilkeler**
- Kabuk: 32px lacivert üst şerit (tarih · TR/EN · Arama ⌘K) → beyaz masthead (logo + ad, sağda ev sahibi logosu) → 44px tek satır global nav, aktif öğe 3px turkuaz alt çizgi, açılır menüler ince kenarlı liste (hover + `:focus-within`).
- 12 kolon, 24px oluk, 8px tabanlı boşluk ölçeği. Hero 7+5, gövde 8+3 (bir kolon boşluk yan sütunu ayırır). Her bölüm başlığı 2px lacivert kuralla kapanır; kicker aynı satırda sağda, 12px.
- Tablolar: zebra (`--gray-050`), 6px satır dolgusu, `tabular-nums`, başlıklar 12px büyük harf; "Kesin Son Tarih" sütunu bilinçli olarak muted, "Son Tarih" kalın — okuma önceliği tipografiyle kuruldu.
- Kutular yalnızca bilgi kutusu (hero sağ) ve bildirim bloğu; ikisi de 1px kenar / 2px köşe, gölge yok; turkuaz yalnızca 3px üst şerit, aktif nav çizgisi ve bağlantı rengi (`#0072A3`, beyazda AA).
- Semantik: `header/nav/main/section/aside/footer/dl/table/address/ol`, `aria-labelledby`, `aria-current`, skip-link, görünür `:focus-visible`, `prefers-reduced-motion`, `@media print` (kabuk gizli, zebra korunur, dış bağlantı URL'si basılır).

**Token'lar** (`:root`): `--navy #002B49`, `--navy-800`, `--cyan #00A3E0`, `--cyan-text #0072A3`, nötr `--gray-000…900`; tip `--step--2…--step-5` (12→40px), boşluk `--space-1…8` (4→64px), `--container 1200`, `--col-gap 24`, `--radius 2px`, `--measure 70ch`.

**Jüriye notlar**
- Önemli tarihler hero'da 5 satırlık mini tablo olarak tekrar eder (aynı i18n anahtarları); tam takvim `#tarihler`'de. Bütün id/anahtar/kanca korundu; `validate.py --ref index.html` GEÇTİ.
- Sponsor satırında IEEE için logo varlığı olmadığından ad metin olarak kaldı (kalın "logo taklidi" değil, tablo hücresi ağırlığında).
- Headless Chrome pencereyi en az 500px'e sabitliyor; `mobile.png` bu yüzden 390px'lik bir iframe sarmalayıcı üzerinden çekildi (gerçek tarayıcıda 375px'te yatay taşma yok, ölçüldü).
- Kabuk (topbar/masthead/nav/çekmece/modal/footer) diğer 10 sayfaya birebir kopyalanacak biçimde yazıldı; sayfaya özel tek şey `.global-nav__link.active` + `aria-current`.
