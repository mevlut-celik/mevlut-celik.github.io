# ODTÜ Mescid — tanıtım sayfası

Uygulamanın tanıtım ve APK indirme sayfası. Sitenin diğer projeleriyle aynı yapıda:

```
index.html                     içerik
assets/css/main.css            tokenlar → reset → bileşenler → responsive
assets/js/main.js              initX() modülleri + tek boot()
assets/img/                    uygulamanın gerçek ekran görüntüleri (WebP) ve og.jpg (1200×630)
downloads/odtu-mescid.apk      telefon uygulaması (2.5)
downloads/odtu-mescid-saat.apk Galaxy Watch / Wear OS uygulaması (2.3)
```

## APK güncelleme

1. Yeni sürümü `downloads/odtu-mescid.apk` adıyla aynı yere koy.
2. `index.html` içinde sürüm numarasını, "6,7 MB" boyut ifadelerini, SHA-256 değerini
   (`shasum -a 256 downloads/odtu-mescid.apk`) ve "Neler yeni?" bölümünü güncelle.
