<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

try {
    // POST verilerinin boş olup olmadığını kontrol et
    if (empty($_POST)) {
        throw new Exception('Form verileri alınamadı');
    }

    // Zaman damgası ve IP adresi
    $ip_address = $_SERVER['REMOTE_ADDR'];
    $timestamp = date('Y-m-d H:i:s');
    
    // Gelen form verilerini al
    $formData = [
        'timestamp' => $timestamp,
        'ip_address' => $ip_address,
        'age' => $_POST['age'] ?? '',
        'city' => $_POST['city'] ?? '',
        'district' => $_POST['district'] ?? '',
        'gender' => $_POST['gender'] ?? '',
        'educationLevel' => $_POST['educationLevel'] ?? '',
        'graduateEducation' => $_POST['graduateEducation'] ?? '',
        'department' => $_POST['department'] ?? '',
        'experience' => $_POST['experience'] ?? '',
        'schoolType' => $_POST['schoolType'] ?? '',
        'classLevels' => $_POST['classLevels'] ?? '',
        'trainingExperience' => $_POST['trainingExperience'] ?? ''
    ];

    // Verileri dosyaya kaydet
    $logFile = 'form_submissions.txt';
    $logEntry = json_encode($formData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n---\n";
    
    if (!file_put_contents($logFile, $logEntry, FILE_APPEND)) {
        throw new Exception('Veri kaydedilemedi');
    }

    echo json_encode(['success' => true]);

} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>