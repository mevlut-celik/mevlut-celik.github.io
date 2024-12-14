// Veriyi Excel formatında dışa aktarma fonksiyonu
function exportToExcel(data, sheetName) {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, sheetName + ".xlsx");
}

// "Sinüs-Kuvvet Verilerini Al" butonu işlevi
document.getElementById("sinus-force-data").addEventListener("click", () => {
    const sinusForceData = data.map(entry => ({
        "Sinüs(θ)": Math.sin(entry.angle * (Math.PI / 180)),
        "Kuvvet (N)": entry.force
    }));
    exportToExcel(sinusForceData, "Sinus-Kuvvet");
});

// "Akım-Kuvvet Verilerini Al" butonu işlevi
document.getElementById("current-force-data").addEventListener("click", () => {
    const currentForceData = data.map(entry => ({
        "Akım (A)": entry.current,
        "Kuvvet (N)": entry.force
    }));
    exportToExcel(currentForceData, "Akım-Kuvvet");
});

// "Tel Uzunluğu-Kuvvet Verilerini Al" butonu işlevi
document.getElementById("length-force-data").addEventListener("click", () => {
    const lengthForceData = data.map(entry => ({
        "Tel Uzunluğu (m)": entry.length,
        "Kuvvet (N)": entry.force
    }));
    exportToExcel(lengthForceData, "TelUzunluğu-Kuvvet");
});

// "Manyetik Alan-Kuvvet Verilerini Al" butonu işlevi
document.getElementById("field-force-data").addEventListener("click", () => {
    const fieldForceData = data.map(entry => ({
        "Manyetik Alan (T)": entry.field,
        "Kuvvet (N)": entry.force
    }));
    exportToExcel(fieldForceData, "ManyetikAlan-Kuvvet");
});
