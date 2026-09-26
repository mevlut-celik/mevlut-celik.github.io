# Parlar Kariyer Formu (PHP)

Bu sürüm tamamen PHP tabanlıdır. Node.js / npm zorunlu değildir.

## Yayına alma

`public` klasörünün **içeriğini** PHP destekli sunucuya yükleyin:

```
index.html            ilan + başvuru formu
success.html          başvuru sonrası teşekkür sayfası
submit.php            form işleyici (mail + dosyaya yedek)
logo.png
assets/css/main.css   stiller
assets/js/main.js     form içi doğrulama ve gönderim durumu
```

Klasör kökündeki `index.html`, `success.html`, `submit.php`, `logo.png` ve
`assets/` GitHub Pages önizlemesi için `public/` klasörünün aynısıdır.
Değişikliği önce `public/` içinde yapın, sonra kopyalayın:

```bash
cp public/index.html public/success.html public/submit.php public/logo.png . && rm -rf assets && cp -R public/assets ./assets
```

## Mail ayarları

`submit.php`, PHP `mail()` fonksiyonunu kullanır.

- `MAIL_TO` tanımlıysa onu kullanır.
- `MAIL_TO` yoksa fallback:
  - `parlar-w@parlar.org.tr,mevlutc@freshdatatechnology.com`
- `MAIL_FROM` tanımlıysa onu kullanır.
- `MAIL_FROM` yoksa:
  - `no-reply@<server-name>`

## Not

Sunucuda `mail()` çalışmıyorsa başvurular `applications.ndjson` dosyasına satır satır kaydedilir.

`server.js` (Express) alternatif bir Node sunucusudur ve `/api/apply` uç noktasını sunar;
form ise `submit.php`'ye gönderir. Node ile çalıştıracaksanız formun `action` değerini
buna göre değiştirmeniz gerekir.
