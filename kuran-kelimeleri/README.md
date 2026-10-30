# Kur'an Kelimeleri — tanıtım sayfası

Android uygulamasının tanıtım ve gizlilik politikası sayfaları. Sitenin diğer projeleriyle aynı yapıda; stil
`mescid/` sayfasından türetildi, vurgu rengi uygulamanınki gibi nane yeşili (#3DDC97).

```
index.html                     tanıtım sayfası
gizlilik.html                  gizlilik politikası (Google Play ve uygulama bu adresi kullanır; adresi değiştirme)
assets/css/main.css            tokenlar → reset → bileşenler → responsive
assets/js/main.js              initX() modülleri + tek boot()
assets/img/                    uygulamanın gerçek ekran görüntüleri (WebP, 540 px), kelimeler-* logo ve
                               favicon dosyaları, og.jpg (1200×630)
```

Uygulamanın kaynak kodu ve kelime destesi: https://github.com/fatihyaman661/kuran-kelimeleri-flashcard

Uygulama Google Play üzerinden dağıtılır; sayfa APK barındırmaz. Play'de herkese açıldığında `btn--soon`
rozetleri Play mağaza bağlantısına (`https://play.google.com/store/apps/details?id=com.mevlutcelik.kelimeler`)
çevrilir.
