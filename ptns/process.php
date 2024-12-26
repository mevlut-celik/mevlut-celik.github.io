<?php
// Formun POST yöntemiyle gönderildiğinden emin olun
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    // Formdan gelen verileri al
    $yas = isset($_POST['yas']) ? htmlspecialchars($_POST['yas']) : 'Belirtilmedi';
    $cinsiyet = isset($_POST['cinsiyet']) ? htmlspecialchars($_POST['cinsiyet']) : 'Belirtilmedi';
    $egitim_duzeyi = isset($_POST['egitim_duzeyi']) ? htmlspecialchars($_POST['egitim_duzeyi']) : 'Belirtilmedi';

    // Verileri ekrana yazdır (test amaçlı)
    echo "<h2>Gönderilen Form Verileri:</h2>";
    echo "Yaş: " . $yas . "<br>";
    echo "Cinsiyet: " . $cinsiyet . "<br>";
    echo "Eğitim Düzeyi: " . $egitim_duzeyi . "<br>";

    // Burada veritabanına kaydetme veya başka işlemler yapılabilir
} else {
    // Eğer POST yöntemi kullanılmadıysa hata mesajı göster
    echo "Form verileri gönderilmedi.";
}
?>
