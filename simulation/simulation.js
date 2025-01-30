// simulation.js

const canvas = document.getElementById('simulation');
const ctx = canvas.getContext('2d');

// Değişkenleri takip etmek için input elementlerini seçelim
const angleInput = document.getElementById('angle');
const currentInput = document.getElementById('current');
const fieldInput = document.getElementById('field');
const lengthInput = document.getElementById('length');

// Canvas boyutlarını ve ölçeklendirmeyi ayarla
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 500;
const DPI = window.devicePixelRatio || 1;

// Canvas'ı yüksek çözünürlüğe ayarla
canvas.width = CANVAS_WIDTH * DPI;
canvas.height = CANVAS_HEIGHT * DPI;
canvas.style.width = CANVAS_WIDTH + 'px';
canvas.style.height = CANVAS_HEIGHT + 'px';

// Context'i ölçeklendir
ctx.scale(DPI, DPI);

// Simülasyon parametreleri
const scale = 70; // Ölçeklendirme faktörünü artır
const centerX = CANVAS_WIDTH / 2;
const centerY = CANVAS_HEIGHT / 2;

// Mouse etkileşimi için değişkenler
let isDragging = false;
let selectedControl = null;
let startY = 0;
let startValue = 0;

// Kontrol noktaları için koordinatlar
const controls = {
    angle: { x: centerX - 120, y: centerY - 150, radius: 20, min: 0, max: 90, value: 90 },
    current: { x: centerX + 120, y: centerY - 150, radius: 20, min: 0.1, max: 10, value: 1 },
    field: { x: centerX - 120, y: centerY + 150, radius: 20, min: 0.1, max: 2, value: 0.5 },
    length: { x: centerX + 120, y: centerY + 150, radius: 20, min: 0.1, max: 5, value: 1 }
};

// Animasyon için değişkenler
let animationId;
let particleTime = 0;
const particles = [];
const PARTICLE_COUNT = 30;
const PARTICLE_SPEED = 2;

// Parçacık sınıfı
class Particle {
    constructor(x, y, wireLength, generatorSize) {
        this.reset(x, y, wireLength, generatorSize);
        // Başlangıç pozisyonunu rastgele seç
        this.progress = Math.random();
    }

    reset(x, y, wireLength, generatorSize) {
        this.x = x;
        this.y = y;
        this.wireLength = wireLength;
        this.generatorSize = generatorSize;
        this.progress = 0;
        this.alpha = 0.7 + Math.random() * 0.3;
    }

    update(current) {
        // Parçacık hareketini güncelle
        this.progress += PARTICLE_SPEED * 0.01 * (current > 0 ? 1 : -1);
        
        if (this.progress > 1 || this.progress < 0) {
            this.progress = current > 0 ? 0 : 1;
        }

        // Devre boyunca parçacık pozisyonunu hesapla
        if (this.progress <= 0.4) { // Ana iletken üzerinde
            this.x = -this.wireLength/2 + this.progress * 2.5 * this.wireLength;
            this.y = 0;
        } else if (this.progress <= 0.55) { // Sağ dikey bağlantı
            this.x = this.wireLength/2;
            this.y = (this.progress - 0.4) * (this.generatorSize * 1.5) / 0.15;
        } else if (this.progress <= 0.85) { // Alt yatay bağlantı
            this.x = this.wireLength/2 - (this.progress - 0.55) * this.wireLength / 0.3;
            this.y = this.generatorSize * 1.5;
        } else { // Sol dikey bağlantı
            this.x = -this.wireLength/2;
            this.y = this.generatorSize * 1.5 - (this.progress - 0.85) * (this.generatorSize * 1.5) / 0.15;
        }
    }

    draw(ctx, current) {
        const radius = Math.abs(current) * 1.5 + 1;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${current > 0 ? '255,255,255' : '200,200,255'}, ${this.alpha})`;
        ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

function initParticles(wireLength, generatorSize) {
    particles.length = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push(new Particle(0, 0, wireLength, generatorSize));
    }
}

function updateParticles(current, wireLength, generatorSize) {
    particles.forEach(particle => {
        particle.update(current);
    });
}

function drawParticles(ctx, current) {
    particles.forEach(particle => {
        particle.draw(ctx, current);
    });
}

function drawSimulation() {
    // Canvas'ı temizle
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Değişken değerlerini kontrol noktalarından al
    const angle = controls.angle.value;
    const current = controls.current.value;
    const field = controls.field.value;
    const length = controls.length.value;
    
    // Koordinat sistemini çiz
    drawCoordinateSystem();
    
    // Manyetik alan vektörlerini çiz
    drawMagneticField(field);
    
    // Devre elemanlarını çiz
    drawCircuit(angle, length, current);
    
    // Kuvvet vektörünü çiz
    drawForceVector(angle, current, field, length);
    
    // Açıyı göster
    drawAngle(angle);
    
    // Lejantı çiz
    drawLegend();
    drawControls(); // Kontrol noktalarını çiz
}

function drawCoordinateSystem() {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
    ctx.moveTo(0, centerY);
    ctx.lineTo(canvas.width, centerY);
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);
    ctx.stroke();
}

function drawMagneticField(field) {
    const spacing = 60;
    const fieldStrength = Math.abs(field);
    const opacity = Math.min(fieldStrength / 2, 1);
    
    // Manyetik alan arka plan gradyanı
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, `rgba(135, 206, 235, ${opacity * 0.1})`);
    gradient.addColorStop(1, `rgba(135, 206, 235, ${opacity * 0.2})`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Manyetik alan çizgileri
    ctx.strokeStyle = `rgba(0, 0, 255, ${opacity * 0.3})`;
    ctx.lineWidth = 1;
    
    for (let x = 0; x < CANVAS_WIDTH; x += spacing) {
        for (let y = 0; y < CANVAS_HEIGHT; y += spacing) {
            // Manyetik alan çizgileri
            ctx.beginPath();
            ctx.moveTo(x - spacing/2, y);
            ctx.lineTo(x + spacing/2, y);
            ctx.stroke();
            
            // Yön okları
            if (field > 0) {
                drawArrow(x, y, x, y - 15, 'blue', 0.4);
            } else {
                drawArrow(x, y - 15, x, y, 'blue', 0.4);
            }
        }
    }
}

function drawCircuit(angle, length, current) {
    const wireLength = length * scale;
    const radians = (angle * Math.PI) / 180;
    const generatorSize = 50;
    
    // Parçacıkları başlat
    if (particles.length === 0) {
        initParticles(wireLength, generatorSize);
    }
    
    ctx.save();
    ctx.translate(centerX, centerY - 30);
    ctx.rotate(-radians);
    
    // İletkeni çiz
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    
    // Ana iletken çizgisi
    ctx.beginPath();
    ctx.strokeStyle = current > 0 ? '#ff4444' : '#4444ff';
    ctx.lineWidth = Math.abs(current) * 2 + 2;
    ctx.lineCap = 'round';
    ctx.moveTo(-wireLength / 2, 0);
    ctx.lineTo(wireLength / 2, 0);
    ctx.stroke();
    
    // Sağ dikey bağlantı
    ctx.beginPath();
    ctx.moveTo(wireLength / 2, 0);
    ctx.lineTo(wireLength / 2, generatorSize * 1.5);
    ctx.stroke();
    
    // Sol dikey bağlantı
    ctx.beginPath();
    ctx.moveTo(-wireLength / 2, 0);
    ctx.lineTo(-wireLength / 2, generatorSize * 1.5);
    ctx.stroke();
    
    // Yatay alt bağlantı
    ctx.beginPath();
    ctx.moveTo(-wireLength / 2, generatorSize * 1.5);
    ctx.lineTo(wireLength / 2, generatorSize * 1.5);
    ctx.stroke();
    
    // Gölgeyi kapat
    ctx.shadowColor = 'transparent';
    
    // Akım yönü okları - ana iletken üzerinde
    const arrowSpacing = 30;
    const arrowCount = Math.floor(wireLength / arrowSpacing);
    
    // Ana iletken üzerindeki oklar
    for (let i = -arrowCount/2; i < arrowCount/2; i++) {
        const x = i * arrowSpacing;
        if (current > 0) {
            drawArrow(x - 10, 0, x + 10, 0, current > 0 ? '#ff4444' : '#4444ff', 0.9);
        } else {
            drawArrow(x + 10, 0, x - 10, 0, current > 0 ? '#ff4444' : '#4444ff', 0.9);
        }
    }
    
    // Sağ dikey bağlantıdaki ok
    if (current > 0) {
        drawArrow(wireLength / 2, generatorSize * 0.5, wireLength / 2, generatorSize * 0.8, current > 0 ? '#ff4444' : '#4444ff', 0.9);
    } else {
        drawArrow(wireLength / 2, generatorSize * 0.8, wireLength / 2, generatorSize * 0.5, current > 0 ? '#ff4444' : '#4444ff', 0.9);
    }
    
    // Alt yatay bağlantıdaki ok
    if (current > 0) {
        drawArrow(0 + wireLength / 4, generatorSize * 1.5, 0, generatorSize * 1.5, current > 0 ? '#ff4444' : '#4444ff', 0.9);
    } else {
        drawArrow(0, generatorSize * 1.5, 0 + wireLength / 4, generatorSize * 1.5, current > 0 ? '#ff4444' : '#4444ff', 0.9);
    }
    
    // Sol dikey bağlantıdaki ok
    if (current > 0) {
        drawArrow(-wireLength / 2, generatorSize * 0.8, -wireLength / 2, generatorSize * 0.5, current > 0 ? '#ff4444' : '#4444ff', 0.9);
    } else {
        drawArrow(-wireLength / 2, generatorSize * 0.5, -wireLength / 2, generatorSize * 0.8, current > 0 ? '#ff4444' : '#4444ff', 0.9);
    }
    
    // Üreteci çiz - sol kenarda
    ctx.save();
    ctx.translate(-wireLength / 2, generatorSize);
    drawGenerator(current);
    ctx.restore();
    
    // Parçacıkları güncelle ve çiz
    updateParticles(current, wireLength, generatorSize);
    drawParticles(ctx, current);
    
    ctx.restore();
}

function drawGenerator(current) {
    const generatorSize = 60;
    
    // Gölge efekti
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 5;
    
    // Üreteç gövdesi
    ctx.beginPath();
    ctx.fillStyle = '#f8f9fa';
    ctx.strokeStyle = '#343a40';
    ctx.lineWidth = 3;
    ctx.rect(-generatorSize/2, -generatorSize/2, generatorSize, generatorSize);
    ctx.fill();
    ctx.stroke();
    
    // Gölgeyi kapat
    ctx.shadowColor = 'transparent';
    
    // Üreteç sembolleri (+ ve -)
    ctx.font = 'bold 24px Arial';
    ctx.fillStyle = '#343a40';
    if (current > 0) {
        ctx.fillText('+', -generatorSize/4, 5);
        ctx.fillText('-', generatorSize/4, 5);
    } else {
        ctx.fillText('-', -generatorSize/4, 5);
        ctx.fillText('+', generatorSize/4, 5);
    }
}

function drawForceVector(angle, current, field, length) {
    const force = Math.abs(current * field * length * Math.sin(angle * Math.PI / 180));
    const forceLength = force * scale;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    
    // Gölge efekti
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    
    // Kuvvet vektörü
    ctx.beginPath();
    ctx.strokeStyle = '#28a745';
    ctx.lineWidth = 3;
    drawArrow(0, 0, 0, -forceLength, '#28a745', 1);
    
    // Kuvvet büyüklüğü
    ctx.font = '16px Arial';
    ctx.fillStyle = '#28a745';
    ctx.fillText(`${force.toFixed(2)} N`, 10, -forceLength/2);
    
    ctx.restore();
}

function drawAngle(angle) {
    ctx.save();
    ctx.translate(centerX, centerY);
    
    // Açı yayı
    ctx.beginPath();
    ctx.strokeStyle = 'orange';
    ctx.arc(0, 0, 30, -Math.PI/2, -((90 - angle) * Math.PI / 180), true);
    ctx.stroke();
    
    // Açı değeri
    ctx.fillStyle = 'orange';
    ctx.font = '14px Arial';
    ctx.fillText(`${angle}°`, 35, -10);
    
    ctx.restore();
}

function drawArrow(fromX, fromY, toX, toY, color, opacity) {
    const headLength = 10;
    const headAngle = Math.PI / 6;
    
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);
    
    ctx.strokeStyle = `rgba(${color === 'red' ? '255,0,0' : color === 'blue' ? '0,0,255' : '0,255,0'}, ${opacity})`;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - headAngle), 
               toY - headLength * Math.sin(angle - headAngle));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle + headAngle),
               toY - headLength * Math.sin(angle + headAngle));
    ctx.stroke();
}

function drawLegend() {
    const legendX = 20;
    const legendY = 20;
    const lineHeight = 25;
    
    ctx.font = '16px Arial';
    
    // Akım
    ctx.fillStyle = 'red';
    ctx.fillText('I: Akım', legendX, legendY);
    
    // Manyetik Alan
    ctx.fillStyle = 'blue';
    ctx.fillText('B: Manyetik Alan', legendX, legendY + lineHeight);
    
    // Kuvvet
    ctx.fillStyle = 'green';
    ctx.fillText('F: Manyetik Kuvvet', legendX, legendY + 2 * lineHeight);
    
    // Üreteç
    ctx.fillStyle = 'black';
    ctx.fillText('Üreteç', legendX, legendY + 3 * lineHeight);
}

function drawControls() {
    for (const [name, control] of Object.entries(controls)) {
        // Kontrol dairesi
        ctx.beginPath();
        ctx.fillStyle = selectedControl === name ? 'rgba(52, 152, 219, 0.8)' : 'rgba(52, 152, 219, 0.5)';
        ctx.strokeStyle = '#2980b9';
        ctx.lineWidth = 2;
        ctx.arc(control.x, control.y, control.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Değer göstergesi
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(control.value.toFixed(1), control.x, control.y + 5);

        // Etiket
        ctx.fillStyle = '#333';
        ctx.font = '14px Arial';
        const labels = {
            angle: 'Açı (θ)',
            current: 'Akım (I)',
            field: 'B Alan',
            length: 'Uzunluk (L)'
        };
        ctx.fillText(labels[name], control.x, control.y - 25);
    }
}

// Mouse olayları
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width) / DPI;
    const y = (e.clientY - rect.top) * (canvas.height / rect.height) / DPI;

    for (const [name, control] of Object.entries(controls)) {
        const distance = Math.sqrt((x - control.x) ** 2 + (y - control.y) ** 2);
        if (distance < control.radius) {
            isDragging = true;
            selectedControl = name;
            startY = y;
            startValue = control.value;
            break;
        }
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (isDragging && selectedControl) {
        const rect = canvas.getBoundingClientRect();
        const y = (e.clientY - rect.top) * (canvas.height / rect.height) / DPI;
        const deltaY = startY - y;
        const control = controls[selectedControl];
        
        // Değeri güncelle
        const sensitivity = (control.max - control.min) / 200;
        let newValue = startValue + deltaY * sensitivity;
        newValue = Math.max(control.min, Math.min(control.max, newValue));
        control.value = newValue;

        // Input değerlerini güncelle
        const input = document.getElementById(selectedControl);
        input.value = newValue;
        document.getElementById(`${selectedControl}-val`).textContent = newValue.toFixed(1);

        drawSimulation();
        
        // Parçacıkları yeniden başlat
        particles.length = 0;
    }
});

canvas.addEventListener('mouseup', () => {
    isDragging = false;
    selectedControl = null;
});

// Input event listener'larını güncelle
angleInput.addEventListener('input', (e) => {
    controls.angle.value = parseFloat(e.target.value);
    drawSimulation();
});

currentInput.addEventListener('input', (e) => {
    controls.current.value = parseFloat(e.target.value);
    drawSimulation();
});

fieldInput.addEventListener('input', (e) => {
    controls.field.value = parseFloat(e.target.value);
    drawSimulation();
});

lengthInput.addEventListener('input', (e) => {
    controls.length.value = parseFloat(e.target.value);
    drawSimulation();
});

// Animasyon döngüsü
function animate() {
    drawSimulation();
    animationId = requestAnimationFrame(animate);
}

// Animasyonu başlat
animate();

// Sayfa kapatılırken animasyonu durdur
window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(animationId);
});

// İlk çizimi yap
drawSimulation();
