function doGet(e) {
  if (e.parameter.action === 'getResponses') {
    var spreadsheet = SpreadsheetApp.openById('1VNSvtoRdEM05KB-4ZJ0JBgrfjClUYshFpf9AxfpZwug');
    var sheet = spreadsheet.getActiveSheet();
    var data = sheet.getDataRange().getValues();
    
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({
    'status': 'success',
    'message': 'GET request received'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    // Debug için tüm gelen veriyi logla
    Logger.log('Gelen istek: ' + JSON.stringify(e));
    Logger.log('Parametreler: ' + JSON.stringify(e.parameter));
    
    // Spreadsheet'e erişim kontrolü
    var spreadsheet = SpreadsheetApp.openById('1VNSvtoRdEM05KB-4ZJ0JBgrfjClUYshFpf9AxfpZwug');
    Logger.log('Spreadsheet açıldı: ' + spreadsheet.getName());
    
    var sheet = spreadsheet.getActiveSheet();
    Logger.log('Aktif sayfa: ' + sheet.getName());
    
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
    
    Logger.log('Form verileri: ' + JSON.stringify(formData));
    
    // Seçimleri parse et
    var selections = [];
    if (e.parameter.selections) {
      try {
        selections = JSON.parse(e.parameter.selections);
        Logger.log('Seçimler başarıyla parse edildi: ' + JSON.stringify(selections));
      } catch (parseError) {
        Logger.log('Seçimler parse edilemedi: ' + parseError);
      }
    }
    
    // En az bir satır ekle
    if (selections && selections.length > 0) {
      Logger.log('Seçimler ekleniyor. Seçim sayısı: ' + selections.length);
      selections.forEach(function(selection, index) {
        var row = [
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
        ];
        sheet.appendRow(row);
        Logger.log('Satır ' + (index + 1) + ' eklendi');
      });
    } else {
      Logger.log('Seçim yok, tek satır ekleniyor');
      var row = [
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
      ];
      sheet.appendRow(row);
      Logger.log('Tek satır eklendi');
    }
    
    Logger.log('İşlem başarıyla tamamlandı');
    return ContentService.createTextOutput(JSON.stringify({
      'success': true,
      'message': 'Veri başarıyla kaydedildi'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    Logger.log('HATA OLUŞTU: ' + error.toString());
    Logger.log('Hata stack: ' + error.stack);
    return ContentService.createTextOutput(JSON.stringify({
      'success': false,
      'message': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
} 