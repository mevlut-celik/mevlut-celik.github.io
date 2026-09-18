# SİU 2027 — Bileşen Rehberi (sayfa ajanları için)

Tek CSS kaynağı: `css/style.css` (sayfadan `css/style.css?v=16` ile bağlanır). Sayfaya özel kurallar
`css/pages/<sayfa>.css` dosyasına yazılır ve style.css'ten SONRA bağlanır. Buradaki sınıflar site genelidir;
yeni "genel" bileşen uydurmayın — sayfa CSS'ine yazıp "promote" olarak bildirin.

Tasarım dili: editoryal/akademik yayın. Çizgi, kutu değil. Kart yok (komite üyesi hariç), ikon yok, gölge yok,
gradient yok, border-radius yok (avatar dairesi hariç). Büyük harf etiketler sözlükten geliyorsa görsel olarak
sakinleştirilir (`.kicker`) ya da `.visually-hidden` yapılır; metin ve `data-i18n` anahtarı asla değişmez.
Resmî adlar (IEEE, Medipol, SİU) küçük harfe çevrilmez; `text-transform` kullanılmaz (Türkçe İ/ı riski).

## 0. Kabuk (index.html'den birebir kopyalanır)

`index.html` içinde iki işaretli blok vardır; diğer 10 sayfa bu blokları **aynen** kopyalar:

| Blok | Başlangıç | Bitiş | İçerik |
|---|---|---|---|
| Üst kabuk | `<!-- KABUK:BAŞ … -->` | `<!-- KABUK:SON -->` | `<header class="masthead">`: üst şerit (tarih · Arama · TR/EN), marka satırı (logo + ad + Medipol + `.nav-toggle.mobile-toggle`), `<nav class="site-nav">` tek satır menü + açılır alt menüler |
| Alt kabuk | `<!-- ALTBİLGİ:BAŞ … -->` | `<!-- ALTBİLGİ:SON -->` | `<footer class="site-footer">` (4 sütun + CMT metni + KVKK/erişilebilirlik satırı), arama modalı `#searchModal`, mobil çekmece `#mobileDrawer` |

Kopyalarken yalnızca şunlar değişir:
- Ana menüde aktif sayfa: `<a … class="site-nav__link active" aria-current="page">` (index'te "Ana Sayfa"da; diğer sayfada ilgili bağlantıya taşınır, index'ten kaldırılır). Alt menülü öğelerde `site-nav__link--menu` sınıfı kalır, `active` eklenir.
- Mobil çekmecede aynı şekilde `class="mobile-nav-link active" aria-current="page"`.
- Kabuk dışı: `<body data-title-key="…">`, `<title>`, meta'lar ve `<main id="icerik">` içeriği.

Sayfa iskeleti:
```html
<body data-title-key="ttlXxx">
  <a class="skip-link" href="#icerik">Ana içeriğe atla</a>
  <!-- KABUK:BAŞ --> … <!-- KABUK:SON -->
  <main id="icerik"> … </main>
  <!-- ALTBİLGİ:BAŞ --> … <!-- ALTBİLGİ:SON -->
  <script src="js/main.js?v=16"></script>
</body>
```
Yollar göreli (`assets/…`, `css/…`, `js/…`); 404.html kök yollu kalır (bilinçli).

## 1. Token'lar (`:root`)
- Renk: `--navy` (#002B49 başlık/çizgi/düğme), `--navy-deep` (footer), `--cyan-text` (#0074A6, link — beyazda 5.2:1), `--cyan` (#00A3E0 yalnız aktif alt çizgi), `--ink`/`--ink-2`/`--ink-3` (metin; `--ink-3` 5.8:1), `--ink-4` **yalnız dekoratif** (ayraç noktası), `--paper`/`--paper-2`/`--paper-3` (zemin), `--rule`/`--rule-2` (hairline).
- Tip ölçeği: `--step--2` (13–14px, en küçük metin) … `--step-5` (h1). Gövde `--step-0` = 16–17px.
- Boşluk: `--space-1` (4px) … `--space-9` (96px). Ölçü: `--measure: 68ch`, `--wrap: 72rem`, `--side-w: 16.5rem`.
- Rakamlar her yerde tabular (`body`).

## 2. Yardımcılar
| Sınıf | Ne için |
|---|---|
| `.wrap` | Sayfa genişliği + yan boşluk (gutter). Her bant içinde bir `.wrap`. |
| `.measure` | Okuma ölçüsü (68ch) sınırı. |
| `.flow` | Çocuklar arası dikey ritim (`* + *`). |
| `.visually-hidden` | Ekranda gizli, ekran okuyucuya açık (sözlükten gelen kicker'lar için). |
| `.lede` | Giriş paragrafı (büyük, `--ink-2`). |
| `.small`, `.muted` | Küçük / sessiz metin. |
| `.kicker` (= `.editorial-label`) | Sözlükten gelen BÜYÜK HARF etiket: 13–14px, 400, gri, 0.02em. Görünür kalması gerekiyorsa bu; gerekmiyorsa `.visually-hidden`. |
| `.link-more` | Metin bağlantısı + tipografik ok: `<a class="link-more"><span data-i18n="…">…</span> <span class="arrow" aria-hidden="true">→</span></a>` |
| `.prose` | Uzun metin (h2 üstü hairline, gerçek madde imleri, blockquote, dl). |
| `.grid-2` | İki sütunlu liste/metin (≥48em). |
| `.facts` | Çizgili tanım listesi (künye): `<dl class="facts"><div><dt>…</dt><dd><span class="facts__val">…</span><span class="facts__sub">…</span></dd></div></dl>` |

## 3. Sayfa başlığı bandı (index dışı tüm sayfalar)
```html
<section class="page-head" aria-labelledby="sayfa-title">
  <div class="wrap">
    <ol class="breadcrumb"><li><a href="index.html">Ana Sayfa</a></li><li>…</li></ol>   <!-- isteğe bağlı -->
    <p class="visually-hidden" data-i18n="xxKicker">BÜYÜK HARF KICKER</p>               <!-- sözlükte varsa -->
    <h1 class="page-head__title" id="sayfa-title" data-i18n="xxTitle">…</h1>
    <p class="page-head__lede lede" data-i18n="xxLede">…</p>
    <p class="page-head__meta">Son güncelleme … (isteğe bağlı)</p>
  </div>
</section>
```

## 4. Gövde ızgarası
- Yan sütunlu: `<div class="wrap body-grid"><div class="col-main">…</div><aside class="col-side side" aria-label="…">…</aside></div>`
  Kaynak sırası: önce `.col-main`, sonra `<aside>`; ≥64em'de yan sütun sağda yapışkan (max-height + iç kaydırma), altında mobilde iki sütunlu özet şeridi.
- Yan sütunsuz: `<div class="wrap body-grid body-grid--single"><div class="col-main">…</div></div>` (ana kolon 52rem ile sınırlı).
- Yan sütun blokları: `.side__block` (+ `.side__block--toc` mobilde gizlenir), `.side__title` (h2), `.toc` (sayaçlı `<ol>`, 01–05 bölüm numaralarıyla birebir), `.toc--plain` (sayaçsız, sol çizgili), `.quick-links` (ok işaretli liste).

Sayfa içi nav örneği:
```html
<aside class="col-side side" aria-label="Sayfa içi gezinme">
  <nav class="side__block side__block--toc" aria-label="Bu sayfada">
    <ol class="toc">
      <li><a href="#cfp" data-i18n="…">Bildiri Çağrısı</a></li>
      …
    </ol>
  </nav>
</aside>
```
TOC maddeleri **bölümün kendi h2 anahtarını** kullanır; başka amaçlı sözlük anahtarı (il022, footerQuickLinks vb.) yeniden kullanılmaz.

## 5. Bölüm (`.section`)
```html
<section class="section" id="cfp" aria-labelledby="cfp-title">
  <div class="section__head">
    <span class="section__num" aria-hidden="true">01</span>          <!-- TOC sayacıyla eşleşir; TOC'suz sayfada atlanabilir -->
    <h2 id="cfp-title" data-i18n="…">Bildiri Çağrısı</h2>
    <p class="visually-hidden" data-i18n="…Kicker">BÜYÜK HARF KICKER</p>   <!-- anahtar korunur, ekranda yok -->
    <a href="…" class="link-more">…</a>                                <!-- yalnız gerekiyorsa, sağda tek bağlantı -->
  </div>
  <p class="section__lede" data-i18n="…">…</p>                        <!-- isteğe bağlı; konuşmacı/sponsor gibi bölümlerde atla -->
  <div class="section__body">…</div>
  <p class="section__foot"><a class="link-more">…</a></p>
</section>
```
- `.section + .section` arası boşluk otomatik. `.section--tail`: numarasız, hairline'lı kuyruk bölümü (sponsorlar gibi).
- `.section__title--caps`: h2 metni sözlükte BÜYÜK HARF ise (örn. `theLatestKicker`) boyutu dengelemek için.

## 6. Tablolar
- Genel tablo: `<table class="table">` (+ `.table--zebra`, `.table--compact`); sayısal sütun `class="num"`; not `<caption>` ya da `.table__note`; geniş tablo `<div class="table-wrap">` içinde (yatay kaydırma; hairline ipucu için `.table-wrap--hint`). İlk sütun `<th scope="row">`.
- Fiyat tablosu: `<table class="table price-table">`, tutar hücresi `<td class="num price-table__amount">`, kademe `<th scope="row" class="price-table__tier">Tam Kayıt <span class="price-table__desc">…</span></th>`. Kart değil.
- Arşiv: `<table class="archive-table">` (main.js `.archive-table tbody tr` filtreler). Yıl `class="archive-year"`. Arama: `<div class="search-field"><label class="visually-hidden" for="archiveSearchInput">…</label><input type="search" id="archiveSearchInput" …></div>`. Boş sonuç `.archive-empty`.
- Tarih tablosu (index): `.dates-table` — colgroup ile ch tabanlı sütunlar; ≤40em'de satır-blok katlama. Her td'de `<span class="dates-table__cell-label" data-i18n="datesThDeadline">Son Tarih</span>` (yalnız mobilde görünür), `role="table/row/rowheader/columnheader/cell"` semantiği korur. Diğer sayfalarda benzer tarih tablosu gerekiyorsa aynı kalıp kopyalanır.
- Durum metni: `.status` / `.status-badge` (+ `--active`, `--event`, `--done`) — rozet değil, sade metin.

## 7. Düğmeler ve indirmeler
- `.btn` (çerçeveli), `.btn--primary` (lacivert dolu), `.btn--small`, `.btn--block`, `.btn-group` (yan yana). Sayfada en fazla **bir** birincil düğme; ikincil eylemler metin bağlantısı.
- İndirme: `<div class="download-list"><a class="btn btn--download" href="assets/SIU_2027_CFP_TR.pdf" download><span data-i18n="…">Bildiri Çağrısı (TR)</span><span class="btn__meta">PDF · 2 sayfa</span></a></div>`

## 8. Bilgi bloğu (TBA)
```html
<div class="notice notice--tba">
  <p class="notice__title" data-i18n="…">Henüz kesinleşmedi.</p>
  <p class="notice__text" data-i18n="…">…</p>
  <a href="…" class="link-more">…</a>
</div>
```
`.notice` (lacivert sol çizgi) genel bilgi; `.notice--tba` (gri çizgi) "henüz belli değil" için.

## 9. SSS akordeon (`<details>`)
```html
<div class="faq">
  <details class="faq__item">
    <summary data-i18n="kt101">Soru?</summary>
    <div class="faq__body"><p data-i18n="kt102">Cevap.</p></div>
  </details>
</div>
```
(`summary` içinde data-i18n varsa `summary`'nin kendisine koy; içine yeni etiket sokma.)

## 10. Filtre sekmeleri ve oturum satırları (program)
- `<div class="filter-bar" role="group" aria-label="Gün"><span class="filter-bar__label">Gün</span><button class="filter-btn filter-day-btn active" data-filter-day="all">Tümü</button>…</div>` — main.js `.active` sınıfını yönetir.
- `<ol class="session-list"><li class="session-card" data-day="1" …><span class="session-card__time">09:00–10:30</span><span class="session-card__title">…</span><span class="session-card__meta">Salon A · Kulvar 1</span></li></ol>`

## 11. Komite kartı + biyografi modalı (komiteler)
```html
<h3 class="committee-section-title" id="tpc-title">…</h3>
<div class="committee-grid">
  <button type="button" class="committee-card" data-bio="anahtar" aria-haspopup="dialog">
    <span class="committee-avatar-wrap"><img src="assets/avatar-….svg" alt="" width="96" height="96" loading="lazy"></span>
    <span class="committee-info">
      <span class="committee-role-badge">Genel Başkan</span>
      <span class="committee-name">Ad Soyad</span>
      <span class="committee-affiliation">Kurum</span>
    </span>
  </button>
</div>
<!-- sayfa sonunda, bir kez -->
<div class="modal-backdrop" id="bioModal" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="bioName">
  <div class="bio-modal-box">
    <button type="button" class="bio-modal-close" aria-label="Kapat">&times;</button>
    <div class="bio-modal-head"><img id="bioAvatar" src="assets/avatar-pending.svg" alt="" width="96" height="96"><div><div class="bio-modal-role" id="bioRole"></div><h2 class="bio-modal-name" id="bioName"></h2><div class="bio-modal-aff" id="bioAff"></div></div></div>
    <p class="bio-modal-text" id="bioText"></p>
    <p class="bio-modal-note" id="bioSource"></p>
  </div>
</div>
```
Kart yalnızca burada meşru (gerçekten bir "kart"). `.committee-card.pending` kesikli kenar.

## 12. Harita kabı (katılım, Leaflet)
`<div id="otelHarita" class="map-frame" role="application" aria-label="…"></div>` (+ `.map-frame--tall`), altına `<p class="map-caption">`. Leaflet CSS/JS `assets/leaflet/` (CDN yok). Otel/adres listesi: `<dl class="venue-list"><div><dt>Otel</dt><dd>…</dd></div></dl>`.

## 13. Form (iletişim)
```html
<form class="form" action="mailto:…" method="post" enctype="text/plain">
  <div class="form-grid">
    <div class="form-row"><label for="ad">Ad Soyad <span class="form-required">*</span></label><input type="text" id="ad" name="ad" required></div>
    <div class="form-row"><label for="eposta">E-posta *</label><input type="email" id="eposta" name="eposta" required></div>
  </div>
  <div class="form-row"><label for="konu">Konu</label><select id="konu" name="konu">…</select></div>
  <div class="form-row"><label for="mesaj">Mesaj *</label><textarea id="mesaj" name="mesaj" required></textarea><p class="form-help">…</p></div>
  <label class="form-check"><input type="checkbox" required> <span data-i18n-html="il025">…KVKK…</span></label>
  <div class="form-actions"><button type="submit" class="btn btn--primary">Gönder</button><span class="small muted">…</span></div>
</form>
```

## 14. KVKK / uzun hukuki metin
`<article class="legal">` içinde `<p class="legal__meta">Yürürlük: …</p>`, ardından `h2` (otomatik "1. 2. 3." numaralanır) + paragraflar/listeler. Yan sütunda `.toc--plain` ile madde listesi verilebilir.

## 15. 404
```html
<div class="wrap"><div class="error-page">
  <p class="error-page__code" aria-hidden="true">404</p>
  <h1 class="error-page__title">Sayfa bulunamadı</h1>
  <p class="lede">…</p>
  <ul class="error-page__links"><li><a href="/index.html">Ana Sayfa</a></li>…</ul>
</div></div>
```

## 16. Erişilebilirlik ve davranış kuralları
- Odak halkası: 2px lacivert (`:focus-visible`); koyu zeminde beyaz. Kaldırmayın.
- Açılır menüler `:hover` + `:focus-within`; üst bağlantı gerçek sayfaya gider (dokunmatikte alt menü keşfedilemese de içerik ulaşılabilir).
- `body { overflow-x }` **yok**; taşma varsa kaynağını düzeltin (390px'te `document.documentElement.scrollWidth === 390` olmalı).
- Gölge yok; `box-shadow` yalnız `.btn--primary:focus-visible` iki tonlu halkada.
- Baskı: nav/footer/yan sütun gizli; tablolar, hero künyesi basılır.

## 17. Doğrulama
`python3 _tools/validate.py <sayfa>.html` GEÇTİ (satır içi `style=` 0). Ekran görüntüsü: brif §6.
Mobil çerçeve (headless Chrome 500px alt sınırı için): `http://localhost:8791/_design/final/mobile-frame.html` — iframe `src`'sini sayfaya göre değiştirin.
