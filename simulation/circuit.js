// circuit.js
const canvas = document.getElementById("simulation");
const ctx = canvas.getContext("2d");

function drawCircuit() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Pil ve tel
    ctx.fillStyle = "gray";
    ctx.fillRect(50, 150, 50, 100); // Pil
    ctx.fillStyle = "black";
    ctx.fillRect(150, 200, 500, 10); // Tel

    // Manyetik alan çizgileri
    for (let i = 160; i <= 640; i += 40) {
        ctx.beginPath();
        ctx.arc(i, 200, 20, 0, 2 * Math.PI);
        ctx.strokeStyle = "blue";
        ctx.stroke();
        ctx.font = "12px Arial";
        ctx.fillText("B", i - 5, 195); // B harfi
    }

    // Kuvvet Vektörü
    const force = calculateForce();
    ctx.beginPath();
    ctx.moveTo(400, 200);
    ctx.lineTo(400, 200 - force * 20); // Kuvvetin yönü
    ctx.strokeStyle = "red";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Kuvvet değeri
    ctx.font = "16px Arial";
    ctx.fillText(`F = ${force.toFixed(2)} N`, 420, 200 - force * 20 - 10);
}
