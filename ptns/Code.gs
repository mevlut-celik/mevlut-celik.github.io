function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = e.parameter;
  
  try {
    // Form1 verilerini parse et
    var form1Data = JSON.parse(data.form1Data || '{}');
    
    // Seçimleri parse et
    var selections = JSON.parse(data.selections || '[]');
    
    // Her seçim için yeni bir satır ekle
    selections.forEach(function(selection) {
      sheet.appendRow([
        new Date(),
        // Form1 verileri
        form1Data.age || '',
        form1Data.gender || '',
        form1Data.city || '',
        form1Data.district || '',
        form1Data.educationLevel || '',
        form1Data.graduateEducation || '',
        form1Data.department || '',
        form1Data.experience || '',
        form1Data.schoolType || '',
        form1Data.classLevels || '',
        form1Data.trainingExperience || '',
        // Survey verileri
        selection.sentence || '',
        selection.explanation || '',
        selection.actions || ''
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