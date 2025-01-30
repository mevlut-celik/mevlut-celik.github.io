function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    'status': 'success',
    'message': 'GET request received'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  // Belirli bir spreadsheet'i ID ile aç
  var spreadsheet = SpreadsheetApp.openById('1VNSvtoRdEM05KB-4ZJ0JBgrfjClUYshFpf9AxfpZwug');
  var sheet = spreadsheet.getActiveSheet();
  
  try {
    // Gelen veriyi logla
    Logger.log('Raw request: ' + JSON.stringify(e));
    Logger.log('Parameters: ' + JSON.stringify(e.parameter));
    
    // Form verilerini al
    var formData = {
      timestamp: e.parameter.timestamp || new Date().toLocaleString('tr-TR'),
      age: e.parameter.age || '',
      gender: e.parameter.gender || '',
      city: e.parameter.city || '',
      district: e.parameter.district || '',
      educationLevel: e.parameter.educationLevel || '',
      graduateEducation: e.parameter.graduateEducation || '',
      department: e.parameter.department || '',
      experience: e.parameter.experience || '',
      schoolType: e.parameter.schoolType || '',
      classLevels: e.parameter.classLevels || '',
      trainingExperience: e.parameter.trainingExperience || ''
    };
    
    // Seçimleri parse et
    var selections = [];
    if (e.parameter.selections) {
      try {
        selections = JSON.parse(e.parameter.selections);
      } catch (parseError) {
        Logger.log('Seçimler parse edilemedi: ' + parseError);
      }
    }
    
    // En az bir satır ekle
    if (selections && selections.length > 0) {
      selections.forEach(function(selection) {
        sheet.appendRow([
          formData.timestamp,
          formData.age,
          formData.gender,
          formData.city,
          formData.district,
          formData.educationLevel,
          formData.graduateEducation,
          formData.department,
          formData.experience,
          formData.schoolType,
          formData.classLevels,
          formData.trainingExperience,
          selection.sentence || '',
          selection.explanation || '',
          selection.actions || ''
        ]);
      });
    } else {
      sheet.appendRow([
        formData.timestamp,
        formData.age,
        formData.gender,
        formData.city,
        formData.district,
        formData.educationLevel,
        formData.graduateEducation,
        formData.department,
        formData.experience,
        formData.schoolType,
        formData.classLevels,
        formData.trainingExperience,
        '',
        '',
        ''
      ]);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      'success': true,
      'message': 'Veri başarıyla kaydedildi'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    Logger.log('Hata: ' + error);
    return ContentService.createTextOutput(JSON.stringify({
      'success': false,
      'message': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
} 