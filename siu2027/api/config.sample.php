<?php
/**
 * SİU 2027 — kayıt servisi yapılandırması.
 * Bu dosyayı config.php adıyla kopyalayıp doldurun. config.php sunucuya yüklenir,
 * sürüm kontrolüne GİRMEZ (içinde e-posta/veritabanı bilgileri vardır).
 */
return [
    // 'sqlite' paylaşımlı hostingde hiçbir kurulum istemez; 'mysql' üniversite BT verirse.
    'db' => [
        'driver' => 'sqlite',
        'sqlite_path' => __DIR__ . '/../data/kayit.sqlite',
        'mysql' => [
            'host' => 'localhost', 'name' => 'siu2027', 'user' => '', 'pass' => '', 'charset' => 'utf8mb4',
        ],
    ],

    // Bildirim e-postaları. SMTP yoksa PHP mail() kullanılır (paylaşımlı hostingde genelde çalışır).
    'mail' => [
        'from'        => 'siu2027@medipol.edu.tr',
        'from_name'   => 'IEEE SİU 2027 Kurultay Sekreterliği',
        'secretariat' => 'siu-kayit@medipol.edu.tr',
        'bcc'         => '',
        'enabled'     => true,
    ],

    'site' => [
        'url'   => 'https://siu2027.medipol.edu.tr',
        'title' => 'IEEE SİU 2027',
    ],

    // CSV dışa aktarım için gizli anahtar. Uzun ve rastgele olmalı.
    'export_token' => 'DEGISTIRIN-uzun-rastgele-bir-dize',

    // Aynı IP'den saatte en fazla kaç kayıt denemesi
    'rate_limit_per_hour' => 8,

    /**
     * Ödeme sağlayıcısı. Şu an 'none': kayıt alınır, ödeme adımı
     * "duyurulacaktır" olarak gösterilir. Üniversite döner sermaye tahsilat
     * bağlantısı netleştiğinde 'doner_sermaye' yapıp url'yi girin; kayıt
     * numarası ?ref= parametresiyle eklenir.
     */
    'payment' => [
        'mode' => 'none',           // none | doner_sermaye
        'url'  => '',               // örn. https://odeme.medipol.edu.tr/siu2027
    ],
];
