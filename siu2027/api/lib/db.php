<?php
/** Veritabanı: SQLite (varsayılan) ya da MySQL. Şema ilk çağrıda kurulur. */

function siu_db(array $cfg): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    $d = $cfg['db'];
    if ($d['driver'] === 'mysql') {
        $m = $d['mysql'];
        $dsn = "mysql:host={$m['host']};dbname={$m['name']};charset={$m['charset']}";
        $pdo = new PDO($dsn, $m['user'], $m['pass']);
    } else {
        $path = $d['sqlite_path'];
        $dir = dirname($path);
        if (!is_dir($dir)) mkdir($dir, 0775, true);
        $pdo = new PDO('sqlite:' . $path);
        $pdo->exec('PRAGMA journal_mode = WAL');
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $sql = file_get_contents(__DIR__ . '/../sema.sql');
    if ($d['driver'] === 'mysql') {
        // SQLite'a özgü ifadeleri MySQL karşılıklarına çevir
        $sql = str_replace('INTEGER PRIMARY KEY AUTOINCREMENT', 'INT AUTO_INCREMENT PRIMARY KEY', $sql);
        $sql = preg_replace('/CREATE INDEX IF NOT EXISTS[^;]+;/', '', $sql);
        $sql = str_replace('TEXT    NOT NULL UNIQUE', 'VARCHAR(32) NOT NULL UNIQUE', $sql);
    }
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
        try { $pdo->exec($stmt); } catch (PDOException $e) { /* var olan indeks vb. */ }
    }
    return $pdo;
}

/** Çakışmayan, okunabilir kayıt numarası: SIU27-A7K3QD */
function siu_ref(PDO $pdo): string {
    $alfabe = 'ACDEFGHJKLMNPQRTUVWXY3479';   // karışabilen 0/O/1/I/S/5/2/Z yok
    for ($deneme = 0; $deneme < 12; $deneme++) {
        $s = '';
        for ($i = 0; $i < 6; $i++) $s .= $alfabe[random_int(0, strlen($alfabe) - 1)];
        $ref = 'SIU27-' . $s;
        $q = $pdo->prepare('SELECT 1 FROM kayit WHERE ref = ?');
        $q->execute([$ref]);
        if (!$q->fetchColumn()) return $ref;
    }
    throw new RuntimeException('Kayıt numarası üretilemedi');
}
