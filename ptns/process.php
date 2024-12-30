<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $file_path = "data_collection.txt"; // Verilerin kaydedileceği dosya
    $data = "";

    // Zaman damgası ve IP adresi
    $ip_address = $_SERVER['REMOTE_ADDR'];
    $timestamp = date('Y-m-d H:i:s');
    $data .= "Timestamp: $timestamp\n";
    $data .= "IP Address: $ip_address\n";

    // `index.html` verilerini alma
    $data .= "Yaş: " . ($_POST['age'] ?? 'Bilinmiyor') . "\n";
    $data .= "Cinsiyet: " . ($_POST['gender'] ?? 'Bilinmiyor') . "\n";
    $data .= "Şehir: " . ($_POST['city'] ?? 'Bilinmiyor') . "\n";
    $data .= "İlçe: " . ($_POST['district'] ?? 'Bilinmiyor') . "\n";
    $data .= "Eğitim Düzeyi: " . ($_POST['educationLevel'] ?? 'Bilinmiyor') . "\n";
    $data .= "Lisansüstü Eğitim: " . ($_POST['graduateEducation'] ?? 'Bilinmiyor') . "\n";
    $data .= "Mezun Olunan Fakülte: " . ($_POST['department'] ?? 'Bilinmiyor') . "\n";
    $data .= "Mesleki Deneyim: " . ($_POST['experience'] ?? 'Bilinmiyor') . " yıl\n";
    $data .= "Okul Türü: " . ($_POST['schoolType'] ?? 'Bilinmiyor') . "\n";

    // Sınıf düzeylerini birleştir
    if (isset($_POST['classLevels']) && is_array($_POST['classLevels'])) {
        $classLevels = implode(", ", $_POST['classLevels']);
        $data .= "Ders Verilen Sınıf Düzeyleri: $classLevels\n";
    } else {
        $data .= "Ders Verilen Sınıf Düzeyleri: Bilinmiyor\n";
    }

    $data .= "Hizmet İçi Eğitim Deneyimi: " . ($_POST['trainingExperience'] ?? 'Bilinmiyor') . "\n";

    // `survey.html` verilerini alma
    foreach ($_POST as $key => $value) {
        if (strpos($key, 'sentence') !== false) {
            $index = str_replace('sentence', '', $key);
            $explanationKey = 'explanation' . $index;
            $actionsKey = 'actions' . $index;

            $data .= "\nSeçilen Cümle: " . $value . "\n";
            $data .= "Açıklama: " . ($_POST[$explanationKey] ?? 'Yok') . "\n";
            $data .= "Yapılacaklar: " . ($_POST[$actionsKey] ?? 'Yok') . "\n";
        }
    }

    $data .= "------------------------------------\n";

    // Dosyaya yazma işlemi
    if (file_put_contents($file_path, $data, FILE_APPEND)) {
        echo "Cevaplarınız başarıyla kaydedildi. Zaman ayırdığınız için teşekkür ederiz.";
    } else {
        echo "Bir hata oluştu. Lütfen tekrar deneyin.";
    }
}
?>