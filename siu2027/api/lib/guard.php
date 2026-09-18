<?php
/** CSRF, bal küpü, hız sınırı ve girdi temizliği. */

function siu_session_start(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_set_cookie_params([
            'lifetime' => 0, 'path' => '/', 'httponly' => true,
            'samesite' => 'Lax',
            'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        ]);
        session_start();
    }
}

function siu_csrf_token(): string {
    siu_session_start();
    if (empty($_SESSION['siu_csrf'])) $_SESSION['siu_csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['siu_csrf'];
}

function siu_csrf_dogrula(?string $gelen): bool {
    siu_session_start();
    return !empty($_SESSION['siu_csrf']) && is_string($gelen)
        && hash_equals($_SESSION['siu_csrf'], $gelen);
}

/** IP'yi saklamıyoruz; yalnızca tuzlanmış özetini (KVKK: veri minimizasyonu). */
function siu_ip_hash(array $cfg): string {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return substr(hash_hmac('sha256', $ip, (string)($cfg['export_token'] ?? 'tuz')), 0, 32);
}

function siu_hiz_siniri(PDO $pdo, array $cfg): bool {
    $limit = (int)($cfg['rate_limit_per_hour'] ?? 8);
    $hash = siu_ip_hash($cfg);
    $sinir = gmdate('c', time() - 3600);
    $q = $pdo->prepare('SELECT COUNT(*) FROM istek_gunlugu WHERE ip_hash = ? AND olusturma > ?');
    $q->execute([$hash, $sinir]);
    if ((int)$q->fetchColumn() >= $limit) return false;
    $pdo->prepare('INSERT INTO istek_gunlugu (ip_hash, olusturma) VALUES (?, ?)')
        ->execute([$hash, gmdate('c')]);
    $pdo->prepare('DELETE FROM istek_gunlugu WHERE olusturma < ?')
        ->execute([gmdate('c', time() - 86400)]);
    return true;
}

function siu_temizle(?string $v, int $max = 300): string {
    $v = trim((string)$v);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v);   // kontrol karakterleri
    $v = preg_replace('/\s+/u', ' ', $v);
    return mb_substr($v, 0, $max);
}

function siu_cok_satir(?string $v, int $max = 2000): string {
    $v = trim((string)$v);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v);
    return mb_substr($v, 0, $max);
}
