# SİU 2027 — Yeniden Tasarım Brifi

Proje kökü: `/Users/mevlutcelik/Documents/Projects/freshdata website/siu2027`  ·  Yerel sunucu: `http://localhost:8791/` (kapalıysa: `cd "/Users/mevlutcelik/Documents/Projects/freshdata website/siu2027" && nohup python3 -m http.server 8791 >/dev/null 2>&1 &`)

## 1. Hedef
Site şu an "AI şablonu" gibi duruyor. Hedef: **20 yıllık bir front-end ustasının elinden çıkmış**, IEEE/üniversite
kurumsal kimliğine uygun, sakin, güvenilir, içerik-öncelikli bir konferans sitesi. Süs değil, zanaat.
İçerik (metinler, tarihler, isimler) değişmeyecek; **görünüm ve HTML yapısı** değişecek.

## 2. Kaldırılacak "AI izleri" (bunlar kalırsa iş başarısız sayılır)
- Gradient hero, animasyonlu canvas arka plan (`#signalCanvas`), "pulse dot" rozet, cam/glow efektleri
- Her bölümde aynı kalıp: küçük büyük-harf "kicker" + h2 + açıklama + kart ızgarası
- 3'lü ikonlu "key fact" kartları; 4 butonlu hero
- Her etikette dekoratif SVG ikon; büyük-harf + harf-aralığı etiket enflasyonu
- Her yerde aynı border-radius / box-shadow / padding; simetrik, ortalanmış section başlıkları
- Sponsor "logoları" yerine kalın metin
- ~700 satır içi `style="..."` özniteliği → **sıfır** olacak
- Üç ayrı dil değiştirici (üst çubuk + header + çekmece) → **tek** (mobil çekmecede tekrar edebilir)
- Kart-olarak-sunulmuş tablolar (tarihler, ücretler, arşiv gerçek `<table>` olmalı — zaten öyle, öyle kalsın)

## 3. Usta işi ilkeler (uygulanacak)
- **Tip ölçeği + boşluk ölçeği**: CSS custom property'lerle tanımlı (örn. `--step--1 … --step-5`, `--space-1 … --space-8` 4/8px tabanlı). Hiyerarşi boyut/ağırlık/ölçü(measure)/satır aralığıyla kurulur; kutuyla değil.
- **Çizgi, kutu değil**: hairline rule'lar, beyaz alan, hizalama. Kart yalnızca gerçekten "kart" olan şey için (komite üyesi gibi).
- **İçerik-öncelikli düzen**: sola hizalı okuma kolonu (max ~70ch), gerektiğinde yan sütun (sayfa içi navigasyon / özet kutusu). Asimetri kabul; her şeyi ortalama.
- **Semantik HTML5**: header/nav/main/section/article/aside/footer/dl/table; landmark'lar; `<a class="skip-link" href="#icerik">`.
- **Sade kabuk**: tek satır global nav; tek dil değiştirici; arama düğmesi; footer'da sitemap-benzeri sütunlar + kurumsal bilgi + CMT metni.
- **Sessiz etkileşim**: link alt çizgisi, görünür `:focus-visible`, `prefers-reduced-motion`; dramatik animasyon yok.
- **Renk**: Medipol lacivert `#002B49` birincil; turkuaz `#00A3E0` yalnızca vurgu (link, aktif durum, ince şerit). Geniş nötr gri skalası. Gradient/glow yok. Koyu zemin yalnızca bilinçli, sınırlı (örn. footer, dar bir üst şerit).
- **Yazı tipi**: Source Sans 3 (gömülü, `assets/fonts/`) — DEĞİŞTİRME. Ağırlıklar 400/600/700 (italik 400 var). Rakamlar `font-variant-numeric: tabular-nums`.
- **Responsive**: mobil-öncelikli; 390px'te yatay taşma yok; nav mobilde çekmeceye katlanır (`.mobile-toggle` → `#mobileDrawer`).
- **Baskı**: `@media print` — nav/footer gizli, tablolar okunur.
- **Sınıf adlandırma**: tutarlı, BEM-benzeri (`.dates-table__firm`), küçük bir utility seti kabul (`.visually-hidden`, `.flow`, `.measure`).

## 4. Değişmezler — `python3 _tools/validate.py <sayfa>` GEÇMEDEN iş bitmiş sayılmaz
- `data-i18n` / `data-i18n-html` öznitelikleri ve **içindeki metin aynen korunur** (JS yüklenince sözlükten yeniden yazar; HTML metni no-JS/SEO yedeğidir). Bu elemanların İÇİNE yeni etiket koyma; öznitelikleri başka elemana taşıyabilirsin ama anahtar kaybolmaz.
- Tüm `id`'ler korunur (çapa hedefleri: başka sayfalardan link geliyor). Bir bölümü yeniden yapılandırırken id'yi yeni sarmalayıcıya taşı.
- `js/main.js` **dokunulmaz**. JS kancaları (sınıf/ID) korunur; her sayfada zorunlu olanlar: `.lang-btn-tr`, `.lang-btn-en`, `.mobile-toggle`, `#mobileDrawer`, `.mobile-drawer-close`, `.open-search-modal`, `body[data-title-key]`.
  Sayfaya özel kancalar: index → `#countDays #countHours #countMins #countSecs` (geri sayım, kalsın; `#signalCanvas` kaldırılabilir); komiteler → `button.committee-card[data-bio]`, `.committee-role-badge .committee-name .committee-affiliation`, `#bioModal #bioName #bioRole #bioAff #bioText #bioAvatar #bioSource .bio-modal-close`; katilim → `#otelHarita #kampusHarita` + Leaflet script bloğu; arsiv → `#archiveSearchInput`, `.archive-table tbody tr`; index arama → `#searchModal #globalSearchInput #globalSearchResults .search-modal-close` (diğer sayfalarda JS kendisi üretir).
- Footer'da CMT bilgilendirme metni (İngilizce, aynen) kalır.
- `css/style.css?v=` ve `js/main.js?v=` referansları kalır. Google Fonts/CDN isteği yok.
- Tek `<h1>`, `<main id="icerik">`, `<html lang="tr">`, `<body data-title-key="…">`.
- **Header/footer/mobil çekmece/arama modalı kabuğu 11 sayfada birebir aynı** (index.html'deki kabuk kaynak; diğer sayfalar aynen kopyalar; yalnızca aktif menü sınıfı `.active`/`aria-current` değişir).

## 5. Dosya kuralları
- Sadece sana atanan dosya(lar)a yaz. `css/style.css`'e yalnızca tasarım-sistemi ajanı yazar.
- Sayfa ajanları sayfaya özel kuralları `css/pages/<sayfa>.css` dosyasına yazar ve sayfadan `<link rel="stylesheet" href="css/pages/<sayfa>.css?v=16">` ile bağlar (style.css'ten SONRA). Genel bir bileşen gerekiyorsa uydurma: sayfa CSS'ine yaz, çıktında "promote" olarak bildir.
- Yönlerin taslakları `_design/<A|B|C>/` altına yazılır; canlı dosyalara DOKUNULMAZ.

## 6. Test tarifi
```
python3 _tools/validate.py index.html            # değişmezler
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=1366,2400 --virtual-time-budget=4000 --screenshot=/tmp/x-desktop.png "http://localhost:8791/index.html?lang=tr"
"$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=390,2600  --virtual-time-budget=4000 --screenshot=/tmp/x-mobile.png  "http://localhost:8791/index.html?lang=tr"
```
Ekran görüntüsünü Read aracıyla aç ve **kendi gözünle** değerlendir; gerekirse düzelt, tekrar çek.

## 7. Sayfa envanteri (bölüm id'leri)
- index.html — hero, #tarihler (8 satırlık resmî takvim: Son Tarih + Kesin Son Tarih), #kulvarlar (5 kulvar), #konusmacilar (TBA bloğu), sponsorlar, son gelişmeler (4 duyuru), geri sayım
- hakkinda.html — #hosgeldiniz #kapsam #ev-sahibi #logo-kimlik #tarihce-ozet
- yazarlar.html — #cfp #kulvarlar #kurallar #gonderim #sablonlar #ozel-oturumlar #baskiya-hazir (CFP PDF düğmeleri TR/EN)
- program.html — #genel-akis #bilimsel-program #konusmacilar #seminerler #sosyal-program (çoğu TBA)
- yarisma.html — #lisans #tez #destek
- katilim.html — #kayit (ücretler TBA) #kapsam #konaklama (Leaflet harita + oteller) #ulasim (kampüs haritası) #sss
- komiteler.html — #baskanlar #tpc #duzenleme (tıklanınca biyografi modalı)
- arsiv.html — 35 satırlık tablo + arama
- iletisim.html — adres/e-posta/telefon + mailto formu + KVKK onayı
- kvkk.html — aydınlatma metni
- 404.html — kök yollu bağlantılar (`/…`) bilinçli, öyle kalsın

## 8. Mevcut renk/aralık değişkenleri (`css/style.css :root`, referans)
```css
:root {
  /* Medipol Renk Paleti */
  --medipol-navy: #002B49;        /* Medipol ana lacivert */
  --medipol-navy-dark: #001A2C;   /* Derin lacivert */
  --medipol-navy-light: #0B3D66;  /* Açık lacivert tonu */
  --medipol-cyan: #00A3E0;        /* Medipol dinamik turkuaz / gök mavisi */
  --medipol-cyan-hover: #0088C2;  /* Koyu turkuaz hover */
  --medipol-cyan-glow: rgba(0, 163, 224, 0.18);
  --medipol-cyan-light: #F0F9FD;  /* Yumuşak zemin mavisi */


  /* Nötr Tonlar ve Yüzeyler */
  --color-bg: #FFFFFF;
  --color-surface: #FFFFFF;
  --color-surface-soft: #F8FAFC;
  --color-surface-hover: #F1F5F9;
  
  --color-text-title: #0F172A;
  --color-text-primary: #1E293B;
  --color-text-secondary: #475569;
  --color-text-muted: #64748B;
  --color-border: #E2E8F0;
  --color-border-dark: #CBD5E1;

  /* Vurgu ve Durum Renkleri */
  --color-accent-amber: #D97706;
  --color-accent-amber-bg: #FEF3C7;
  --color-success: #059669;
  --color-success-bg: #ECFDF5;
  --color-info: #0284C7;
  --color-info-bg: #E0F2FE;

  /* Tipografi */
  --font-sans: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  /* Tek aile kullanılıyor; serif değişkeni geriye dönük uyumluluk için sans'a bağlı. */
  --font-serif: var(--font-sans);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* Boyut ve Izgara */
  --container: 1200px;
  --container-narrow: 860px;
  --radius-xs: 2px;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-none: 0px;

  /* Gölgeler - Son derece ölçülü, kurumsal ve modern */
  --shadow-subtle: 0 1px 3px rgba(0, 43, 73, 0.05);
  --shadow-card: 0 4px 12px rgba(0, 43, 73, 0.04), 0 1px 2px rgba(0, 43, 73, 0.03);
  --shadow-card-hover: 0 10px 24px rgba(0, 43, 73, 0.08), 0 2px 6px rgba(0, 43, 73, 0.04);
  --shadow-dropdown: 0 12px 32px rgba(0, 43, 73, 0.12);
  --shadow-glow: 0 0 20px rgba(0, 163, 224, 0.25);

  /* Geçişler */
  --transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
```
