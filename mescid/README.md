# Nasûhî — tanıtım sayfası

Uygulamanın (önceki adıyla ODTÜ Mescid) tanıtım ve gizlilik politikası sayfaları. Sitenin diğer projeleriyle
aynı yapıda:

```
index.html                     tanıtım sayfası
gizlilik.html                  gizlilik politikası (Google Play ve uygulama bu adresi kullanır; adresi değiştirme)
assets/css/main.css            tokenlar → reset → bileşenler → responsive
assets/js/main.js              initX() modülleri + tek boot()
assets/img/                    uygulamanın gerçek ekran görüntüleri (WebP, 540 px), nasuhi-* logo ve
                               favicon dosyaları, og.jpg (1200×630)
```

Uygulama Google Play üzerinden dağıtılır; sayfa APK barındırmaz. Play'de herkese açıldığında `btn--soon`
rozetleri Play mağaza bağlantısına (`https://play.google.com/store/apps/details?id=com.mevlutcelik.nasuhi`)
çevrilir.
