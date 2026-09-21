# SİU 2027 ile SİU 2026 Web Sitesi Karşılaştırması

> **UYGULANDI — 21 Eylül 2026, `?v=38`**
>
> Bu rapordaki iki madde uygulandı:
>
> 1. **Kulvar yapısı SİU 2026 ile birebir eşitlendi.** Beş kulvar yediye çıkarıldı. Alt konu sayıları SİU 2026 ile aynı: 30, 9, 12, 11, 9, 11, 11. Eklenen iki kulvar: *Doğal Dil İşleme ve Metin Madenciliği* ve *Robotik, Kontrol ve Otomasyon*. Değişiklik `yazarlar.html` tam listesine, ana sayfa kartlarına ve iki CFP PDF'ine işlendi.
> 2. **Onur Kurulu eklendi.** `komiteler.html` içinde 04 numaralı yeni bölüm. Beş üye: Bülent Sankur, Lale Akarun, Enis A. Çetin, Aytül Erçil, Fatoş T. Yarman Vural. Bu isimler hem SİU 2025 hem SİU 2026 sitelerinde aynı, yani sürekli bir kurul. SİU 2027 onursal başkanları bu kurul içinden seçileceği için bölüm ledesi bunu belirtiyor.
>
> **Kurulun onayı gerekiyor:** Onur Kurulu üyelerinin adları SİU 2025 ve SİU 2026 resmî sitelerinden alındı, SİU 2027 için ayrıca teyit edilmedi. Unvanlar site içi tutarlılık için "Prof. Dr." olarak yazıldı. Yayın öncesi kurul teyidi alınmalı.

**Tarih:** 21 Eylül 2026
**Karşılaştırılan:** `siu2026.pirireis.edu.tr` (34. SİU, Piri Reis Üniversitesi, 7–10 Temmuz 2026)
**Referans olarak ayrıca:** `siu2025.isikun.edu.tr` (33. SİU, Işık Üniversitesi)

Not: SİU 2026 kurultayı Temmuz 2026'da yapıldı, site şu an kurultay sonrası durumda. Bazı boşluklar (etkinlik takvimi kutusu, sosyal aktiviteler) bundan kaynaklanıyor olabilir, tasarım hatası değil. Bu ayrım aşağıda ayrıca belirtildi.

---

## 1. Kısa hüküm

Teknik kalite, erişilebilirlik, SEO altyapısı ve CMT uyumunda **bizim sitemiz açık ara önde**. İçerik derinliğinde ve yazar odaklı operasyonel ayrıntıda **SİU 2026 önde**. Eksiklerimizin neredeyse tamamı "henüz yazılmamış içerik", onların eksiklerinin çoğu "altyapı kararı". İçerik açığı kapatılabilir, altyapı açığı kapatılamaz.

En önemli tek bulgu: **kulvar sayısı**. SİU 2025'te beş, SİU 2026'da yedi kulvar vardı. Bizim sitemizde beş var, yani bir önceki edisyonun yapısını değil, iki önceki edisyonunkini yansıtıyoruz.

---

## 2. Ölçülen teknik karşılaştırma

| Ölçüt | SİU 2026 | SİU 2027 (biz) |
|---|---|---|
| Altyapı | WordPress, özel tema | Statik HTML, üretim araçlı |
| Ana sayfa toplam ağırlığı | 4.515 KB | 1.740 KB |
| Varlık sayısı | 34 | 14 |
| Dış alan adına istek | 3 (CDN, sosyal medya) | 0 |
| `meta description` | ana sayfada yok | 12 sayfada var |
| JSON-LD yapısal veri | yok | `Event` + `Place` + `CollegeOrUniversity` |
| `og:image` | yok | 12 sayfada var |
| `canonical` | var | var |
| Sayfadaki `h1` sayısı | 4 | 1 |
| `aria-label` | 1 | 20 |
| `role=` | 0 | 43 |
| Satır içi `style=` | 66 | 0 |
| Atlama bağlantısı | yok | var |
| Dil değişimi | ayrı `/en/` sayfa ağacı | aynı adreste anlık geçiş |
| `.ics` takvim dosyası | yok | 2 dosya |
| Site içi arama | yok | var |
| KVKK aydınlatma metni | yok | `kvkk.html` |

Ağırlık farkının büyük kısmı görsellerden geliyor. Bizim 1.740 KB'ımızın 1.060 KB'ı iki logo dosyası; onlar küçültülürse fark daha da açılır.

---

## 3. CMT uyumu karşılaştırması

Bu, sitenin varlık sebebi olduğu için ayrı başlık.

| Ölçüt | SİU 2026 | SİU 2027 (biz) |
|---|---|---|
| Ana sayfada "Microsoft CMT" ibaresi | **0 kez** | 9 kez |
| Ana sayfada önemli tarihler tablosu | **yok** (boş "Yaklaşan Etkinlikler" kutusu) | 8 satırlık tablo |
| CMT teşekkür metni, web sayfasında | var (Bildiri Gönderimi sayfası) | 12 sayfanın altbilgisinde + gönderim bölümünde |
| CMT teşekkür metni, CFP PDF'inde | **yok** | var |
| Adım adım CMT gönderim kılavuzu | **yok** | 9 adım |
| Tarih yapısı | tek sütun, uzatma ayrımı yok | tek sütun |

Tarihleri yalnızca CFP PDF'inde tutmaları, CMT'nin "clear future dates on the website" şartı açısından zayıf bir tercih. Bizim ana sayfadaki tablomuz bu şartı doğrudan karşılıyor.

---

## 4. Bizde eksik olanlar

### 4.1 Yüksek öncelik: hiç olmayan bölümler

**Yeni Sonuçlar Çağrısı (poster oturumu).** SİU 2025 ve 2026'da var, bizde hiç yok. Ana bildiri sürecinden tamamen ayrı bir mekanizma:

- 1 sayfalık genişletilmiş özet, IEEE konferans formatında
- Türkçe ya da İngilizce, yalnız birinde
- **Çift kör değil**: yazarlar ve kurumlar gizlenmeden yazılır
- Türkçe başvurularda İngilizce başlık ve abstract **konulmaz** (ana bildirilerin tam tersi)
- CMT'de ayrı bir "Yeni Sonuçlar" izleği seçilerek gönderilir
- Hızlı değerlendirme: güncellik, özgünlük, potansiyel etki
- Kabul edilenler yüz yüze poster sunar
- **IEEE Xplore'da yayımlanmaz**, sayfada kalın harflerle belirtilmiş
- Ayrı ücret: tam kayıt 6.500 TL, öğrenci yazar 4.500 TL
- Kapsamı 5 kulvarla sınırlı, Doğal Dil İşleme ve Robotik dışarıda

**Eğitim Semineri (tutorial) öneri çağrısı.** Bizde seminerlerden söz ediliyor ama öneri çağrısının içeriği yok. Onlarda önerinin taşıması gereken 7 madde tanımlı: başlık, özet, amaçlar ve motivasyon, zamanlama ve hedef kitle, seminerin geçmişi ve önceki katılımcı sayısı, süre dahil ayrıntılı taslak, eğitmen özgeçmişleri. Beklenen süre **2×75 dakika**, öneri **4 sayfayı geçmeyen tek PDF**.

**Paneller sayfası.** Bizde program sayfasında seminerlerle birlikte tek satır. Onlarda panelin gerekçesi, düzenleyicileri ve odak soruları yayımlanmış.

**Galeri ve kurultay afişi.** İkisi de bizde yok. Afiş, duyuru yapmak isteyen bölümler için indirilebilir bir dosya.

### 4.2 Yüksek öncelik: yazar yönergelerinin teknik gövdesi

Bu bizim en zayıf kaldığımız yer. Onların yönergesinde olup bizde olmayan somut kurallar:

| Kural | SİU 2026 değeri |
|---|---|
| Yazı tipi | Times veya Times New Roman |
| Ana metin | 10 punto |
| Asgari punto | 7,5 punto, şekil ve tablo alt yazıları dahil |
| Sütun genişliği | 89 mm, sütun arası 7 mm |
| İçerik alanı | 185 mm × 235 mm |
| Üst / alt kenar boşluğu | 20 mm / 42 mm |
| Sol ve sağ kenar boşluğu | 13 mm |
| Sayfa numarası | bulunmamalı |
| PDF boyutu | 8 MB'ı aşmamalı |

Ayrıca bizde olmayan üç kural:

- **İki dilli başlık ve özet zorunluluğu.** Önce Türkçe sonra İngilizce başlık, birbirinin tam çevirisi. Önce "Özetçe" sonra "Abstract", yine tam çeviri. Bu bölümlerde özel sembol, matematiksel ifade ve referans kullanılmaz.
- **Anonim yer tutucu.** Yazar ve kurum bilgisi yerine "Yazarlar Gizlenmiştir" yazılabilir.
- **Kaynakça anonimleştirme kalıbı.** Kendi çalışmasına atıfta "daha önce geliştirdiğimiz gibi [3]" yerine "daha önce geliştirilmiştir [3]" ve kaynakçada "[3] Ayrıntılar, çift-taraflı gizlilik ilkesi kapsamında gizlenmiştir."

**SİU'ya özel anonim şablonlar.** Onlarda dört dosya barındırılıyor: Word 2016, Word 2003, LaTeX zip, örnek PDF. Bizde yalnız genel IEEE şablonlarına dış bağlantı var. Bizim sitede zaten "SİU 2027'ye özel şablon paketi hazırlandığında yayımlanacaktır" notu duruyor, yani bu bilinen bir eksik.

### 4.3 Orta öncelik: politika boşlukları

- **Çift gönderim yasağı.** "Bildiri değerlendirme süresince, bildiri içeriğine büyük ölçüde benzeyen başka bir metin herhangi bir diğer konferans veya çalıştaya gönderilmemeli veya gönderilmiş olmamalıdır."
- **Üretken yapay zekâ politikası.** IEEE yazar etiği kurallarına bağlanmış. 2027'de bunun daha da önemli olacağı açık.
- **CPCI-S taraması.** Onlar "IEEE Xplore'da yayınlanacaktır ve CPCI-S kapsamında taranmaktadır" diyor. Bizde CPCI-S hiç geçmiyor.
- **Bildiri dili kuralı bizde dar.** Onların yazar yönergesinde iki koşul var: yazarlardan birinin anadilinin Türkçe olmaması **veya ilk yazarın kurumunun Türkiye dışından olması**. Bizde yalnız birinci koşul var. Kendi içlerinde de tutarsızlar, CFP sayfasında kısa hâli kullanıyorlar.

### 4.4 Orta öncelik: baskıya hazır sürecin operasyonel ayrıntısı

Onlarda dört adıma bölünmüş ve her adım tıklama düzeyinde anlatılmış. Bizde eksik olanlar:

- **Telif bildirimi metinleri ve ISBN.** İlk sayfanın sol altına konacak dört ayrı ifade (ABD hükümeti, Crown, Avrupa Birliği, diğer) ve LaTeX için `\IEEEpubid` komutu. SİU 2027 ISBN'i alındığında aynısı gerekecek.
- **IEEE PDF eXpress konferans kimliği.** Onlarınki 71813X. Bizde "kabul mektubunda duyurulacaktır" deniyor, bu kabul edilebilir ama sonunda somut kimlik gerekecek.
- **CMT'ye yükleme dosya adı kuralı.** Paper ID'den üç karakterli ad: 2 → `002.pdf`, 137 → `137.pdf`.
- **Sıralama ön koşulu.** Baskıya hazır yüklemeden önce kayıt ödemesinin yapılmış olması gerekiyor. Bizde bu sıra açıkça yazılı değil.
- **eCF'nin geri alınamazlığı uyarısı.** "Gönderdikten sonra değişiklik yapamayacaksınız, IEEE'nin yenileme mekanizması yoktur."
- **Yaptırım cümlesi.** "IEEE copyright formu tamamlanmamış bildirilerin IEEE Xplore'da yayımlanması mümkün olamayacaktır."

### 4.5 Kayıt ve konaklama

SİU 2026 ücret tablosu, kendi ücretlerimizi belirlerken emsal olarak kullanılabilir:

| Kategori | Erken | IEEE Üyesi | Normal |
|---|---|---|---|
| Tam Kayıt | 8.500 ₺ | 7.500 ₺ | 10.000 ₺ |
| Limitli Kayıt | 6.500 ₺ | 6.000 ₺ | 8.000 ₺ |
| Öğrenci Yazar | 4.500 ₺ | 4.500 ₺ | 6.000 ₺ |
| Lisansüstü Dinleyici | 2.000 ₺ | 1.500 ₺ | 2.500 ₺ |
| Lisans Dinleyici | Ücretsiz | Ücretsiz | 1.000 ₺ |
| Dinleyici | 3.000 ₺ | 3.000 ₺ | 4.000 ₺ |
| Ek Bildiri Ücreti | 2.000 ₺ | 2.000 ₺ | 2.000 ₺ |
| Gala Yemeği | 2.500 ₺ | 2.500 ₺ | 3.000 ₺ |

Bizde olmayan iki mekanizma:

- **IEEE üyesi indirimi.** Ayrı bir sütun. Bizim tablomuzda böyle bir kırılım yok.
- **Limitli Kayıt.** Gala yemeği hariç tam kayıt paketi.
- **Ek Bildiri Ücreti.** Birden çok bildirisi kabul edilen yazarın ikinci ve sonraki bildirilerinin Xplore'da yayımlanması için. Bizde bu satır var ama ücreti TBA.

Konaklama sayfalarında yedi seçeneği fiyatlı listelemişler ve öğrenci yurdunu otellerle aynı listeye koymuşlar. Bizim konaklama bölümümüz şu an TBA.

### 4.6 Komite yapısı

Onlarda kabaca 50–60 kişi, bizde 14. Bizde hiç olmayan görev başlıkları:

- **Onursal Başkanlar** ve **Onur Kurulu** (SİU'nun kurucu isimleri; 2025'te de var, kurumsal süreklilik göstergesi)
- **Kulvar Başkanları** (her kulvar için 4–5 kişilik ekipler)
- **Kurultay İdari Başkanı**
- **Sponsorluklar Başkanı** (bizde Endüstri İlişkileri ile birleşik)

---

## 5. Bizde olup onlarda olmayanlar

Bunlar korunmalı, çünkü hiçbiri SİU 2026'da yok:

- Ana sayfada sekiz satırlık önemli tarihler tablosu
- Adım adım CMT gönderim kılavuzu
- Özel oturum **öneri** yönergesi ve öneri takvimi (onlarda öneri süreci hiç yayımlanmamış, yalnız kabul edilen oturumlar listelenmiş)
- KVKK aydınlatma metni
- Çevrimiçi kayıt formu ve arka ucu
- 1993–2027 arşivi, animasyonlu harita ve yıl sürgüsüyle
- Komite üyelerine tıklayınca açılan biyografiler
- Sıkça sorulan sorular
- Takvim dosyaları (`.ics`) ve Google Takvim bağlantısı
- Site içi arama
- PDF üst verisinden yazar adı temizleme maddesi
- JSON-LD, `og:image`, her sayfada `meta description`
- Tek kaynaktan üretilen tutarlı metin. SİU 2026'da aynı kulvar listesi iki sayfada elle tutulduğu için birbirinden kaymış durumda; bizim üretim aracımız bunu yapısal olarak engelliyor.

---

## 6. Onların hatası, tekrarlamayalım

- **Ana sayfada tarih yok.** Tarihler yalnız CFP PDF'inde. CMT için risk.
- **Sosyal Aktiviteler sayfası hiç doldurulmamış**, kurultay yapıldığı hâlde "İçerik yakında eklenecek" yazıyor.
- **Hoş geldiniz mesajı imzasız**, kimin yazdığı belli değil.
- **Türkçe kayıt sayfasında ödeme bilgisi yok**, IBAN ve döviz tablosu yalnız İngilizce sayfada. İki dil arasında bilgi eşitliği yok.
- **İngilizce programda oturum başlıkları Türkçe kalmış.** Yabancı katılımcı için programın en kritik kısmı okunamıyor. 5DT yarışması sayfası hiç çevrilmemiş.
- **Yarışmalarda ödül tutarı ve jüri açıklanmamış.** Bizde somut ödül yazmak gerçek bir fark yaratır.
- **Sayfada dört `h1`**, atlama bağlantısı yok, `role` ve `aria-label` neredeyse hiç yok.
- **Eğitim semineri önerileri kurumsal adrese değil, bir başkanın kişisel akademik e-postasına** yönlendirilmiş.
- **Havalimanı ulaşımı ve otopark bilgisi yok.**

---

## 7. Kurulun karar vermesi gerekenler

1. **Kulvar sayısı: 5 mi 7 mi?** SİU 2026'da Doğal Dil İşleme ve Metin Madenciliği ile Robotik, Kontrol ve Otomasyon bağımsız kulvar oldu ve her birine ayrı kulvar başkanları atandı. SİU 2027 bunu sürdürecekse hem kulvar listesi hem komite yapısı değişir. Bu karar CFP'yi, CMT track yapısını ve TPK atamalarını birden etkiler.

2. **Yeni Sonuçlar poster oturumu açılacak mı?** İki edisyondur var. Açılacaksa ayrı bir CMT izleği, ayrı ücret ve ayrı takvim gerekiyor.

3. **Onur Kurulu ve Kulvar Başkanları ilan edilecek mi?** İkisi de SİU geleneğinin parçası, bizde hiç yok.

4. **IEEE üyesi indirimi ve Limitli Kayıt katmanı olacak mı?**

5. **Bildiri dili kuralı genişletilecek mi?** İkinci koşul ("ilk yazarın kurumu Türkiye dışından") eklenirse yabancı katılım kolaylaşır.

6. **Yarışma son başvuru tarihleri.** SİU 2025'te üçü de kurultaydan üç hafta önceydi, SİU 2026'da 16 Haziran'dı. SİU 2027 için karşılığı Haziran 2027 ortası olur.

---

## 8. Doğrulama notu

Şu veriler doğrudan ölçüldü veya kaynak sayfadan birebir teyit edildi: teknik tablo, ağırlık ölçümleri, `h1`/`aria`/`role`/satır içi stil sayıları, kulvar sayıları (2025 = beş, 2026 = yedi), CFP PDF'lerindeki CMT teşekkür metni varlığı, kayıt ücreti tablosu, Yeni Sonuçlar oturumunun Xplore'da yayımlanmama kuralı, yazar yönergesindeki dil kuralı ve şablon dosyaları.

Şu iki veri ikinci bir gözle kontrol edilmeli: SİU 2026'nın İngilizce sayfasındaki döviz ücret tablosunun kategori eşleşmesi, ve kulvar başkanı toplam sayısı.
