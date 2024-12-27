<?php
// Veritabanı bağlantısı
$host = "localhost";
$dbname = "form_data";
$username = "root";
$password = "";

try {
    $conn = new PDO("mysql:host=$host;dbname=$dbname", $username, $password);
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        // İlk form verileri
        $age = $_POST['age'];
        $province = $_POST['province'];
        $city = $_POST['city'];
        $gender = $_POST['gender'];
        $educationLevel = $_POST['educationLevel'];
        $graduateEducation = $_POST['graduateEducation'];
        $department = $_POST['department'];
        $experience = $_POST['experience'];
        $schoolType = $_POST['schoolType'];
        $classLevels = $_POST['classLevels'];
        $trainingExperience = $_POST['trainingExperience'];

        // Survey formundaki seçilen cümleler
        $selectedSentences = isset($_POST['selectedSentences']) ? json_decode($_POST['selectedSentences'], true) : [];

        // Veritabanına kaydet
        $stmt = $conn->prepare("
            INSERT INTO form_responses
            (age, province, city, gender, education_level, graduate_education, department, experience, school_type, class_levels, training_experience, selected_sentences)
            VALUES (:age, :province, :city, :gender, :educationLevel, :graduateEducation, :department, :experience, :schoolType, :classLevels, :trainingExperience, :selectedSentences)
        ");

        $stmt->bindParam(':age', $age);
        $stmt->bindParam(':province', $province);
        $stmt->bindParam(':city', $city);
        $stmt->bindParam(':gender', $gender);
        $stmt->bindParam(':educationLevel', $educationLevel);
        $stmt->bindParam(':graduateEducation', $graduateEducation);
        $stmt->bindParam(':department', $department);
        $stmt->bindParam(':experience', $experience);
        $stmt->bindParam(':schoolType', $schoolType);
        $stmt->bindParam(':classLevels', $classLevels);
        $stmt->bindParam(':trainingExperience', $trainingExperience);
        $stmt->bindParam(':selectedSentences', json_encode($selectedSentences)); // JSON olarak kaydet

        $stmt->execute();

        echo "Veriler başarıyla kaydedildi!";
    }
} catch (PDOException $e) {
    echo "Veritabanı Hatası: " . $e->getMessage();
}
?>