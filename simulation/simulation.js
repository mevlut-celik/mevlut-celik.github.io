// simulation.js

const canvas = document.getElementById("simulation");
const ctx = canvas.getContext("2d");

const currentSlider = document.getElementById("current");
const fieldSlider = document.getElementById("field");
const lengthSlider = document.getElementById("length");
const angleSlider = document.getElementById("angle");

const currentVal = document.getElementById("current-val");
const fieldVal = document.getElementById("field-val");
const lengthVal = document.getElementById("length-val");
const angleVal = document.getElementById("angle-val");

const saveDataButton = document.getElementById("save-data");

const dataTableBody = document.getElementById("data-table").getElementsByTagName('tbody')[0];

let data = []; // Store simulation data

// Kuvvet hesaplamasını sinüs değerine göre güncelle
function calculateForce() {
    const angle = +angleSlider.value;
    const thetaRad = (Math.PI / 180) * angle;
    return fieldSlider.value * currentSlider.value * lengthSlider.value * Math.sin(thetaRad);
}

// Devre çizimi güncellemesi
function drawCircuit() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Pil ve tel
    ctx.fillStyle = "gray";
    ctx.fillRect(50, 150, 50, 100);
    ctx.fillStyle = "black";
    ctx.fillRect(150, 200, 500, 10);

    // Manyetik alan çizgileri
    for (let i = 160; i <= 640; i += 40) {
        ctx.beginPath();
        ctx.arc(i, 200, 20, 0, 2 * Math.PI);
        ctx.strokeStyle = "blue";
        ctx.stroke();
        ctx.font = "12px Arial";
        ctx.fillText("B", i - 5, 195);
    }

    // Kuvvet Vektörü
    const force = calculateForce();
    ctx.beginPath();
    ctx.moveTo(400, 200);
    ctx.lineTo(400, 200 - force * 20);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Kuvvet değeri
    ctx.font = "16px Arial";
    ctx.fillText(`F = ${force.toFixed(2)} N`, 420, 200 - force * 20 - 10);
}

// Verileri kaydetme
saveDataButton.addEventListener("click", () => {
    const angle = angleSlider.value;
    const current = currentSlider.value;
    const field = fieldSlider.value;
    const length = lengthSlider.value;
    const force = calculateForce();

    // Verileri tabloya ekle
    const row = dataTableBody.insertRow();
    row.insertCell(0).textContent = angle;
    row.insertCell(1).textContent = Math.sin((Math.PI / 180) * angle).toFixed(3); // Sinüs değeri
    row.insertCell(2).textContent = current;
    row.insertCell(3).textContent = field;
    row.insertCell(4).textContent = length;
    row.insertCell(5).textContent = force.toFixed(2);

    // Verileri data array'ine ekle
    data.push({
        angle: angle,
        current: current,
        field: field,
        length: length,
        force: force
    });
});

// Güncelleme fonksiyonu
function update() {
    currentVal.textContent = currentSlider.value;
    fieldVal.textContent = fieldSlider.value;
    lengthVal.textContent = lengthSlider.value;
    angleVal.textContent = angleSlider.value;

    drawCircuit();
}

// Event listeners
[currentSlider, fieldSlider, lengthSlider, angleSlider].forEach(slider => {
    slider.addEventListener("input", update);
});

// Başlangıç durumu
update();
