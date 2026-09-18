<?php
declare(strict_types=1);
require __DIR__ . '/lib/guard.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode(['csrf' => siu_csrf_token()]);
