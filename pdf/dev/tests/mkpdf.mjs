import { setup, app, out, FIXTURES } from "../harness.mjs";
import fs from "fs";
await setup();
const { PDFDocument, rgb } = PDFLib;
const F = new URL("../assets/fonts/", import.meta.url).pathname;
const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
const reg = await doc.embedFont(fs.readFileSync(F + "LiberationSans-Regular.ttf"), { subset: true });
const bold = await doc.embedFont(fs.readFileSync(F + "LiberationSans-Bold.ttf"), { subset: true });
const serif = await doc.embedFont(fs.readFileSync(F + "LiberationSerif-Italic.ttf"), { subset: true });
const logo = await doc.embedPng(fs.readFileSync(FIXTURES + "/logo.png"));
let p = doc.addPage([595.28, 841.89]); let y = 780;
const T = (t, o = {}) => { p.drawText(t, { x: o.x ?? 60, y, size: o.size ?? 11, font: o.font ?? reg, color: o.color ?? rgb(0,0,0) }); };
T("Çeyrek Satış Raporu", { size: 22, font: bold }); y -= 30;
T("Hazırlayan: Analiz Ekibi — Ekim 2026", { size: 10, font: serif, color: rgb(0.4,0.4,0.4) }); y -= 34;
T("1. Özet", { size: 15, font: bold }); y -= 22;
for (const line of ["Bu rapor üçüncü çeyrek satışlarını özetler. Satışlar bir önceki çeyreğe göre yüzde on iki", "arttı; en güçlü büyüme İzmir ve Ankara bölgelerinde görüldü. Aşağıdaki tablo bölge bazında", "dağılımı gösterir."]) { T(line); y -= 15; }
y -= 10; T("2. Bölgeler", { size: 15, font: bold }); y -= 24;
// ruled table
const cols = [60, 220, 340, 460], widths = [160, 120, 120, 75];
const rows = [["Bölge", "Q2 (₺)", "Q3 (₺)", "Değişim"], ["İstanbul", "1.250.000", "1.310.500", "%4,8"], ["Ankara", "640.200", "742.000", "%15,9"], ["İzmir", "512.000", "601.300", "%17,4"], ["Toplam", "2.402.200", "2.653.800", "%10,5"]];
const top = y + 14;
rows.forEach((r, i) => { r.forEach((c, j) => p.drawText(c, { x: cols[j] + 4, y, size: 10.5, font: i === 0 || i === 4 ? bold : reg })); y -= 20; });
for (let i = 0; i <= rows.length; i++) p.drawLine({ start: { x: 60, y: top - i * 20 }, end: { x: 535, y: top - i * 20 }, thickness: 0.7 });
for (const x of [60, 220, 340, 460, 535]) p.drawLine({ start: { x, y: top }, end: { x, y: top - rows.length * 20 }, thickness: 0.7 });
y -= 20; T("3. Öne çıkanlar", { size: 15, font: bold }); y -= 22;
for (const b of ["Yeni ürün hattı beklentinin üzerinde satıldı.", "Çevrim içi kanalın payı %31'e yükseldi.", "Lojistik maliyetleri %3 azaldı."]) { T("•", { x: 66 }); T(b, { x: 80 }); y -= 16; }
y -= 10; p.drawImage(logo, { x: 60, y: y - 60, width: 120, height: 60 }); y -= 80;
T("Şekil 1: Bölge logosu (örnek görsel)", { size: 9, font: serif, color: rgb(0.4,0.4,0.4) });
p = doc.addPage([595.28, 841.89]); y = 780;
T("4. Ek: Ürün listesi (çizgisiz tablo)", { size: 15, font: bold }); y -= 26;
const prod = [["Kod", "Ürün", "Stok", "Fiyat"], ["A-100", "Kurşun kalem", "1.200", "4,50"], ["A-210", "Defter (A4)", "340", "22,90"], ["B-030", "Sırt çantası", "45", "349,00"], ["C-777", "Silgi", "2.800", "1,25"]];
prod.forEach((r, i) => { const xs = [60, 140, 330, 420]; r.forEach((c, j) => p.drawText(c, { x: xs[j], y, size: 10.5, font: i === 0 ? bold : reg })); y -= 18; });
y -= 20;
for (const line of ["Not: Fiyatlar KDV hariçtir. Stok değerleri 30 Eylül 2026 itibarıyla günceldir. Bu paragraf iki", "satıra yayılır ve dönüştürücünün paragraf birleştirmesini sınamak için buradadır."]) { T(line); y -= 15; }
doc.setTitle("Çeyrek Satış Raporu"); doc.setAuthor("Analiz Ekibi");
fs.writeFileSync(FIXTURES + "/report.pdf", await doc.save());
console.log("report ok");
