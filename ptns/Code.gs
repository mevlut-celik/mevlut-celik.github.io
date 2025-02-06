function doGet(e) {
  // e parametresi undefined olabilir, kontrol ekleyelim
  if (e && e.parameter && e.parameter.action === 'getResponses') {
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
    var spreadsheet = SpreadsheetApp.openById('1VNSvtoRdEM05KB-4ZJ0JBgrfjClUYshFpf9AxfpZwug');
    var sheet = spreadsheet.getActiveSheet();
    
    // Gelen veriyi parse et
    var formData = {};
    if (e.postData && e.postData.contents) {
      formData = JSON.parse(e.postData.contents);
      Logger.log('Gelen JSON verisi: ' + JSON.stringify(formData));
    } else {
      throw new Error('Veri alınamadı');
    }

    // Seçimler varsa her biri için satır ekle
    if (formData.selections && Array.isArray(formData.selections)) {
      formData.selections.forEach(function(selection) {
        var row = [
          new Date().toLocaleString('tr-TR'),  // Timestamp
          formData.age || '',
          formData.gender || '',
          formData.city || '',
          formData.district || '',
          formData.educationLevel || '',
          formData.graduateEducation || '',
          formData.department || '',
          formData.experienceYears || '',
          formData.experienceMonths || '',
          formData.schoolType || '',
          formData.classLevels || '',
          formData.trainingExperience || '',
          selection.sentence || '',
          selection.explanation || '',
          selection.actions || '',
          formData.isVolunteer || '',
          formData.contactEmail || ''
        ];
        sheet.appendRow(row);
        Logger.log('Satır eklendi: ' + JSON.stringify(row));
      });
    } else {
      throw new Error('Geçerli seçim bulunamadı');
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      'success': true,
      'message': 'Veri başarıyla kaydedildi'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    Logger.log('HATA: ' + error.toString());
    Logger.log('Hata stack: ' + error.stack);
    return ContentService.createTextOutput(JSON.stringify({
      'success': false,
      'message': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
} 