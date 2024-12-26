<?php
// Veritabanı bağlantısı
$servername = "localhost";
$username = "root"; // Veritabanı kullanıcı adı
$password = ""; // Veritabanı şifresi
$dbname = "birlesik_form"; // Veritabanı adı

// Bağlantıyı oluştur
$conn = new mysqli($servername, $username, $password, $dbname);

// Bağlantıyı kontrol et
if ($conn->connect_error) {
    die("Veritabanı bağlantısı başarısız: " . $conn->connect_error);
}

// Formdan gelen verileri al
$yas = $_POST['age'] ?? '';
$cinsiyet = $_POST['gender'] ?? '';
$il = $_POST['province'] ?? '';
$ilce = $_POST['city'] ?? '';
$egitim_duzeyi = $_POST['educationLevel'] ?? '';
$lisansustu = $_POST['graduateEducation'] ?? '';
$mezun_bolum = $_POST['department'] ?? '';
$deneyim = $_POST['experience'] ?? '';
$okul_tipi = $_POST['schoolType'] ?? '';
$seviye = $_POST['classLevels'] ?? '';
$meslek_ici = $_POST['trainingExperience'] ?? '';
$diyaloglar = isset($_POST['detailsForm']) ? implode(", ", $_POST['diyalog']) : '';

// Veriyi veritabanına ekle
$sql = "INSERT INTO katilimci_diyalog (yas, cinsiyet, egitim_duzeyi, mezun_bolum, diyaloglar)
        VALUES ('$yas', '$cinsiyet',  '$il', '$ilce', '$egitim_duzeyi', '$mezun_bolum', '$deneyim' '$okul_tipi', '$seviye',  '$meslek_ici' '$diyaloglar')";

if ($conn->query($sql) === TRUE) {
    echo "Veriler başarıyla kaydedildi!";
} else {
    echo "Hata: " . $sql . "<br>" . $conn->error;
}

// Bağlantıyı kapat
$conn->close();
?>
