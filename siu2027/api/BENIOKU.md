# SİU 2027 — Kayıt Servisi (kurulum notları)

Tek amacı **ön kayıt** almak: katılımcı bilgisi + kayıt kategorisi + fatura tercihi.
**Kart bilgisi istenmez, alınmaz, saklanmaz.** Ödeme ayrı bir adımdır.

## Kurulum (paylaşımlı hosting / Apache + PHP 8.1+)

1. Tüm siteyi sunucuya yükleyin.
2. `api/config.sample.php` dosyasını `api/config.php` adıyla kopyalayıp doldurun
   (bu depoda örnek bir `config.php` zaten var; **export_token'ı değiştirin**).
3. `data/` dizini PHP tarafından yazılabilir olmalı (`chmod 775`).
4. Hepsi bu. Derleme adımı, composer, node yok.

### Gerekenler
- PHP 8.1+ (`pdo_sqlite` açık — neredeyse her hostingde açıktır)
- Giden e-posta: `mail()` çalışmıyorsa `config.php` içinde `mail.enabled = false` yapın;
  kayıtlar yine veritabanına yazılır, CSV ile takip edilir.

### MySQL'e geçiş
`config.php` içinde `db.driver` değerini `mysql` yapıp bilgileri girin. Şema ilk
istekte otomatik kurulur; kod değişikliği gerekmez.

## Dosyalar
| Dosya | İş |
|---|---|
| `kayit.php` | POST uç noktası. JSON (fetch) ve normal form gönderimi kabul eder. |
| `token.php` | CSRF anahtarı üretir (fetch akışı için). |
| `disa-aktar.php` | `?token=…` ile CSV indirir (Excel uyumlu, UTF-8 BOM). |
| `lib/db.php` | PDO bağlantısı + şema kurulumu + kayıt numarası üretimi. |
| `lib/guard.php` | CSRF, bal küpü, hız sınırı, girdi temizliği. |
| `lib/mail.php` | Düz metin e-posta. |
| `sema.sql` | Tablo şeması. |

## Güvenlik
- CSRF anahtarı oturum tabanlı, `hash_equals` ile doğrulanır.
- Bal küpü alanı (`website`) doluysa istek sessizce başarılı gibi yanıtlanır.
- Hız sınırı: aynı IP özetinden saatte `rate_limit_per_hour` kayıt (varsayılan 8).
- IP **saklanmaz**; yalnızca HMAC özeti tutulur (KVKK: veri minimizasyonu).
- Tüm sorgular hazır ifadelerle (prepared statement) çalışır.
- `api/.htaccess` config dosyalarını, `data/.htaccess` veritabanını web erişimine kapatır.
  **Nginx kullanılıyorsa** bu iki dizin için eşdeğer `deny` kuralı elle yazılmalıdır.

## Ödemeye bağlama (sonra)
`config.php` içinde:
```php
'payment' => ['mode' => 'doner_sermaye', 'url' => 'https://…/tahsilat'],
```
Bu durumda onay e-postasında ödeme bağlantısı `?ref=SIU27-XXXXXX` ile verilir; tahsilat
tarafı bu numarayı dekontla eşleştirir. Kart verisi hiçbir aşamada bu sunucuya uğramaz.

## KVKK
- Form, aydınlatma metni onayı olmadan gönderilemez (`kvkk_onay` zorunlu).
- Toplanan alanlar `kvkk.html` içindeki "İşlenen Kişisel Veriler" başlığıyla uyumludur.
- CSV bağlantısı yalnızca Kurultay Sekreterliği ile paylaşılmalıdır.
- Saklama süresi dolduğunda kayıtlar silinmelidir (kvkk.html madde 6).
