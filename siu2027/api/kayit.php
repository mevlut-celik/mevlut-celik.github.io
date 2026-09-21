<?php
/**
 * SİU 2027 — kayıt alma uç noktası.
 * POST: JSON (fetch) ya da normal form gönderimi (JS kapalıyken) kabul eder.
 * Kart/ödeme verisi ALINMAZ; ödeme ayrı bir adımdır.
 */
declare(strict_types=1);
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$cfg = require __DIR__ . '/config.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/guard.php';
require __DIR__ . '/lib/mail.php';

$xhr = (stripos($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json') !== false)
    || (strtolower($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === 'fetch');

$dil = (($_POST['dil'] ?? 'tr') === 'en') ? 'en' : 'tr';

$M = [
 'tr' => [
   'yontem'     => 'Geçersiz istek yöntemi.',
   'oturum'     => 'Oturum doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.',
   'hiz'        => 'Çok fazla deneme yapıldı. Lütfen bir saat sonra tekrar deneyin.',
   'zorunlu'    => 'Bu alan zorunludur.',
   'eposta'     => 'Geçerli bir e-posta adresi girin.',
   'kategori'   => 'Lütfen bir kayıt kategorisi seçin.',
   'kvkk'       => 'Devam etmek için aydınlatma metnini onaylamanız gerekir.',
   'vergi'      => 'Kurumsal fatura için fatura unvanı, vergi dairesi ve vergi numarası zorunludur.',
   'sunucu'     => 'Kayıt sırasında bir sorun oluştu. Lütfen siu2027@medipol.edu.tr adresine yazın.',
   'basarili'   => 'Ön kaydınız alındı.',
   'eposta_konu'=> 'SİU 2027 ön kayıt onayı',
   'selam'      => 'Sayın',
   'giris'      => 'IEEE SİU 2027 ön kayıt talebiniz alınmıştır. Bu ileti bir ödeme dekontu değildir.',
   'ref'        => 'Kayıt numaranız',
   'kategori_e' => 'Kayıt kategorisi',
   'kurum'      => 'Kurum',
   'bildiri'    => 'Bildiri numarası',
   'odeme_yok'  => 'Kayıt ücretleri henüz kesinleşmemiştir. Ücretler ve ödeme adımı duyurulduğunda bu e-posta adresine bilgi verilecektir.',
   'odeme_var'  => 'Ödemenizi tamamlamak için: {url}',
   'iletisim'   => 'Sorularınız için: siu2027@medipol.edu.tr',
 ],
 'en' => [
   'yontem'     => 'Invalid request method.',
   'oturum'     => 'Session validation failed. Please refresh the page and try again.',
   'hiz'        => 'Too many attempts. Please try again in an hour.',
   'zorunlu'    => 'This field is required.',
   'eposta'     => 'Please enter a valid e-mail address.',
   'kategori'   => 'Please choose a registration category.',
   'kvkk'       => 'You must accept the privacy notice to continue.',
   'vergi'      => 'Invoice title, tax office and tax number are required for a corporate invoice.',
   'sunucu'     => 'Something went wrong. Please write to siu2027@medipol.edu.tr.',
   'basarili'   => 'Your pre-registration has been received.',
   'eposta_konu'=> 'SIU 2027 pre-registration confirmation',
   'selam'      => 'Dear',
   'giris'      => 'Your IEEE SIU 2027 pre-registration request has been received. This message is not a payment receipt.',
   'ref'        => 'Your registration number',
   'kategori_e' => 'Registration category',
   'kurum'      => 'Institution',
   'bildiri'    => 'Paper number',
   'odeme_yok'  => 'Registration fees have not been finalised yet. You will be notified at this address once the fees and the payment step are announced.',
   'odeme_var'  => 'To complete your payment: {url}',
   'iletisim'   => 'Questions: siu2027@medipol.edu.tr',
 ],
][$dil];

$KATEGORILER = [
  'tam'            => ['tr' => 'Tam Kayıt (Akademisyen / Sektör)', 'en' => 'Full Registration (Academic / Industry)'],
  'ogrenci_yazar'  => ['tr' => 'Öğrenci Yazar Kaydı',             'en' => 'Student Author Registration'],
  'lisansustu'     => ['tr' => 'Lisansüstü Dinleyici Kaydı',      'en' => 'Graduate Listener Registration'],
  'lisans'         => ['tr' => 'Lisans Dinleyici Kaydı',          'en' => 'Undergraduate Listener Registration'],
];

function siu_cikti(bool $ok, array $veri, bool $xhr, string $dil): void {
    if ($xhr) {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code($ok ? 200 : 422);
        echo json_encode(array_merge(['ok' => $ok], $veri), JSON_UNESCAPED_UNICODE);
        exit;
    }
    // JavaScript kapalıyken: sonucu sunucu tarafında, sitenin tasarımıyla göster.
    $e = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
    $tr = $dil !== 'en';
    $baslik = $ok ? ($tr ? 'Ön kaydınız alındı' : 'Pre-registration received')
                  : ($tr ? 'Kayıt tamamlanamadı' : 'Registration could not be completed');
    $geri   = $tr ? 'Kayıt sayfasına dön' : 'Back to the registration page';
    $refEt  = $tr ? 'Kayıt numaranız' : 'Your registration number';
    http_response_code($ok ? 200 : 422);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="' . ($tr ? 'tr' : 'en') . '"><head><meta charset="UTF-8">'
       . '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
       . '<meta name="robots" content="noindex">'
       . '<title>' . $e($baslik) . ' | IEEE SİU 2027</title>'
       . '<link rel="stylesheet" href="../css/style.css"><link rel="icon" type="image/png" href="../assets/favicon.png">'
       . '</head><body><main id="icerik" class="wrap body-grid body-grid--single"><div class="col-main">'
       . '<section class="section section--unnumbered"><div class="section__head"><h1>' . $e($baslik) . '</h1></div>'
       . '<div class="section__body prose">';
    if ($ok) {
        echo '<p class="lede">' . $e($veri['mesaj'] ?? '') . '</p>'
           . '<dl class="facts"><div><dt>' . $e($refEt) . '</dt><dd><span class="facts__val">'
           . $e($veri['ref'] ?? '') . '</span></dd></div></dl>';
    } else {
        echo '<p class="lede">' . $e($veri['hata'] ?? '') . '</p>';
        if (!empty($veri['alanlar']) && is_array($veri['alanlar'])) {
            echo '<ul>';
            foreach ($veri['alanlar'] as $msg) echo '<li>' . $e($msg) . '</li>';
            echo '</ul>';
        }
    }
    echo '<p><a class="btn" href="../kayit.html">' . $e($geri) . '</a></p>'
       . '</div></section></div></main></body></html>';
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') siu_cikti(false, ['hata' => $M['yontem']], $xhr, $dil);
if (!siu_csrf_dogrula($_POST['csrf'] ?? null))      siu_cikti(false, ['hata' => $M['oturum']], $xhr, $dil);
if (($_POST['website'] ?? '') !== '')               siu_cikti(true,  ['ref' => 'SIU27-000000'], $xhr, $dil); // bal küpü

try {
    $pdo = siu_db($cfg);
} catch (Throwable $e) {
    error_log('SIU2027 db: ' . $e->getMessage());
    siu_cikti(false, ['hata' => $M['sunucu']], $xhr, $dil);
}
if (!siu_hiz_siniri($pdo, $cfg)) siu_cikti(false, ['hata' => $M['hiz']], $xhr, $dil);

$ad     = siu_temizle($_POST['ad_soyad'] ?? '', 120);
$eposta = siu_temizle($_POST['eposta'] ?? '', 160);
$kurum  = siu_temizle($_POST['kurum'] ?? '', 160);
$unvan  = siu_temizle($_POST['unvan'] ?? '', 80);
$kat    = siu_temizle($_POST['kategori'] ?? '', 40);
$bildiri= siu_temizle($_POST['bildiri_no'] ?? '', 40);
$fatura = (($_POST['fatura_tipi'] ?? 'bireysel') === 'kurumsal') ? 'kurumsal' : 'bireysel';
$fUnvan = siu_temizle($_POST['fatura_unvan'] ?? '', 200);
$vd     = siu_temizle($_POST['vergi_dairesi'] ?? '', 120);
$vno    = siu_temizle($_POST['vergi_no'] ?? '', 20);
$not    = siu_cok_satir($_POST['not_metni'] ?? '', 1500);
$kvkk   = !empty($_POST['kvkk_onay']);

$hatalar = [];
if ($ad === '')    $hatalar['ad_soyad'] = $M['zorunlu'];
if ($kurum === '') $hatalar['kurum']    = $M['zorunlu'];
if (!filter_var($eposta, FILTER_VALIDATE_EMAIL)) $hatalar['eposta'] = $M['eposta'];
if (!isset($KATEGORILER[$kat])) $hatalar['kategori'] = $M['kategori'];
if (!$kvkk) $hatalar['kvkk_onay'] = $M['kvkk'];
if ($fatura === 'kurumsal' && ($fUnvan === '' || $vd === '' || $vno === '')) $hatalar['fatura'] = $M['vergi'];
if ($hatalar) siu_cikti(false, ['hata' => $M['zorunlu'], 'alanlar' => $hatalar], $xhr, $dil);

try {
    $ref = siu_ref($pdo);
    $pdo->prepare(
        'INSERT INTO kayit (ref, ad_soyad, eposta, kurum, unvan, kategori, bildiri_no,
             fatura_tipi, fatura_unvan, vergi_dairesi, vergi_no, not_metni, kvkk_onay, durum, dil, ip_hash, olusturma)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )->execute([$ref, $ad, $eposta, $kurum, $unvan, $kat, $bildiri,
        $fatura, $fUnvan, $vd, $vno, $not, 1, 'on_kayit', $dil, siu_ip_hash($cfg), gmdate('c')]);
} catch (Throwable $e) {
    error_log('SIU2027 insert: ' . $e->getMessage());
    siu_cikti(false, ['hata' => $M['sunucu']], $xhr, $dil);
}

$katEtiket = $KATEGORILER[$kat][$dil];
siu_mail($cfg, $eposta, $M['eposta_konu'] . ' — ' . $ref, siu_katilimci_metni(
    ['ref' => $ref, 'ad_soyad' => $ad, 'kurum' => $kurum, 'bildiri_no' => $bildiri, 'kategori_etiket' => $katEtiket],
    $cfg,
    ['selam' => $M['selam'], 'giris' => $M['giris'], 'ref' => $M['ref'], 'kategori' => $M['kategori_e'],
     'kurum' => $M['kurum'], 'bildiri' => $M['bildiri'], 'odeme_yok' => $M['odeme_yok'],
     'odeme_var' => $M['odeme_var'], 'iletisim' => $M['iletisim']]
));

siu_mail($cfg, $cfg['mail']['secretariat'], '[SİU 2027] Yeni ön kayıt: ' . $ref, implode("\n", [
    'Kayıt no : ' . $ref, 'Ad Soyad : ' . $ad, 'E-posta  : ' . $eposta, 'Kurum    : ' . $kurum,
    'Unvan    : ' . $unvan, 'Kategori : ' . $katEtiket, 'Bildiri  : ' . $bildiri,
    'Fatura   : ' . $fatura . ($fatura === 'kurumsal' ? " ($fUnvan / $vd / $vno)" : ''),
    'Not      : ' . $not, 'Tarih    : ' . gmdate('c'),
]));

siu_cikti(true, ['ref' => $ref, 'mesaj' => $M['basarili']], $xhr, $dil);
