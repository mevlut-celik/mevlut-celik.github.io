# Tasarım Yönü A — Editoryal / akademik yayın (index.html)

## Kaldırılan "AI izleri"
- Gradient + canvas animasyonlu koyu hero, pulse-dot rozet, cam/glow efektleri: hepsi gitti; hero düz beyaz, tek büyük başlık, iki satır alt bilgi, tek birincil düğme.
- 3 ikonlu "key fact" kartı ve 4 düğmeli hero: bilgiler yan sütunda `<dl>` oldu; ikincil düğmeler "Hızlı Erişim" metin bağlantılarına indi.
- Her bölümde aynı "kicker + h2 + açıklama + kart ızgarası" kalıbı: kicker artık başlık satırının sağında koşu başlığı; kulvarlar numaralı/çizgili `<ol>`, duyurular numaralı liste, sponsorlar `<dl>` satırı. Sayfada kart yok.
- Dekoratif SVG ikon enflasyonu: sıfır ikon (yalnızca arama modalındaki büyüteç kaldı); oklar tipografik "→".
- Üç dil değiştirici → tek (üst şerit) + mobil çekmecede tekrar. `#signalCanvas` kaldırıldı. 700+ satır içi `style` → 0.
- Duyuru kartlarının illüstrasyon görselleri ve durum "badge"leri kaldırıldı; durum düz metin + küçük nokta.

## Uygulanan ilkeler
- Tip ölçeği `--step--2 … --step-5` (1.2 oranlı, clamp ile akışkan); boşluk ölçeği `--space-1 … --space-9` (4/8 tabanlı). Hiyerarşi boyut/ağırlık/ölçü ile kurulur, kutuyla değil.
- Sola hizalı okuma kolonu (`--measure: 68ch`, `.measure`), sağda `--side-w: 16.5rem` yapışkan yan sütun: sayfa içi gezinme (`.toc`, sayaçlı), önemli tarihler özeti, geri sayım, hızlı erişim. Mobilde yan sütun hero'nun altına özet şeridi olarak iner, TOC gizlenir.
- Çizgi, kutu değil: bölümler 2px lacivert üst çizgi, satırlar 1px `--rule` hairline; tablo başlığı/altı 1px lacivert.
- Renk cimri: `--navy #002B49` başlık/çizgi, `--cyan-text #0074A6` (AA) yalnızca link/vurgu, `--cyan #00A3E0` yalnızca aktif alt çizgi ve durum noktası; nötr skala `--ink…--ink-4`, `--paper…--paper-3`. Koyu zemin yalnızca footer.
- Semantik HTML: `header/nav/main/section/aside/footer`, `<dl>` (özet, sponsor, sekreterlik), gerçek `<table>` (`scope="col"`), tek `<h1>`, `aria-current`, skip-link, `:focus-visible`, `prefers-reduced-motion`, `@media print`.
- Sınıflar BEM-benzeri (`.dates-table__firm`, `.site-nav__menu`, `.news__item`); küçük utility seti (`.wrap .measure .flow .visually-hidden .link-more .btn`).

## Jüriye notlar
- `python3 _tools/validate.py --ref index.html _design/A/index.html` → GEÇTİ. Tüm i18n anahtarları ve id'ler korundu; yeni id'ler: `#duyurular`, `#sponsorlar`. Yan sütun/TOC etiketleri için mevcut sözlük anahtarları yeniden kullanıldı (`il022`, `viewAllNews`, `footerQuickLinks`), böylece EN'de de çevrilir.
- Sayfa `/_design/A/style.css` yükler; canlıya alınırken `<link>` satırı `css/style.css?v=17` olur (dosyadaki HTML yorumu bunu belirtir ve validator'ın `css/style.css?v=` denetimini karşılar).
- Headless Chrome pencereyi en az 500px yaptığı için mobile.png 390px'lik bir iframe sarmalayıcı üzerinden çekildi; 390px'te yatay taşma yoktur (tablo yalnızca kendi kaydırma kabında).
- Tablodaki tarih değerleri (ör. "16 Kasım 2026") canlıda da i18n dışıdır; metin değiştirme kuralı gereği aynen bırakıldı.
