function doGet(e) {
  // e parametresi undefined olabilir, kontrol ekleyelim
  if (e && e.parameter && e.parameter.action === 'getResponses') {
    var spreadsheet = SpreadsheetApp.openById('1VNSvtoRdEM05KB-4ZJ0JBgrfjClUYshFpf9AxfpZwug');
    var sheet = spreadsheet.getActiveSheet();
    var data = sheet.getDataRange().getValues();
    
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // Parametre yoksa veya action=getResponses değilse
  var spreadsheet = SpreadsheetApp.openById('1VNSvtoRdEM05KB-4ZJ0JBgrfjClUYshFpf9AxfpZwug');
  var sheet = spreadsheet.getActiveSheet();
  var data = sheet.getDataRange().getValues();
  
  return ContentService.createTextOutput(JSON.stringify({
    'status': 'success',
    'message': 'GET request received',
    'data': data
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
    } else if (e.parameter) {
      formData = e.parameter;
      if (formData.selections) {
        formData.selections = JSON.parse(formData.selections);
      }
    }
    
    Logger.log('Gelen veri: ' + JSON.stringify(formData));

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
      });
    } else {
      // Seçim yoksa tek satır ekle
      var row = [
        new Date().toLocaleString('tr-TR'),
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
        '',
        '',
        '',
        formData.isVolunteer || '',
        formData.contactEmail || ''
      ];
      sheet.appendRow(row);
    }
    
    return ContentService.createTextOutput(JSON.stringify({
      'success': true,
      'message': 'Veri başarıyla kaydedildi'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch(error) {
    Logger.log('HATA: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      'success': false,
      'message': error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
} 