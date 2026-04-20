# Parlar Kariyer Formu (PHP)

Bu sürüm tamamen PHP tabanlıdır. Node.js / npm zorunlu değildir.

## Yayına alma

`public` klasöründeki dosyaları PHP destekli sunucuya yükleyin:

- `index.html`
- `styles.css`
- `logo.png`
- `submit.php`
- `success.html`

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
