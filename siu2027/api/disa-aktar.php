<?php
/**
 * Kayıtları CSV olarak indirir (Excel uyumlu: UTF-8 BOM + noktalı virgül).
 * Kullanım:  /api/disa-aktar.php?token=<config.php içindeki export_token>
 * Not: KVKK gereği bu bağlantı yalnızca Kurultay Sekreterliği ile paylaşılmalıdır.
 */
declare(strict_types=1);
$cfg = require __DIR__ . '/config.php';
require __DIR__ . '/lib/db.php';

$token = (string)($_GET['token'] ?? '');
if ($token === '' || !hash_equals((string)$cfg['export_token'], $token)) {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Yetkisiz istek.\n");
}

$pdo = siu_db($cfg);
$satirlar = $pdo->query(
    'SELECT ref, olusturma, ad_soyad, eposta, kurum, unvan, kategori, bildiri_no,
            fatura_tipi, fatura_unvan, vergi_dairesi, vergi_no, durum, dil, not_metni
     FROM kayit ORDER BY id DESC'
)->fetchAll();

header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="siu2027-kayitlar-' . gmdate('Ymd-Hi') . '.csv"');
header('Cache-Control: no-store');

$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF");                       // Excel'in UTF-8'i tanıması için BOM
fputcsv($out, ['Kayıt No','Tarih (UTC)','Ad Soyad','E-posta','Kurum','Unvan','Kategori',
               'Bildiri No','Fatura Tipi','Fatura Unvanı','Vergi Dairesi','Vergi No',
               'Durum','Dil','Not'], ';', '"', '\\');
foreach ($satirlar as $s) fputcsv($out, array_values($s), ';', '"', '\\');
fclose($out);
