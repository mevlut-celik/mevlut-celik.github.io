<?php
declare(strict_types=1);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  header('Content-Type: text/plain; charset=UTF-8');
  echo 'Method Not Allowed';
  exit;
}

// Bot honeypot
$website = isset($_POST['website']) ? trim((string)$_POST['website']) : '';
if ($website !== '') {
  header('Location: ./success.html');
  exit;
}

function valid_email(string $value): bool {
  return (bool) filter_var($value, FILTER_VALIDATE_EMAIL);
}

function esc(string $value): string {
  return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

// Mail config fallback
$MAIL_TO_ENV = getenv('MAIL_TO') ?: '';
$mailCandidates = array_filter(array_map('trim', explode(',', $MAIL_TO_ENV)));
$validRecipients = array_values(array_filter($mailCandidates, 'valid_email'));
$MAIL_TO = count($validRecipients) > 0
  ? implode(',', $validRecipients)
  : 'parlar-w@parlar.org.tr,mevlutc@freshdatatechnology.com';

$MAIL_FROM = getenv('MAIL_FROM') ?: '';
if (!valid_email($MAIL_FROM)) {
  $serverName = $_SERVER['SERVER_NAME'] ?? 'localhost';
  $MAIL_FROM = 'no-reply@' . preg_replace('/:\d+$/', '', (string)$serverName);
}

// Form fields
$fullName = trim((string)($_POST['fullName'] ?? ''));
$email = trim((string)($_POST['email'] ?? ''));
$phone = trim((string)($_POST['phone'] ?? ''));
$linkedin = trim((string)($_POST['linkedin'] ?? ''));
$experienceYears = trim((string)($_POST['experienceYears'] ?? ''));
$coverLetter = trim((string)($_POST['coverLetter'] ?? ''));
$kvkkConsent = isset($_POST['kvkkConsent']) ? (string)$_POST['kvkkConsent'] : '';

if (
  $fullName === '' ||
  $email === '' ||
  $phone === '' ||
  $experienceYears === '' ||
  $coverLetter === '' ||
  $kvkkConsent === ''
) {
  http_response_code(400);
  header('Content-Type: text/html; charset=UTF-8');
  echo '<p>Zorunlu alanlar eksik. Lütfen geri dönüp formu tamamlayın.</p>';
  exit;
}

if (!valid_email($email)) {
  http_response_code(400);
  header('Content-Type: text/html; charset=UTF-8');
  echo '<p>Geçersiz e-posta adresi.</p>';
  exit;
}

if (!isset($_FILES['cv']) || !is_array($_FILES['cv']) || $_FILES['cv']['error'] !== UPLOAD_ERR_OK) {
  http_response_code(400);
  header('Content-Type: text/html; charset=UTF-8');
  echo '<p>CV dosyası yüklenemedi.</p>';
  exit;
}

$maxSize = 10 * 1024 * 1024; // 10MB
if ((int)$_FILES['cv']['size'] > $maxSize) {
  http_response_code(400);
  header('Content-Type: text/html; charset=UTF-8');
  echo '<p>CV dosyası 10MB üzerinde olamaz.</p>';
  exit;
}

$allowedMime = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

$tmpPath = (string)$_FILES['cv']['tmp_name'];
$mime = mime_content_type($tmpPath);
if (!$mime) {
  $mime = (string)($_FILES['cv']['type'] ?? '');
}

if (!in_array($mime, $allowedMime, true)) {
  http_response_code(400);
  header('Content-Type: text/html; charset=UTF-8');
  echo '<p>CV dosya tipi geçersiz. Yalnızca PDF, DOC, DOCX kabul edilir.</p>';
  exit;
}

$subject = '=?UTF-8?B?' . base64_encode('[Basvuru] ' . $fullName . ' - Kaynak Geliştirme ve İş Birlikleri Direktörü') . '?=';
$boundary = '==Multipart_Boundary_x' . md5((string)microtime()) . 'x';

$headers = '';
$headers .= 'From: ' . $MAIL_FROM . "\r\n";
$headers .= 'Reply-To: ' . $email . "\r\n";
$headers .= 'MIME-Version: 1.0' . "\r\n";
$headers .= 'Content-Type: multipart/mixed; boundary="' . $boundary . '"' . "\r\n";

$html = '';
$html .= '<h2>Yeni Başvuru Alındı</h2>';
$html .= '<p><strong>Pozisyon:</strong> Kaynak Geliştirme ve İş Birlikleri Direktörü</p>';
$html .= '<p><strong>Ad Soyad:</strong> ' . esc($fullName) . '</p>';
$html .= '<p><strong>E-posta:</strong> ' . esc($email) . '</p>';
$html .= '<p><strong>Telefon:</strong> ' . esc($phone) . '</p>';
$html .= '<p><strong>LinkedIn:</strong> ' . esc($linkedin !== '' ? $linkedin : '-') . '</p>';
$html .= '<p><strong>Deneyim (yıl):</strong> ' . esc($experienceYears) . '</p>';
$html .= '<p><strong>KVKK Onayı:</strong> Verildi</p>';
$html .= '<h3>Niyet Mektubu</h3>';
$html .= '<p>' . nl2br(esc($coverLetter)) . '</p>';

$message = '';
$message .= 'This is a multi-part message in MIME format.' . "\r\n\r\n";
$message .= '--' . $boundary . "\r\n";
$message .= 'Content-Type: text/html; charset="UTF-8"' . "\r\n";
$message .= 'Content-Transfer-Encoding: 7bit' . "\r\n\r\n";
$message .= $html . "\r\n\r\n";

$filename = basename((string)$_FILES['cv']['name']);
$fileData = file_get_contents($tmpPath);
if ($fileData === false) {
  http_response_code(500);
  header('Content-Type: text/html; charset=UTF-8');
  echo '<p>CV dosyası okunamadı.</p>';
  exit;
}

$message .= '--' . $boundary . "\r\n";
$message .= 'Content-Type: ' . $mime . '; name="' . addslashes($filename) . '"' . "\r\n";
$message .= 'Content-Transfer-Encoding: base64' . "\r\n";
$message .= 'Content-Disposition: attachment; filename="' . addslashes($filename) . '"' . "\r\n\r\n";
$message .= chunk_split(base64_encode($fileData)) . "\r\n\r\n";
$message .= '--' . $boundary . '--';

$mailSent = @mail($MAIL_TO, $subject, $message, $headers);

if (!$mailSent) {
  // Last-resort fallback: store application as JSON lines
  $fallbackPath = __DIR__ . '/applications.ndjson';
  $row = [
    'createdAt' => date('c'),
    'fullName' => $fullName,
    'email' => $email,
    'phone' => $phone,
    'linkedin' => $linkedin,
    'experienceYears' => $experienceYears,
    'coverLetter' => $coverLetter,
    'kvkkConsent' => $kvkkConsent,
    'cvOriginalName' => $filename
  ];
  @file_put_contents($fallbackPath, json_encode($row, JSON_UNESCAPED_UNICODE) . PHP_EOL, FILE_APPEND | LOCK_EX);
}

header('Location: ./success.html');
exit;
