function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = e.parameter;
  
  try {
    // Form1 verilerini al
    var timestamp = data.timestamp || new Date().toLocaleString('tr-TR');
    var age = data.age || '';
    var gender = data.gender || '';
    var city = data.city || '';
    var district = data.district || '';
    var educationLevel = data.educationLevel || '';
    var graduateEducation = data.graduateEducation || '';
    var department = data.department || '';
    var experience = data.experience || '';
    var schoolType = data.schoolType || '';
    var classLevels = data.classLevels || '';
    var trainingExperience = data.trainingExperience || '';
    
    // Seçimleri parse et
    var selections = JSON.parse(data.selections || '[]');
    
    // Her seçim için yeni bir satır ekle
    selections.forEach(function(selection) {
      sheet.appendRow([
        timestamp,
        age,
        gender,
        city,
        district,
        educationLevel,
        graduateEducation,
        department,
        experience,
        schoolType,
        classLevels,
        trainingExperience,
        selection.sentence,
        selection.explanation,
        selection.actions
      ]);
    });
    
    return ContentService.createTextOutput(JSON.stringify({
      'success': true,
      'message': 'Veri başarıyla kaydedildi'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({
      'success': false,
      'message': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
} 