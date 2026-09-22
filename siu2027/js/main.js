/**
 * SİU 2027 — 35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı
 * Etkileşim, Program Filtreleme, Çift Dil (TR/EN), Geri Sayım ve Mobil Menü Mantığı
 */

document.addEventListener('DOMContentLoaded', () => {
  initSignalCanvas();
  initCountdown();
  initLangSwitcher();
  initProgramFilters();
  initArchiveSearch();
  initArchiveMap();
  initRegistrationForm();
  initSearchModal();
  initMobileMenu();
  initCommitteeBios();
});

/* ==========================================================================
   1. İnteraktif Sinyal Dalga Animasyonu (Hero Canvas)
   ========================================================================== */
function initSignalCanvas() {
  const canvas = document.getElementById('signalCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let width = 0, height = 0, dpr = 1;
  let phase = 0;
  let rafId = null;
  let visible = true;

  // Sinyal izi: tek hairline ana çizgi + soluk bir yankı.
  // Genlik x boyunca modüle edilir; düz sinüs yerine "dalga paketi" hissi verir.
  const LINES = [
    { color: 'rgba(0, 43, 73, 0.55)',   freq: 0.016, amp: 0.34, speed: 0.55, offset: 0 },
    { color: 'rgba(0, 163, 224, 0.40)', freq: 0.011, amp: 0.26, speed: 0.38, offset: 1.9 }
  ];

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const midY = height / 2;
    const half = height / 2 - 2;
    const step = width > 900 ? 3 : 2;

    LINES.forEach((line) => {
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += step) {
        // zarf: kenarlarda sönümlenir, ortada dolgunlaşır
        const t = x / width;
        const envelope = Math.sin(Math.PI * t) * (0.75 + 0.25 * Math.sin(t * 6.283 + phase * 0.35));
        const y = midY + Math.sin(x * line.freq + phase * line.speed + line.offset) * half * line.amp * envelope;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  function loop() {
    phase += 0.012;               // yavaş: tam tur ~8 sn
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (rafId !== null || reduceMotion.matches || !visible) return;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  // Ekrandan çıkınca dur (pil/CPU)
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) start(); else stop();
    }, { threshold: 0 }).observe(canvas);
  }

  // Hareketi azalt tercihi anlık değişirse uy
  const onMotionChange = () => { if (reduceMotion.matches) { stop(); draw(); } else start(); };
  if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', onMotionChange);

  resize();      // durağan çizim her hâlükârda görünür
  start();       // animasyon yalnız izin varsa
}

/* ==========================================================================
   2. Geri Sayım Sayacı (04 Temmuz 2027)
   ========================================================================== */
function initCountdown() {
  const targetDate = new Date('2027-07-04T09:30:00+03:00').getTime();

  const daysEl = document.getElementById('countDays');
  const hoursEl = document.getElementById('countHours');
  const minsEl = document.getElementById('countMins');
  const secsEl = document.getElementById('countSecs');

  if (!daysEl) return;

  function update() {
    const now = new Date().getTime();
    const distance = targetDate - now;

    if (distance < 0) {
      if (daysEl) daysEl.innerText = '00';
      if (hoursEl) hoursEl.innerText = '00';
      if (minsEl) minsEl.innerText = '00';
      if (secsEl) secsEl.innerText = '00';
      return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((distance % (1000 * 60)) / 1000);

    daysEl.innerText = String(days).padStart(2, '0');
    hoursEl.innerText = String(hours).padStart(2, '0');
    minsEl.innerText = String(mins).padStart(2, '0');
    secsEl.innerText = String(secs).padStart(2, '0');
  }

  update();
  setInterval(update, 1000);
}

/* ==========================================================================
   3. TR / EN Çift Dil Desteği (Menü, Başlıklar, Butonlar ve Sayfa İçerikleri)
   ========================================================================== */
const i18nDictionary = {
  tr: {
    ar001: "Kurultay Kronolojisi (1993 – 2027)",
    ar002: "SİU kurultaylarının yıl, sıra numarası, ev sahibi kurum ve düzenlendiği şehir bilgileri. Tabloda arama yaparak geçmiş kurultayları filtreleyebilirsiniz.",
    ar003: "Arşivde ara",
    ar004: "No",
    ar005: "Yıl",
    ar006: "Ev Sahibi / Ortak Kurum",
    ar007: "Şehir / Yer / Biçim",
    ar009: "İstanbul Medipol Üniversitesi",
    ar010: "Kavacık, İstanbul (Yüz Yüze)",
    ar012: "Piri Reis Üniversitesi",
    ar013: "Tuzla, İstanbul",
    ar015: "Işık Üniversitesi",
    ar016: "Şile, İstanbul",
    ar018: "Tarsus Üniversitesi",
    ar019: "Tarsus / Mersin",
    ar021: "İstanbul Teknik Üniversitesi",
    ar022: "Ayazağa, İstanbul",
    ar024: "Bahçeşehir Üniversitesi",
    ar025: "Safranbolu (Hibrit Model)",
    ar027: "Bahçeşehir Üniversitesi",
    ar028: "Çevrim İçi (Virtual)",
    ar030: "İstanbul Medipol Üniversitesi",
    ar031: "Çevrim İçi (Pandemi Dönemi)",
    ar033: "Gebze Teknik Üniv. + Sivas Cumhuriyet Üniv.",
    ar034: "Sivas",
    ar036: "İzmir Kâtip Çelebi Üniversitesi",
    ar037: "İzmir",
    ar039: "İstanbul Teknik Üniversitesi",
    ar040: "Antalya",
    ar042: "Bülent Ecevit Üniversitesi",
    ar043: "Zonguldak",
    ar045: "İnönü Üniversitesi",
    ar046: "Malatya",
    ar048: "Karadeniz Teknik Üniversitesi",
    ar049: "Trabzon",
    ar051: "Uluslararası Kıbrıs Üniversitesi",
    ar052: "Girne, KKTC",
    ar054: "Özyeğin Üniversitesi",
    ar055: "Fethiye, Muğla",
    ar057: "Hacettepe Üniversitesi",
    ar058: "Kemer, Antalya",
    ar060: "Dicle Üniversitesi",
    ar061: "Diyarbakır",
    ar063: "Kocaeli Üniversitesi",
    ar064: "Antalya",
    ar066: "Orta Doğu Teknik Üniversitesi (ODTÜ)",
    ar067: "Didim, Aydın",
    ar069: "Anadolu Üniversitesi",
    ar070: "Eskişehir",
    ar072: "Sabancı Üniversitesi",
    ar073: "Belek, Antalya",
    ar075: "Erciyes Üniversitesi",
    ar076: "Kayseri",
    ar078: "İstanbul Teknik Üniversitesi",
    ar079: "Kuşadası, Aydın",
    ar081: "Koç Üniversitesi",
    ar082: "Rumelifeneri, İstanbul",
    ar084: "Işık Üniversitesi",
    ar085: "Pamukkale, Denizli",
    ar087: "Doğu Akdeniz Üniversitesi",
    ar088: "Gazimağusa, KKTC",
    ar090: "İstanbul Üniversitesi",
    ar091: "Beldibi, Antalya",
    ar093: "Bilkent Üniversitesi",
    ar094: "Bilkent, Ankara",
    ar096: "Başkent Üniversitesi",
    ar097: "Kızılcahamam, Ankara",
    ar099: "Boğaziçi Üniversitesi",
    ar100: "Kuşadası, Aydın",
    ar102: "Orta Doğu Teknik Üniversitesi (ODTÜ)",
    ar103: "Kemer, Antalya",
    ar105: "İTÜ + TÜBİTAK MAM",
    ar106: "Kapadokya, Nevşehir",
    ar108: "Bilkent Üniversitesi + Boğaziçi Üniversitesi",
    ar109: "Gökova, Muğla",
    ar111: "Boğaziçi Üniversitesi",
    ar112: "Bebek, İstanbul",
    arsivKicker: "KURUMSAL BELLEK & BİLİMSEL ARŞİV",
    arsivPageDesc: "Boğaziçi Üniversitesi'nde başlayan 35 yıllık kurultay kronolojisi, ev sahibi kurumlar ve etkinlik yerleri.",
    arsivPageTitle: "SİU Tarihsel Arşivi (1993 – 2027)",
    brandSubtitle: "35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı",
    btnCfp: "Bildiri Çağrısı (CFP)",
    btnTracks: "Bildiri Konuları / Kulvarlar",
    btnRegister: "Kayıt Ol",
    btnSubmit: "Bildiri Gönder (Duyurulacaktır)",
    btnViewProgram: "Programı Görüntüle",
    btnViewTracks: "Yazarlar İçin Sayfasına Gidin",
    cal001: "Önemli tarihleri takvimime ekle",
    cal002: "Kurultay tarihlerini ekle",
    cal003: "Google Takvim'e ekle",
    cal004: ".ics dosyası — Apple Takvim, Outlook, Google Takvim ve Thunderbird ile uyumludur. Hatırlatıcılar dahildir.",
    cfp001: "Bildiri Çağrısı (PDF, Türkçe)",
    cfp002: "Call for Papers (PDF, English)",
    cmt001: "The Microsoft CMT service was used for managing the peer-reviewing process for this conference. This service was provided for free by Microsoft and they bore all expenses, including costs for Azure cloud services as well as for software development and support.",
    cmt002: "The Microsoft CMT service was used for managing the peer-reviewing process for this conference. This service was provided for free by Microsoft and they bore all expenses, including costs for Azure cloud services as well as for software development and support.",
    countdownDays: "GÜN",
    countdownHours: "SAAT",
    countdownMins: "DAKİKA",
    countdownSecs: "SANİYE",
    countdownTitle: "Kurultaya Kalan Süre",
    datesKicker: "TAKVİM VE AŞAMALAR",
    datesThDeadline: "Son Tarih",
    datesThDate: "Tarih",
    datesThProcess: "Aşama / İşlem",
    datesThStatus: "Durum",
    descAboutHistory: "35 yıllık kurultay kronolojisi",
    descAboutHost: "İstanbul Medipol Üniversitesi",
    descAboutMsg: "Kurultay başkanlarının daveti",
    descAboutScope: "Bilimsel vizyon ve misyon",
    descAuthorsCamera: "Duyurulacaktır",
    descAuthorsCfp: "Duyurulacaktır",
    descAuthorsSpecial: "Özel oturum önerisi iletme",
    descAuthorsTemplates: "Duyurulacaktır",
    descAuthorsTracks: "6 teknik araştırma kulvarı",
    descCompetitionsThesis: "YL ve Doktora tez sunumları",
    descCompetitionsTravel: "SİU 2027 destek bursu",
    descCompetitionsUndergrad: "Bitirme projesi ödülleri",
    descProgramDetail: "Duyurulacaktır",
    descProgramOverview: "Duyurulacaktır",
    descProgramSocial: "Duyurulacaktır",
    descProgramSpeakers: "Duyurulacaktır",
    descProgramTutorials: "Gün ve saatler duyurulacaktır",
    descProgramPanels: "Duyurulacaktır",
    descRegistrationAccom: "Kavacık çevresinde konaklama",
    descRegistrationFaq: "Yazarlar ve katılımcılar için SSS",
    descRegistrationFees: "Kayıt kategorileri ve paketler",
    descRegistrationTravel: "Kampüs haritası ve toplu taşıma",
    dil001: "SİU 2027; sinyal işleme, haberleşme, bilgisayarlı görü, makine öğrenmesi, biyomedikal ve robotik alanlarındaki en güncel kuramsal ve uygulamalı araştırmaların sunulacağı seçkin bir platformdur. Bildiriler <strong>Türkçe</strong> olarak yazılmalıdır. Yazarlardan birinin anadilinin Türkçe olmaması durumunda İngilizce bildiriler değerlendirmeye alınacaktır. Sunulacak bildirilerin daha önce başka bir konferans veya dergide yayımlanmamış özgün çalışmalar olması gerekmektedir.",
    dil002: "Bildiri Dili: Türkçe",
    dil003: "Bildiriler Türkçe yazılmalıdır; yazarlardan biri anadili Türkçe olmayan biriyse İngilizce bildiri kabul edilir.",
    dil004: "Bildiri başlığını, özetini ve anahtar kelimeleri sisteme girin.",
    yz051b: "Tüm yazarların ad, soyad, kurum ve e-posta bilgilerini CMT sistemine eksiksiz ve doğru biçimde girin.",
    dil005: "Bildiri ve sunum dili ne olmalıdır?",
    dil006: "Bildiriler Türkçe olarak yazılmalıdır. Yazarlardan birinin anadilinin Türkçe olmaması durumunda İngilizce bildiriler değerlendirmeye alınır. Türkçe bildiriler Türkçe, İngilizce bildiriler İngilizce sunulur.",
    dr01Desc: "Özel oturum önerilerinin Kurultay Sekreterliğine iletilmesi",
    dr01Due: "16 Kasım 2026",
    dr01Name: "Özel Oturum Düzenleme Daveti",
    dr01Status: "Aktif Çağrı",
    dr02Desc: "Eğitim semineri (tutorial) önerilerinin Kurultay Sekreterliğine iletilmesi",
    dr02Due: "16 Kasım 2026",
    dr02Name: "Eğitim Semineri Düzenleme Daveti",
    dr02Status: "Aktif Çağrı",
    dr03Desc: "Kabul edilen özel oturumların düzenleyicilere duyurulması",
    dr03Due: "30 Kasım 2026",
    dr03Name: "Özel Oturum Kabullerinin Bildirilmesi",
    dr03Status: "Planlandı",
    dr04Desc: "Kabul edilen seminerlerin eğitmenlere duyurulması",
    dr04Due: "30 Kasım 2026",
    dr04Name: "Eğitim Semineri Kabullerinin Bildirilmesi",
    dr04Status: "Planlandı",
    dr05Desc: "Microsoft CMT üzerinden en fazla 4 sayfa, çift kör PDF",
    dr05Due: "1 Şubat 2027",
    dr05Name: "Bildirilerin Gönderilmesi",
    dr05Note: "Göndermeden önce <a href=\"yazarlar#sablonlar\">bildiri formatını</a> ve <a href=\"#kulvarlar\">kulvarları</a> inceleyin.",
    dr05Status: "Planlandı",
    dr06Desc: "Hakem değerlendirme sonuçlarının yazarlara bildirilmesi",
    dr06Due: "30 Nisan 2027",
    dr06Name: "Sonuçların Açıklanması",
    dr06Status: "Planlandı",
    dr07Desc: "IEEE PDF eXpress onayı, telif devri (eCF) ve en az bir yazarın kaydı",
    dr07Due: "24 Mayıs 2027",
    dr07Name: "Baskıya Hazır Bildirilerin Gönderilmesi",
    dr07Note: "<a class=\"link-off\" aria-disabled=\"true\">IEEE yayın ve telif süreci</a> — Duyurulacaktır",
    dr07Status: "Planlandı",
    dr08Desc: "İstanbul Medipol Üniversitesi Kavacık Güney Yerleşkesi",
    dr08Due: "4–7 Temmuz 2027",
    dr08Name: "Kurultay Tarihleri",
    dr08Status: "Etkinlik",
    dt001: "SİU 2027 kapsamında güncel ve özelleşmiş araştırma başlıklarında özel oturumlar düzenlenecektir. Özel oturum düzenlemek isteyen araştırmacıların en geç <strong>16 Kasım 2026</strong> tarihine kadar aşağıdaki bilgileri içeren öneri dosyasını <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a> adresine iletmeleri gerekmektedir:",
    dt002: "<strong>Yazar Kaydı:</strong> Bildirinin programda kalması ve IEEE yayın sürecine girebilmesi için yazarlardan en az birinin <strong>24 Mayıs 2027</strong> tarihine kadar kurultay kaydını tamamlaması zorunludur.",
    dt003: "Kabul edilen özel oturumlar <strong>30 Kasım 2026</strong> tarihine kadar düzenleyicilere bildirilecektir.",
    dt004: "Oturum başlıkları, salonlar, saatler ve oturumlarda sunulacak bildiriler hakem değerlendirme süreci tamamlandıktan sonra (30 Nisan 2027 sonrası) yayımlanacaktır. Kurultayda bildiri kabul edilen kulvarlar için <a href=\"yazarlar#kulvarlar\">Konular ve Araştırma Kulvarları</a> sayfasına bakabilirsiniz.",
    dt005: "SİU 2027 kapsamında yarım günlük eğitim seminerleri (tutorial) ve sanayi panelleri düzenlenecektir. Eğitim semineri önerileri en geç <strong>16 Kasım 2026</strong> tarihine kadar Kurultay Sekreterliğine iletilmelidir; kabul edilen seminerler <strong>30 Kasım 2026</strong> tarihine kadar eğitmenlere bildirilecektir. Kabul edilen başlıklar, gün ve saatleriyle birlikte bu bölümde yayımlanacaktır. <strong>Seminer gün ve saatleri: Duyurulacaktır.</strong>",
    dt006: "Kayıt ücretleri; erken kayıt ve öğrenci durumuna göre kademelendirilecektir. Tutarlar ve erken kayıt son tarihi henüz kesinleşmemiştir; onaylandığında bu sayfada duyurulacaktır.",
    dt007: "Erken kayıt tarihi duyurulacaktır",
    dt008: "Erken kayıt dönemi sonrası",
    dt009: "Erken Kayıt",
    dt010: "Kabul edilen ve kurultayda sunulan bildirilerin <strong>IEEE Xplore Dijital Kütüphanesi’ne (IEEE Xplore Digital Library)</strong> gönderilebilmesi ve programda yer alması için yazarlarından en az birinin <strong>24 Mayıs 2027</strong> tarihine kadar kayıt yaptırması zorunludur.",
    dt011: "<strong>İptal ve iade koşulları:</strong> Kayıt ücretleriyle birlikte duyurulacaktır. İptal talepleri <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a> adresine yazılı olarak iletilir.",
    dt012: "<strong>Son Başvuru Tarihi:</strong> Duyurulacaktır",
    footerAbout: "35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı, 4–7 Temmuz 2027 tarihlerinde İstanbul Medipol Üniversitesi Kavacık Güney Kampüsü'nde düzenlenecektir.",
    footerInstitutional: "Kurumsal",
    footerQuickLinks: "Hızlı Erişim",
    footerSecretariat: "Kurultay Sekreterliği",
    hakkindaKicker: "KURUMSAL VE BİLİMSEL BİLGİLER",
    hakkindaPageDesc: "35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı'nın (SİU 2027) vizyonu, kapsamı ve ev sahibi İstanbul Medipol Üniversitesi.",
    hakkindaPageTitle: "Kurultay Hakkında",
    heroBadge: "35. KURULTAY • RESMÎ BAŞVURU MERKEZİ",
    heroDesc: "Türkiye'nin sinyal işleme, kablosuz haberleşme, bilgisayarlı görü ve yapay zekâ alanındaki en köklü bilimsel buluşması.",
    heroVenueSub: "Kavacık Güney Kampüsü",
    heroVenueVal: "İstanbul Medipol Üniversitesi",
    heroMainTitle: "35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı — <span class=\"cyan-word\">SİU 2027</span>",
    heroTopics: "Yapay Zekâ • 6G • Biyomedikal • Bilgisayarlı Görü • Otonom Sistemler",
    hk001: "Bölüm Başlıkları",
    hk002: "• Hoş Geldiniz Mesajı",
    hk003: "• Kapsam ve Amaç",
    hk004: "• Ev Sahibi Kurum",
    hk006: "DAVET VE MESAJ",
    hk007: "Kurultay Başkanları Hoş Geldiniz Mesajı",
    hk008: "Değerli Araştırmacılar, Meslektaşlarımız ve Öğrencilerimiz,",
    hk009: "Sinyal işleme ve haberleşme alanlarının buluşması olan <strong>Sinyal İşleme ve İletişim Uygulamaları Kurultayı'nın 35.'sini (SİU 2027)</strong>, <strong>4–7 Temmuz 2027</strong> tarihlerinde <strong>İstanbul Medipol Üniversitesi</strong> ev sahipliğinde gerçekleştirecek olmanın büyük onurunu ve heyecanını yaşıyoruz.",
    hk010: "1993 yılında Boğaziçi Üniversitesi'nde atılan tohumlar, bugün otuz beşinci yılında Türkiye'nin dört bir yanından ve yurt dışından yüzlerce akademisyeni, genç araştırmacıyı ve savunma/bilişim sanayii temsilcisini bir araya getiren devasa bir bilimsel ekosisteme dönüşmüştür.",
    hk011: "İstanbul'un eşsiz Boğaz manzarasına komşu Kavacık Kampüsümüzde gerçekleşecek kurultayımıza davet etmekten memnuniyet duyarız.",
    hk012: "SİU 2027 Kurultay Düzenleme Kurulu Adına",
    hk013: "Prof. Dr. Hüseyin Arslan & Prof. Dr. Elif Uysal",
    hk014: "Kurultay Eş Başkanları",
    hk015: "MİSYON VE HEDEFLER",
    hk016: "Kapsam ve Amaç",
    hk017: "SİU Kurultayı'nın temel amacı; sinyal işleme, haberleşme kuramı, bilgisayarlı görü, makine öğrenmesi ve kontrol alanlarında çalışan araştırmacıların özgün çalışmalarını sunabilecekleri, deneyim paylaşımında bulunabilecekleri ve üniversite-sanayi iş birliğini güçlendirebilecekleri ulusal/uluslararası bir zemin sağlamaktır. Kurultay konuları <a href=\"./#kulvarlar\">6 kulvar</a> altında organize edilmiştir.",
    hk022: "EV SAHİBİ ÜNİVERSİTE",
    hk023: "İstanbul Medipol Üniversitesi",
    hk024: "İstanbul Medipol Üniversitesi; çağdaş eğitim anlayışı, güçlü araştırma merkezleri (SABİTA, 6G ve Yapay Zekâ Laboratuvarları), teknoloji transfer ekosistemi ve uluslararası akademik kadrosuyla Türkiye'nin önde gelen yükseköğretim kurumlarındandır.",
    hk025: "Üniversite Web Sitesi",
    hk026: "Medipol Logosu (PNG)",
    hk027: "Kavacık Güney Kampüsü & Kongre Merkezi",
    hk027b: "Kampüs Sanal Turu",
    hk029: "GÖRSEL KİMLİK & AMBLEM",
    hk030: "SİU 2027 Resmî Logosu ve Anlamı",
    hk031: "SİU 2027 logosu; kurultayın temsil ettiği dört temel teknolojik sütunu görselleştirmektedir:",
    hk032: "<strong>Sinyal Dalgası (Sol):</strong> Klasik işaret işleme, biyomedikal sinyaller, RF dalgaları ve zaman serilerini ifade eder.",
    hk033: "<strong>İnsan Zihni ve Nöral Ağ (Merkez):</strong> Makine öğrenmesi, derin öğrenme, üretken yapay zekâ ve büyük dil modellerini (LLM) simgeler.",
    hk034: "<strong>Radyo Kulesi ve Dalgalar (Sağ):</strong> 5G/6G, uydu ağları, ISAC ve kablosuz telekomünikasyon altyapısını temsil eder.",
    hk035: "<strong>Yörünge Halkası ve Düğümler:</strong> 35 yıllık bilimsel ekosistemin sürekliliğini ve ağ bağlılığını simgeler.",
    hk036: "Yüksek Çözünürlüklü Logoyu İndir (PNG)",
    il001: "SEKRETERLİK BİLGİLERİ",
    il002: "İstanbul Medipol Üniversitesi Kavacık Güney Kampüsü",
    il003: "Kurultay Adresi",
    il004: "İstanbul Medipol Üniversitesi Kavacık Güney Kampüsü, Kongre ve Kültür Merkezi<br> Göztepe Mah. Atatürk Cad. No: 40/16, 34815 Beykoz / İstanbul",
    il005: "E-posta Adresi",
    il006: "Genel İletişim ve Kayıt: <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a>",
    il007: "Telefon & Çağrı Merkezi",
    il008: "+90 (216) 681 51 00 (Santral) • Dahili: Duyurulacaktır",
    il009: "Konum ve Otopark Bilgisi",
    il010: "Kampüs otoparkının kullanımına ilişkin bilgi duyurulacaktır. Navigasyon için: <em>\"İstanbul Medipol Üniversitesi Kavacık Güney Kampüsü\"</em>.",
    il011: "HIZLI DESTEK FORMU",
    il012: "Bize Mesaj Gönderin",
    il013: "Ad Soyad *",
    il014: "E-posta Adresi *",
    il015: "Kurum / Üniversite",
    il016: "Konu Başlığı *",
    il017: "Lütfen konu seçin...",
    il018: "CMT ve Bildiri Süreci Desteği",
    il019: "Kayıt ve Ücret İşlemleri",
    il020: "Özel Oturum Önerisi",
    il021: "Lisans Proje / Tez Yarışması",
    il022: "Sponsorluk ve Sergi Alanları",
    il023: "Diğer / Genel Soru",
    il024: "Mesajınız *",
    il025: "<a href=\"kvkk\">KVKK Aydınlatma Metni</a>'ni okudum; ad, soyad, e-posta ve kurum bilgilerimin talebimin karşılanması amacıyla işlenmesini kabul ediyorum. *",
    il026: "Mesajı E-posta ile Gönder",
    il027: "Gönder düğmesi, formu bilgisayarınızdaki e-posta uygulamasında hazır bir ileti olarak açar; iletiyi kendiniz göndermeniz gerekir. Dilerseniz doğrudan <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a> adresine yazabilirsiniz.",
    iletisimKicker: "DANIŞMA VE DESTEK",
    iletisimPageDesc: "SİU 2027 Düzenleme Kurulu, bildiri süreci, kayıt ve sponsorluk danışma masası ile doğrudan iletişim kurun.",
    iletisimPageTitle: "İletişim ve Sekreterlik",
    importantDatesDesc: "Özel oturum ve seminer davetlerinden baskıya hazır bildiriye kadar tüm aşamaların resmî takvimi.",
    importantDatesTitle: "Önemli Tarihler",
    ix008: "Bilgi Teorisi ve Kodlama",
    ix009: "İletişim Teorisi ve Uygulamaları",
    ix010: "Kablosuz İletişim ve Ağlar",
    ix011: "6G ve Ötesi Teknolojiler",
    ix012: "Nesnelerin İnterneti (IoT)",
    ix013: "Taşıtsal İletişim",
    ix014: "Görüntü ve Video İşleme",
    ix015: "Obje Algılama ve Desen Tanıma",
    ix016: "Çok Kanallı ve Çok Kameralı İşleme",
    ix017: "Görüntü/Video Kodlama ve Sıkıştırma",
    ix018: "Görüntü ve Video Tabanlı Biyometrik",
    ix019: "Belge Analizi ve Anlama",
    ix020: "Sinyal İşleme Teorisi",
    ix021: "İstatistiksel Sinyal İşleme",
    ix023: "Ses/Konuşma İşleme",
    ix024: "Radar Sinyal İşleme",
    ix026: "Makine Öğrenmesi Kuramı",
    ix027: "Derin Öğrenme",
    ix028: "Sağlık Uygulamaları için Makine Öğrenmesi",
    ix029: "İletişim Sistemleri için Makine Öğrenmesi",
    ix030: "Çok Modlu Analiz",
    ix031: "Pekiştirmeli Öğrenme",
    ix032: "Biyomedikal Sinyal Analizi",
    ix033: "Tıbbi Görüntü Analizi ve Uygulamaları",
    ix034: "Biyoinformatik ve Genomik Sinyal İşleme",
    ix035: "Giyilebilir Algılayıcılar ve E-Sağlık",
    ix036: "Biyomedikal Veri Gizliliği ve Güvenliği",
    ix037: "Sağlık İzleme için Biyosinyal İşleme",
    ix038: "Büyük Dil Modelleri ve Eğitim Stratejileri",
    ix039: "Yapay Zekâ ve Büyük Dil Modeli Ajanları",
    ix040: "Diyalog ve Etkileşimli Sistemler",
    ix041: "Bilgi Çıkarma ve Erişimi",
    ix042: "Dil Teorileri ve Bilişsel Modeller",
    ix043: "Tercüme ve Çoklu Dil İşleme",
    ix044: "Deniz, Hava ve Kara Robotları",
    ix045: "Endüstriyel Robotlar",
    ix046: "İnsansı ve Sosyal Robotlar",
    ix047: "Sürü Robotları",
    ix049: "Kontrol Algoritmaları",
    ix050: "Siber-Fiziksel Sistemler",
    ix051: "Bütünleşik Algılama ve İletişim",
    ix052: "Uydu ve Derin Uzay İletişimi",
    ix053: "Optik İletişim ve Ağlar",
    ix054: "Enerji Hasadı ve Düşük Güçlü İletişim",
    ix055: "İletişim ve Ağlarda Güvenlik ve Gizlilik",
    ix056: "Dijital İkiz Çözümleri",
    ix057: "Moleküler ve Nano İletişim",
    ix058: "Kuantum İletişim",
    ix059: "Bilgi Yaşı ve Değeri",
    ix060: "İşbirlikli İletişim ve Ağlar",
    ix061: "Enerji Verimli ve Yeşil Ağlar",
    ix062: "Holografik Yüzeyler ve MIMO",
    ix063: "Uç Bilişim, Uç Zekâsı ve Sis Ağları",
    ix064: "Milimetre Dalgalar ve Terahertz İletişim",
    ix065: "Ağ Güvenliği ve Mahremiyet",
    ix066: "Fiziksel Katman Güvenliği",
    ix067: "Özkaynak Tahsisi",
    ix068: "Yazılım Tabanlı Ağlar, Ağ Fonksiyonlarını Sanallaştırma",
    ix069: "Semantik ve Hedef Odaklı İletişim",
    ix070: "İnsansız Hava Araçları ve Karasal Olmayan İletişim",
    ix071: "Telsiz Güç ve Bilgi Transferi",
    ix072: "Telsiz Ağlar",
    ix073: "Geri Saçılım ve Akıllı Yansıtıcı Yüzeyler Aracılığı ile İletişim",
    ix074: "Uzaktan Algılama ve Coğrafi Analiz",
    ix075: "3B Görüntü ve Hesaplamalı Fotoğrafçılık",
    ix076: "Siber Güvenlik Uygulamaları için Sinyal İşleme",
    ix077: "Otonom Sistemler için Sinyal İşleme",
    ix078: "İnsan-Bilgisayar Etkileşimi ve Davranış Analizi",
    ix079: "Endüstriyel ve Otomotiv Uygulamaları",
    ix080: "Gerçek Zamanlı Sinyal İşleme ve Gömülü Sistemler",
    ix081: "E-Sağlık Uygulamaları ve Destekleyici Teknolojiler",
    ix082: "Finansal Sinyal İşleme",
    ix083: "Robotik ve Otomasyon",
    ix084: "İşaret/İmge İşleme Uygulamaları için Makine Öğrenmesi, Derin Öğrenme",
    ix085: "Açıklanabilir Yapay Zekâ ve Güvenilir Makine Öğrenmesi",
    ix086: "Çekişmeli Öğrenme ve Dayanıklı Yapay Zekâ",
    ix087: "Aktarmalı, Yarı-Gözetmenli ve Gözetimsiz Öğrenme",
    ix088: "Makine Öğrenmesi Tekniklerinin Başarım Analizi",
    ix089: "Denetimsiz ve Üretken Modeller",
    ix090: "Biyometrik Sinyal İşleme",
    ix091: "Tıbbi Tanıda Yapay Zekâ Uygulamaları",
    ix092: "Tele-Tıp ve Uzaktan Hasta Takibi",
    ix093: "Nöromühendislik ve Beyin Sinyali İşleme",
    katilimKicker: "KATILIMCI KILAVUZU & KAYIT",
    katilimPageDesc: "Kayıt ücretleri, erken kayıt avantajları, konaklama alternatifleri, İstanbul Medipol Kavacık Kampüsü ulaşım krokisi ve Sıkça Sorulan Sorular.",
    katilimPageTitle: "Katılım ve Kayıt",
    keyDateSub: "Yüz Yüze • 4 Günlük Program",
    keyDateTitle: "Kurultay Tarihi",
    keyDateVal: "4–7 Temmuz 2027",
    keyDeadlineTitle: "Bildiri Son Tarihi",
    keyDeadlineVal: "1 Şubat 2027",
    keyLocationTitle: "Kurultay Yeri",
    keynotesDesc: "SİU 2027 kapsamında planlanan davetli konuşmalar ve konuşmacılar, davetler teyit edildikçe duyurulacaktır.",
    keynotesPendingNote: "Konuşmacılar <a href=\"program#konusmacilar\">burada</a> duyurulacaktır.",
    keynotesPendingTitle: "Davetli konuşmacılar henüz kesinleşmemiştir.",
    keynotesTitle: "Davetli Konuşmacılar",
    km001: "Kurultay Eş Başkanları",
    km002: "Kurultay Eş Başkanı",
    km003: "Kurultay Eş Başkanı",
    km004: "Teknik Program Komitesi Eş Başkanları",
    km005: "TPC Eş Başkanı",
    km006: "TPC Eş Başkanı",
    km007: "TPC Eş Başkanı",
    km008: "Düzenleme Kurulu & Görev Dağılımı",
    km009: "Özel Oturumlar Başkanı",
    km010: "Özel Oturumlar Başkanı",
    km011: "Eğitim Seminerleri Başkanı",
    km012: "Eğitim Seminerleri Başkanı",
    km013: "Davetli Konuşmacılar Başkanı",
    km014: "Endüstri İlişkileri ve Sponsorluklar Başkanı",
    km015: "Endüstri İlişkileri ve Sponsorluklar Başkanı",
    km016: "Yayınlar Başkanı",
    km017: "Multimedya Yayınları Başkanı (Tanıtım ve Medya)",
    km018: "Sosyal Etkinlikler Başkanı",
    km019: "Doktora Öğrencileri Komisyonu",
    km020: "Belirlenecektir",
    km021: "Yakında ilan edilecektir",
    km022: "Onur Kurulu",
    km023: "Onur Kurulu Üyesi",
    kma01: "İstanbul Medipol Üniversitesi",
    kma02: "Orta Doğu Teknik Üniversitesi (ODTÜ)",
    kma03: "Bilkent Üniversitesi",
    kma04: "Bilkent Üniversitesi",
    kma05: "Bilkent Üniversitesi / UMRAM",
    kma06: "Türk Telekom",
    kma07: "Boğaziçi Üniversitesi",
    kma08: "TÜBİTAK BİLGEM / Medipol Üniv.",
    kma09: "İstanbul Teknik Üniversitesi (İTÜ)",
    kma10: "Orta Doğu Teknik Üniversitesi (ODTÜ)",
    kma11: "İstanbul Medipol Üniversitesi",
    kma12: "İstanbul Medipol Üniversitesi",
    kma13: "İstanbul Üniv. - Cerrahpaşa",
    kma14: "Orta Doğu Teknik Üniversitesi (ODTÜ)",
    kma15: "Orta Doğu Teknik Üniversitesi (ODTÜ)",
    kma16: "Boğaziçi Üniversitesi",
    kma17: "Boğaziçi Üniversitesi",
    kma18: "Bilkent Üniversitesi",
    kma19: "Sabancı Üniversitesi",
    kma20: "Orta Doğu Teknik Üniversitesi (ODTÜ)",
    komitelerKicker: "ORGANİZASYON VE BİLİMSEL LİDERLİK",
    komitelerPageDesc: "SİU 2027 Kurultay Eş Başkanları, Teknik Program Komitesi Eş Başkanları, Düzenleme Kurulu ve Onur Kurulu.",
    komitelerPageTitle: "Kurultay Komiteleri",
    kt001: "Katılım Menüsü",
    kt002: "• Kayıt ve Ücretler",
    kt003: "• Kayıt Kapsamı",
    kt004: "• Konaklama Seçenekleri",
    kt005: "• Ulaşım ve Harita",
    kt006: "• Sıkça Sorulan Sorular",
    kt007: "KAYIT TARİFELERİ",
    kt008: "Kayıt Ücretleri",
    kt011: "Erken Kayıt (Tam)",
    kt012: "Akademisyen ve sektör araştırmacıları",
    kt014: "1 Adet Bildiri Sunum Hakkı",
    kt015: "Tüm Bilimsel Oturumlara Erişim",
    kt016: "Kurultay Çantası & Bildiri Belleği",
    kt017: "Öğle Yemekleri & Kahve Molaları",
    kt019: "Hemen Kayıt Ol",
    kt020: "Normal Kayıt (Tam)",
    kt022: "Normal & Kurultay Alanında Kayıt",
    kt023: "1 Adet Bildiri Sunum Hakkı",
    kt024: "Tüm Bilimsel Oturumlara Erişim",
    kt025: "Kurultay Çantası & Dokümanlar",
    kt026: "Öğle Yemekleri & Kahve İkramları",
    kt028: "Hemen Kayıt Ol",
    kt029: "Öğrenci Yazar Kaydı",
    kt030: "Yazar veya sunucusu öğrenci olanlar",
    kt032: "1 Adet Bildiri Sunum Hakkı",
    kt033: "Tüm Oturumlar ve Seminerler",
    kt034: "Öğle Yemekleri & Kahve Molaları",
    kt035: "Katılım Sertifikası",
    kt037: "Öğrenci Kaydı Yap",
    kt038: "Lisans Dinleyici Kaydı",
    kt039: "Bildirisi olmayan lisans öğrencileri",
    kt042: "Tüm Oturumlara Dinleyici Erişimi",
    kt043: "Eğitim Seminerleri (Tutorials)",
    kt044: "Kahve Molaları ve İkramlar",
    kt045: "Dijital Katılım Belgesi",
    kt046: "(Bildiri sunumu & gala yemeği hariçtir)",
    kt047: "Kayıt Ol",
    kp01: "1 adet bildiri sunumu",
    kp02: "Hoş geldin resepsiyonu",
    kp03: "Gala yemeği",
    kp04: "Tüm konferans oturumlarına katılım",
    kp05: "Kahve molalarındaki ikramlar",
    kp06: "Öğle yemekleri",
    kp10: "Sosyal gezi programlarına katılım",
    kp11: "Konferans malzemeleri",
    kp12: "Katılım belgesi",
    kt048: "Tüm Kayıt Kategorileri ve Ücret Tablosu",
    kt049: "Kayıt Kategorisi",
    kt051: "Normal & Yerinde Kayıt",
    kt052: "Kapsam ve Haklar",
    kt053: "Tam Kayıt (Akademisyen / Sektör)",
    kt054: "1 Bildiri sunumu, tüm bilimsel oturumlar, öğle yemekleri, ikramlar, çanta, Boğaz turu & Gala yemeği.",
    kt055: "Öğrenci Yazar Kaydı",
    kt057: "Lisansüstü Dinleyici Kaydı",
    kt058: "Bildirisiz lisansüstü dinleyici, tüm oturumlar, seminerler, öğle yemekleri ve kahve ikramları.",
    kt059: "Lisans Öğrenci Dinleyici Kaydı (Ücretsiz / Sembolik)",
    kt061: "Bildirisi olmayan lisans öğrencilerine oturumları ve posterleri dinleme, seminerlere katılma, ikramlar ve dijital sertifika hakkı.",
    kt062: "Ek Bildiri Ücreti (Aynı Yazar)",
    kt063: "İlk bildirisi tam/öğrenci kaydıyla karşılanmış yazarın 2. ve sonraki bildirileri için.",
    kt064: "Gala Yemeği Bileti (İlave / Misafir)",
    kt065: "Öğrenci veya dinleyicilerin katılabileceği Boğaz turu ve akşam kurultay galası.",
    kt066: "ÖNEMLİ KOŞULLAR",
    kt067: "Kayıt Kapsamı ve Ödeme Koşulları",
    kt070: "Tabloda yer alan tüm kayıt ücretleri <strong>KDV dâhil</strong> tutarlardır.",
    kt071: "Ödemeler, üniversite döner sermayesi üzerinden 3D Secure kredi kartı veya banka havalesi ile yapılabilir. Fatura talepleri kayıt ekranında toplanır.",
    kt074: "KONAKLAMA",
    kt075: "Konaklama Seçenekleri",
    kt076: "Kurultay katılımcılarımız için Kavacık çevresindeki konaklama seçenekleri burada duyurulacaktır.",
    kt077: "İstanbul Medipol Üniversitesi Kavacık Öğrenci Yurtları & Konukevi",
    kt078: "BÜTÇE DOSTU SEÇENEK",
    kt080: "<em><strong>Not:</strong> SİU 2027 Seyahat ve Konaklama Destek Bursu kazanan öğrencilere yurt konaklaması <strong>ücretsiz</strong> olarak sağlanacaktır.</em>",
    kt081: "Başvuru & Rezervasyon: Kontenjan sınırlı olup <a href=\"mailto:siu2027@medipol.edu.tr?subject=SİU%202027%20Yurt%20Konaklama%20Talebi\">siu2027@medipol.edu.tr</a> adresine e-posta ile başvurulabilir.",
    kt082: "Kampüs çevresindeki konaklama tesisleri aşağıda listelenmiştir. Mesafeler, Kavacık Güney Yerleşkesi'ne kuş uçuşu uzaklıktır.",
    kt083: "Harita verileri © <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a> katkıcıları (ODbL). Harita açıldığında karo görselleri OpenStreetMap sunucularından yüklenir.",
    kt084: "Limak Eurasia Luxury Hotel",
    kt085: "5 yıldızlı • Kampüse ~0,9 km",
    kt086: "Bilek Hotel Istanbul",
    kt087: "Kavacık • Kampüse ~0,7 km",
    kt088: "Park Inn by Radisson Istanbul Asia Kavacık",
    kt089: "Kavacık • Kampüse ~1,2 km",
    kt090: "A'ija Hotel",
    kt091: "Kanlıca • Kampüse ~2,6 km",
    kt092: "<strong>Not:</strong> Kurultaya özel anlaşmalı oda fiyatları ve rezervasyon kodları henüz tanımlanmamıştır. Anlaşmalar tamamlandığında ücretler ve indirim kodları bu bölümde duyurulacaktır. Listeleme, ilgili tesislerle bir iş birliği bulunduğu anlamına gelmez.",
    kt092a: "Kurultaya özel anlaşmalı oda fiyatları ve rezervasyon kodları henüz tanımlanmamıştır. Anlaşmalar tamamlandığında ücretler bu bölümde duyurulacaktır.",
    kt093: "KAMPÜSE ERİŞİM",
    kt094: "Ulaşım ve Kampüs Haritası",
    kt095: "İstanbul Medipol Üniversitesi Kavacık Güney Kampüsü, Fatih Sultan Mehmet (FSM) Köprüsü Anadolu yakası ayağında stratejik bir konumda yer almaktadır:",
    kt099: "SIK SORULAN SORULAR",
    kt100: "Sıkça Sorulan Sorular (SSS)",
    kt101: "Bir kayıtla en fazla kaç bildiri sunulabilir?",
    kt102: "Her tam veya öğrenci kaydı 1 adet bildirinin sunumunu ve Kurultay Bildiriler Kitabı'na gönderimini kapsar. Aynı yazarın 2. bildirisi için ek bildiri ücreti ödenmelidir.",
    kt105: "Kayıt ücreti faturası kuruma kesilebilir mi?",
    kt106: "Evet. Kayıt adımı sırasında kurumsal fatura seçeneğini işaretleyerek üniversite veya kurumunuzun vergi numarası ve fatura unvanını girebilirsiniz.",
    kt107: "Google Haritalar'da yol tarifi al",
    kt108: "OpenStreetMap'te aç",
    kt109: "Mavi noktalar kampüse yürüme mesafesindeki otobüs duraklarını gösterir. Harita verileri © OpenStreetMap katkıcıları (ODbL).",
    kv001: "Aydınlatma Metni",
    kv002: "6698 sayılı Kişisel Verilerin Korunması Kanunu (\"KVKK\") uyarınca, SİU 2027 Kurultayı kapsamında toplanan kişisel verilere ilişkin aydınlatma yükümlülüğümüz aşağıda yerine getirilmektedir.",
    kv003: "1. Veri Sorumlusu",
    kv004: "Veri sorumlusu, SİU 2027 Kurultayı'na ev sahipliği yapan <strong>İstanbul Medipol Üniversitesi</strong>'dir. Adres: Göztepe Mah. Atatürk Cad. No: 40/16, 34815 Beykoz / İstanbul. İletişim: <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a>",
    kv005: "2. İşlenen Kişisel Veriler",
    kv006: "<strong>Kimlik ve iletişim verileri:</strong> ad, soyad, e-posta adresi, telefon numarası.",
    kv007: "<strong>Mesleki veriler:</strong> çalışılan kurum/üniversite, unvan, bölüm.",
    kv008: "<strong>Bildiri ve başvuru verileri:</strong> bildiri başlığı, özet, yazar listesi, bildiri numarası.",
    kv009: "<strong>Kayıt ve ödeme verileri:</strong> kayıt kategorisi, fatura bilgileri, ödeme işlem kaydı. Kredi kartı bilgileri Üniversite tarafından saklanmaz; ödeme, lisanslı ödeme kuruluşu altyapısı üzerinden alınır.",
    kv010: "<strong>Destek başvurusu verileri:</strong> seyahat/kayıt desteği başvurularında öğrenci belgesi ve referans yazısı.",
    kv011: "3. İşleme Amaçları",
    kv012: "Bildiri gönderim, hakem değerlendirme ve bilimsel program süreçlerinin yürütülmesi,",
    kv013: "Kurultay kaydı, ödeme, faturalandırma ve katılım belgesi işlemlerinin tamamlanması,",
    kv014: "Katılımcılara kurultaya ilişkin duyuru ve bilgilendirmelerin iletilmesi,",
    kv015: "Kabul edilen bildirilerin Bildiriler Kitabı ve IEEE Xplore Dijital Kütüphanesi'nde yayımlanması,",
    kv016: "İletişim formu ve e-posta yoluyla iletilen talep ve şikâyetlerin karşılanması,",
    kv017: "Yasal saklama, raporlama ve denetim yükümlülüklerinin yerine getirilmesi.",
    kv018: "4. Hukuki Sebep ve Toplama Yöntemi",
    kv019: "Kişisel veriler; kurultay web sitesi, iletişim formu, e-posta, Microsoft CMT bildiri yönetim sistemi ve çevrim içi kayıt sistemi aracılığıyla elektronik ortamda toplanmaktadır. İşleme, KVKK m.5/2 uyarınca <em>sözleşmenin kurulması veya ifası için gerekli olması</em>, <em>hukuki yükümlülüğün yerine getirilmesi</em> ve <em>veri sorumlusunun meşru menfaati</em> hukuki sebeplerine; bunların dışında kalan hâllerde ise <em>açık rızanıza</em> dayanmaktadır.",
    kv020: "5. Aktarım",
    kv021: "Kişisel veriler; bildiri değerlendirme sürecinin yürütülmesi amacıyla hakemlere ve bildiri yönetim sistemi sağlayıcısına, yayın süreci kapsamında IEEE'ye, ödeme sürecinde ödeme kuruluşuna ve talep hâlinde yetkili kamu kurum ve kuruluşlarına, KVKK m.8 ve m.9'daki şartlara uygun olarak aktarılabilir. IEEE Xplore ve bildiri yönetim sistemi yurt dışı kaynaklı hizmetler olduğundan, bu kapsamda yurt dışına aktarım söz konusu olabilmektedir.",
    kv022: "6. Saklama Süresi",
    kv023: "Veriler, ilgili mevzuatta öngörülen süreler ile kurultay ve yayın süreçlerinin gerektirdiği süre boyunca saklanır; bu sürelerin sonunda silinir, yok edilir veya anonim hâle getirilir. Yayımlanan bildirilerdeki yazar bilgileri, bilimsel kayıt niteliği gereği kalıcı olarak arşivde tutulur.",
    kv024: "7. İlgili Kişinin Hakları",
    kv025: "KVKK m.11 uyarınca; kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmiş olması hâlinde düzeltilmesini isteme, silinmesini veya yok edilmesini isteme, bu işlemlerin aktarıldığı üçüncü kişilere bildirilmesini isteme, münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme ve zarara uğramanız hâlinde zararın giderilmesini talep etme haklarına sahipsiniz.",
    kv026: "Taleplerinizi <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a> adresine veya Üniversitenin yukarıdaki posta adresine iletebilirsiniz. Başvurular en geç otuz gün içinde sonuçlandırılır.",
    kv027: "8. Çerezler",
    kv028: "Bu web sitesi reklam veya izleme çerezi kullanmamaktadır. Yalnızca dil tercihinizi hatırlamak amacıyla tarayıcınızın yerel depolama alanı (<code>localStorage</code>) kullanılır; bu veri sunucuya gönderilmez ve tarayıcı ayarlarınızdan silinebilir.",
    kv029: "Katılım sayfasının Ulaşım bölümündeki kampüs haritası ile Arşiv sayfasındaki harita, OpenStreetMap projesinin açık karo (tile) sunucularından görsel çeker. Bu sırada tarayıcınızın IP adresi ilgili sunuculara iletilir; çerez kullanılmaz. Harita kitaplığı (Leaflet) üçüncü taraf bir sunucudan değil, doğrudan bu web sitesinden sunulmaktadır.",
    kv030: "9. Erişilebilirlik",
    kv031: "SİU 2027 web sitesi, WCAG 2.1 AA ölçütleri ve Kamu İnternet Siteleri Rehberi doğrultusunda geliştirilmektedir: anlamsal HTML yapısı, klavye ile tam gezinme, görünür odak göstergeleri, tüm görsellerde alternatif metin ve hareket duyarlılığı olan kullanıcılar için animasyon azaltma desteği sağlanmaktadır. Erişilebilirlikle ilgili bir sorun tespit ederseniz <a href=\"mailto:siu2027@medipol.edu.tr?subject=Eri%C5%9Filebilirlik%20Geri%20Bildirimi\">siu2027@medipol.edu.tr</a> adresinden bildirebilirsiniz.",
    kv032: "Bu metin bilgilendirme amaçlıdır ve yayımlanmadan önce İstanbul Medipol Üniversitesi Hukuk Müşavirliği / KVKK birimi tarafından onaylanmalıdır.",
    mobileMenuLang: "DİL SEÇİMİ",
    navAbout: "Kurultay Hakkında",
    navAboutHistory: "SİU Tarihçesi (1993–2027)",
    navAboutHost: "Ev Sahibi Kurum",
    navAboutMsg: "Hoş Geldiniz Mesajı",
    navAboutScope: "Kapsam ve Amaç",
    navArchive: "Arşiv",
    navAuthors: "Yazarlar İçin",
    navAuthorsCamera: "Baskıya Hazır Bildiri & Telif",
    navAuthorsCfp: "Bildiri Çağrısı (CFP)",
    navAuthorsSpecial: "Özel Oturum Çağrısı",
    navAuthorsTemplates: "Bildiri Şablonları",
    navAuthorsTracks: "Konular ve Kulvarlar",
    navCommittees: "Komiteler",
    navCompetitions: "Yarışmalar & Destek",
    navCompetitionsThesis: "5 Dakikalık Tez Yarışması",
    navCompetitionsTravel: "Öğrenci Seyahat/Kayıt Desteği",
    navCompetitionsUndergrad: "Lisans Proje Yarışması",
    navContact: "İletişim",
    navHome: "Ana Sayfa",
    navProgram: "Program",
    navProgramDetail: "Ayrıntılı Bilimsel Program",
    navProgramOverview: "Bir Bakışta Program",
    navProgramSocial: "Sosyal Program & Gala",
    navProgramSpeakers: "Davetli Konuşmacılar (Keynotes)",
    navProgramTutorials: "Eğitim Seminerleri",
    navProgramPanels: "Paneller",
    navQuickSubmit: "Bildiri Gönderimi",
    navRegistration: "Katılım & Kayıt",
    navRegistrationAccom: "Konaklama",
    navRegistrationFaq: "Sıkça Sorulan Sorular",
    navRegistrationFees: "Kayıt ve Ücretler",
    navRegistrationTravel: "Ulaşım ve Kampüs Haritası",
    newsDesc4: "Öğrencilere verilecek seyahat, konaklama vb. destekler duyurulacaktır.",
    newsTag4: "ÖĞRENCİ DESTEK",
    newsTitle4: "Öğrenci Destekleri",
    newsTag5: "ÖZEL OTURUM",
    newsTitle5: "Özel Oturum Çağrısı: Öneriler 16 Kasım 2026'ya Kadar",
    newsDesc5: "SİU 2027 kapsamında güncel ve özelleşmiş araştırma başlıklarında özel oturumlar düzenlenecektir. Öneri dosyaları en geç 16 Kasım 2026 tarihine kadar siu2027@medipol.edu.tr adresine iletilmelidir; kabul edilen oturumlar 30 Kasım 2026 tarihine kadar bildirilecektir.",
    nf001: "HATA 404",
    nf002: "Aradığınız sayfa bulunamadı",
    nf003: "Bağlantı taşınmış, adı değişmiş veya adres yanlış yazılmış olabilir. Aşağıdaki başlıklardan devam edebilirsiniz.",
    nf004: "<a href=\"/siu2027/\" class=\"btn btn--primary\">Ana Sayfa</a> <a href=\"/siu2027/yazarlar#cfp\" class=\"btn\">Bildiri Çağrısı</a> <a href=\"/siu2027/program\" class=\"btn\">Bilimsel Program</a> <a href=\"/siu2027/katilim#kayit\" class=\"btn\">Kayıt ve Ücretler</a> <a href=\"/siu2027/iletisim\" class=\"btn\">İletişim</a>",
    nf005: "Sorun devam ederse <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a> adresine bildirebilirsiniz.",
    pr001: "BİR BAKIŞTA PROGRAM",
    pr029: "Oturum Takvimi",
    pr072: "DAVETLİ KONUŞMACILAR (KEYNOTE SPEAKERS)",
    pr073: "Davetli Konuşmacılar",
    pr074: "Davetli konuşmacılar burada duyurulacaktır.",
    pr076: "EĞİTİM SEMİNERLERİ (TUTORIAL)",
    pr077: "Eğitim Seminerleri",
    pr078a: "Seminer gün ve saatleri duyurulacaktır.",
    pr078b: "Paneller",
    pr078c: "Paneller burada duyurulacaktır.",
    pr079: "SEMİNER ÇAĞRISI",
    pr080: "Eğitim Semineri (Tutorial) Önerileri",
    pr081: "Yarım günlük (3 saat) seminer önerileri; başlık, kapsam özeti, hedef kitle ve eğitmen özgeçmişlerini içerecek biçimde Kurultay Sekreterliği'ne iletilebilir.",
    pr082: "ÖNERİ GÖNDER",
    pr083: "PANEL ÇAĞRISI",
    pr084: "Sanayi ve Savunma Panelleri",
    pr085: "Üniversite–sanayi iş birliği, 6G, otonom sistemler ve savunma teknolojileri başlıklarında panel önerileri değerlendirmeye alınmaktadır.",
    pr086: "ÖNERİ GÖNDER",
    pr087: "SOSYAL ETKİNLİKLER",
    pr088a: "Sosyal program burada duyurulacaktır.",
    programKicker: "KURULTAY TAKVİMİ & OTURUMLAR",
    programPageDesc: "Genel akış, oturum takvimi, davetli konuşmacılar, eğitim seminerleri ve sosyal program.",
    programPageTitle: "Kurultay Programı",
    readMore: "DEVAMINI OKU",
    searchPlaceholder: "SİU 2027'de arayın (bildiri, şablon, kayıt, program)...",
    speakersKicker: "BİLİMSEL VİZYON",
    sponsorsCta: "Sponsorluk için iletişime geçin",
    sponsorsPending: "Teknik sponsorluk, kurumsal sponsorluk ve sergi alanı başlıkları henüz kesinleşmemiştir. Destekçi kuruluşlar teyit edildikçe bu bölümde duyurulacaktır.",
    sponsorsTierHost: "EV SAHİBİ VE DÜZENLEYEN KURULUŞLAR",
    sponsorsTierTech: "TEKNİK SPONSORLUK",
    tba101: "SİU 2027, 4–7 Temmuz 2027 tarihleri arasında dört gün sürecektir.",
    tba102: "Günlük program akışı — Duyurulacaktır",
    tba103: "Açılış oturumu, paralel oturumlar, poster oturumu, paneller ve kapanış törenine ilişkin günlük akış ve saatler, bilimsel program kesinleştikçe bu sayfada yayımlanacaktır.",
    tba104: "AYRINTILI BİLİMSEL PROGRAM",
    tba105: "Oturum çizelgesi — Duyurulacaktır",
    tba107: "BİLDİRİ ÇAĞRISINA GİT",
    tba109: "Sosyal Program",
    tba110: "Kurultay kapsamında bir gala yemeği ve sosyal etkinlik programı planlanmaktadır. Etkinliklerin içeriği, tarihi ve yeri kesinleştiğinde bu bölümde ve kurultay duyurularında ilan edilecektir.",
    tba201: "Duyurulacaktır",
    tba202: "Ücretler kesinleştiğinde duyurulacaktır",
    tba203: "Gala yemeği bileti: Duyurulacaktır",
    tba204: "1 Bildiri sunumu (sunucu öğrenci), tüm oturumlar, öğle yemekleri, ikramlar, sertifika. (Gala bileti opsiyonel.)",
    tba205: "Bir tam veya öğrenci kaydı ile en fazla bir (1) bildiri sunulabilir. Aynı yazarın kabul edilen ikinci bildirisi için indirimli ek bildiri tescil ücreti uygulanır; tutar ücret tablosunda duyurulacaktır.",
    tba206: "Sosyal program (Duyurulacaktır)",
    tba207: "<strong>Kayıt ücretleri henüz kesinleşmemiştir.</strong> Tutarlar Üniversite tarafından onaylandıktan sonra bu tabloda yayımlanacaktır.",
    tba208: "<strong>İstanbul Havalimanı (İST):</strong> HAVAİST havalimanı otobüsleri ile Kavacık aktarmalı ulaşım sağlanmaktadır. Güncel hat ve sefer bilgileri için <a href=\"https://hava.ist\" target=\"_blank\" rel=\"noopener\">hava.ist</a>.",
    tba209: "<strong>Sabiha Gökçen Havalimanı (SAW):</strong> HAVABÜS hatları veya İETT otobüsleriyle Kadıköy / Levent üzerinden Kavacık aktarması yapılabilmektedir.",
    tba210: "<strong>Toplu Taşıma:</strong> Kavacık, İstanbul'un her iki yakasından İETT otobüsleriyle ulaşılabilen bir aktarma noktasıdır. Kampüse yürüme mesafesindeki duraklar aşağıdaki haritada işaretlenmiştir; güncel hat numaraları için <a href=\"https://iett.istanbul\" target=\"_blank\" rel=\"noopener\">iett.istanbul</a> veya harita uygulamalarını kullanınız.",
    tba211: "<strong>Kampüs içi:</strong> Özellikle öğrenciler, lisansüstü araştırmacılar ve bütçe dostu konaklama arayan katılımcılarımız için Kavacık Güney Yerleşkesi bünyesindeki Medipol öğrenci yurtları ve misafirhanesinden yararlanılması planlanmaktadır. Kontenjan, ücretlendirme ve oda olanakları kesinleştiğinde duyurulacaktır.",
    tba301: "Ödül tutarları kesinleştiğinde duyurulacaktır.",
    tba401: "Açılış Oturumu: <strong>4 Temmuz 2027</strong> • Saat: Duyurulacaktır",
    tba501: "Kurultay etkinlikleri, Kavacık Güney Yerleşkesi bünyesindeki Kongre ve Kültür Merkezi'nde; ana konferans amfisi, paralel oturum salonları ve poster fuayesinde gerçekleştirilecektir. Salon dağılımı ve kapasiteler program kesinleştiğinde duyurulacaktır. Fatih Sultan Mehmet Köprüsü çıkışında yer alan kampüs, İstanbul'un her iki yakasından kolay ulaşım imkânı sağlamaktadır.",
    theLatestKicker: "DUYURULAR",
    topbarDate: "4–7 Temmuz 2027 | İstanbul",
    topbarSearchBtn: "Arama",
    track1Title: "İletişim ve Ağlar",
    track2Title: "Görüntü İşleme ve Bilgisayarlı Görü",
    track3Title: "Sinyal İşleme ve Robotik",
    track4Title: "Makine Öğrenmesi ve Yapay Zekâ",
    track6Title: "Doğal Dil İşleme",
    track5Title: "Biyomedikal Sinyal/Görüntü İşleme",
    trackNum1: "KULVAR 1",
    trackNum2: "KULVAR 2",
    trackNum3: "KULVAR 3",
    trackNum4: "KULVAR 4",
    trackNum5: "KULVAR 5",
    trackNum6: "KULVAR 6",
    tracksKicker: "TEKNİK PROGRAM VE KAPSAM",
    tracksTitle: "Konular ve Araştırma Kulvarları",
    ttl404: "Sayfa Bulunamadı (404) | IEEE SİU 2027",
    ttlArsiv: "SİU Kurultay Arşivi 1993–2027 | IEEE SİU 2027",
    ttlHakkinda: "Kurultay Hakkında | IEEE SİU 2027 — İstanbul Medipol Üniversitesi",
    ttlIletisim: "İletişim ve Kurultay Sekreterliği | IEEE SİU 2027",
    ttlIndex: "IEEE SİU 2027 | 35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı",
    ttlKatilim: "Katılım ve Kayıt: Ücretler, Konaklama, Ulaşım | IEEE SİU 2027",
    ttlKomiteler: "Komiteler ve Düzenleme Kurulu | IEEE SİU 2027",
    ttlKayit: "Kayıt Formu | IEEE SİU 2027",
    ttlKvkk: "KVKK Aydınlatma Metni | IEEE SİU 2027",
    ttlProgram: "Bilimsel Program ve Oturumlar | IEEE SİU 2027",
    ttlYarisma: "Yarışmalar ve Öğrenci Destekleri | IEEE SİU 2027",
    ttlYazarlar: "Yazarlar İçin: Bildiri Çağrısı ve Şablonlar | IEEE SİU 2027",
    viewAllNews: "Tüm Duyurular",
    yarismaKicker: "GENÇ ARAŞTIRMACI VE ÖĞRENCİ PROGRAMLARI",
    yarismaPageDesc: "Lisans Proje Yarışması (LİSPO), 5 Dakikalık Tez Yarışması (5DTY) ve SİU 2027 Öğrenci Seyahat & Kayıt Destek Fonu.",
    yarismaPageTitle: "Yarışmalar ve Destekler",
    yazarlarKicker: "YAZAR YÖNERGELERİ & BİLDİRİ SÜRECİ",
    yazarlarPageDesc: "Bildiri çağrısı (CFP), Microsoft CMT gönderim sistemi, standart çift sütun şablonlar, çift kör değerlendirme politikası ve özel oturum önerileri.",
    yazarlarPageTitle: "Yazarlar İçin",
    yr001: "Yarışma Başlıkları",
    yr002: "• Lisans Proje Yarışması",
    yr003: "• 5 Dakikalık Tez Yarışması",
    yr004: "• Seyahat & Kayıt Desteği",
    yr005: "LİSANS DÜZEYİ BİTİRME VE ARAŞTIRMA PROJELERİ",
    yr006: "SİU Lisans Proje Yarışması (LİSPO 2027)",
    yr007: "LİSPO, Türkiye ve KKTC üniversitelerinin Elektrik-Elektronik, Haberleşme, Bilgisayar, Biyomedikal ve Yapay Zekâ Mühendisliği lisans öğrencilerinin bitirme veya araştırma projelerini ödüllendirmek ve sanayiyle buluşturmak amacıyla düzenlenmektedir.",
    yr008: "LİSPO 2027 Ödülleri",
    yr009: "BİRİNCİLİK ÖDÜLÜ",
    yr010: "İKİNCİLİK ÖDÜLÜ",
    yr011: "ÜÇÜNCÜLÜK ÖDÜLÜ",
    yr012: "Başvuru Koşulları:",
    yr013: "Başvuru sahipleri, 2026–2027 akademik yılında üniversitelerin ilgili lisans programlarına kayıtlı olmalıdır.",
    yr014: "En fazla 4 sayfadan oluşan proje bildirisi ve 2 dakikalık video tanıtımı sisteme yüklenmelidir.",
    yr015: "Ön elemeyi geçen projeler kurultay alanında poster ve çalışan prototip sergisiyle jüriye sunulacaktır.",
    yr017: "LİSANSÜSTÜ TEZ SUNUMLARI",
    yr018: "5 Dakikalık Tez Yarışması (5DTY 2027)",
    yr019: "Yüksek Lisans ve Doktora öğrencilerinin, tez konularını tek bir statik slayt eşliğinde yalnızca 5 dakika içinde geniş dinleyici kitlesine ve değerlendirme jürisine etkili biçimde aktarmasını amaçlayan dinamik bir bilimsel iletişim yarışmasıdır.",
    yr020: "Yarışma Formatı & Kriterleri:",
    yr021: "Süre kesin olarak 5 dakikadır (aşım durumunda ses kesilir).",
    yr022: "Yalnızca tek bir statik slayt kullanılabilir (animasyon ve ses kaydı yasaktır).",
    yr023: "Değerlendirme: Bilimsel derinlik, toplumsal etki, sunum yeteneği ve zaman yönetimi.",
    yr024: "Doktora ve Yüksek Lisans kategorilerinde ayrı ayrı ödüller verilecektir.",
    yr025: "KURULTAY ÖĞRENCİ DESTEK FONU",
    yr026: "Öğrenci Seyahat ve Kayıt Desteği",
    yr027: "İstanbul Medipol Üniversitesi katkılarıyla, İstanbul dışından gelerek kabul edilen bildirisini sözlü veya poster olarak sunacak ihtiyaç sahibi lisans ve lisansüstü öğrencilere <strong>ulaşım ve ücretsiz kayıt desteği</strong> sağlanacaktır.",
    yr028: "Başvuru Belgeleri:",
    yr029: "Kabul edilmiş bildiri numarası (Paper ID) ve kabul mektubu",
    yr030: "Danışman öğretim üyesinden referans ve destek talep yazısı",
    yr031: "Güncel öğrenci belgesi",
    yr032: "Kısa niyet mektubu ve tahmini bütçe özeti",
    yr033: "Seyahat Desteği Başvuru E-postası Gönder",
    yz001: "Yazar Kılavuzu",
    yz002: "• Bildiri Çağrısı (CFP)",
    yz003: "• Konular ve Kulvarlar (6 Kulvar)",
    yz004: "• Biçim & Çift Kör Kuralları",
    yz005: "• CMT Gönderim Rehberi",
    yz006: "• Bildiri Şablonları (LaTeX/Word)",
    yz007: "• Özel Oturum Çağrısı",
    navAuthorsTutCall: "Eğitim Semineri Çağrısı",
    descAuthorsTutCall: "Duyurulacaktır",
    navAuthorsPanelCall: "Panel Çağrısı",
    descAuthorsPanelCall: "Duyurulacaktır",
    yzTutCallTitle: "Eğitim Semineri Çağrısı",
    yzTutCallNote: "Eğitim semineri çağrısı burada duyurulacaktır.",
    yzPanelCallTitle: "Panel Çağrısı",
    yzPanelCallNote: "Panel çağrısı burada duyurulacaktır.",
    yzTutCallToc: "• Eğitim Semineri Çağrısı",
    yzPanelCallToc: "• Panel Çağrısı",
    yz008: "• Baskıya Hazır & Telif Devri",
    yz009: "RESMÎ ÇAĞRI",
    yz010: "Bildiri Çağrısı (Call for Papers)",
    yz011: "35. Sinyal İşleme ve İletişim Uygulamaları Kurultayı (SİU 2027), <strong>4–7 Temmuz 2027</strong> tarihleri arasında <strong>İstanbul Medipol Üniversitesi</strong> Kavacık Kampüsü’nde gerçekleştirilecektir.",
    yz011a: "Bildiri çağrısı (CFP) burada duyurulacaktır.",
    yz013: "Sayfa Sınırı: En Fazla 4 Sayfa",
    yz014: "Kaynakça ve tüm şekiller dahil standart IEEE çift sütun formatında en fazla 4 sayfa olmalıdır.",
    yz015: "Çift Kör (Double-Blind) Hakemlik",
    yz016: "İlk gönderimde yazar adları, kurumlar ve teşekkür bölümleri gizlenmelidir.",
    yz019: "IEEE Xplore ve Bildiriler Kitabı",
    yz020: "Kabul edilen, kurultayda sunulan ve ilgili IEEE yayın koşullarını sağlayan tam metin bildirilerin IEEE Xplore Dijital Kütüphanesi’ne gönderilmesi planlanmaktadır.",
    yz022: "CMT Bildiri Gönderim Sistemi",
    yz022a: "Bildirilerin IEEE Xplore'da Yayımlanması Planlanmaktadır",
    yz022b: "Kurultayda sunulan tam metin bildirilerin IEEE Xplore veri tabanına iletilmesi planlanmaktadır. Teknik sponsorluk süreci tamamlandığında ayrıntılar duyurulacaktır.",
    yz023: "RESMÎ KULVARLAR",
    yz024: "Konular ve Araştırma Kulvarları",
    yz025: "SİU 2027, aşağıda sıralanan <strong>6 resmî ana başlık</strong> ve ilgili alt konularda özgün araştırma bildirileri kabul etmektedir. Bu başlıkların yanı sıra sinyal işleme ve iletişimin kuramsal ve uygulamalı her alanından özgün bildiriler değerlendirmeye açıktır:",
    yz026: "Kulvar 1: İletişim ve Ağlar",
    yz027: "<span>• Bilgi Teorisi ve Kodlama</span> <span>• İletişim Teorisi ve Uygulamaları</span> <span>• Kablosuz İletişim ve Ağlar</span> <span>• 6G ve Ötesi Teknolojiler</span> <span>• Nesnelerin İnterneti (IoT)</span> <span>• Taşıtsal İletişim</span> <span>• Siber-Fiziksel Sistemler</span> <span>• Bütünleşik Algılama ve İletişim</span> <span>• Uydu ve Derin Uzay İletişimi</span> <span>• Optik İletişim ve Ağlar</span> <span>• Enerji Hasadı ve Düşük Güçlü İletişim</span> <span>• İletişim ve Ağlarda Güvenlik ve Gizlilik</span> <span>• Dijital İkiz Çözümleri</span> <span>• Moleküler ve Nano İletişim</span> <span>• Kuantum İletişim</span> <span>• Bilgi Yaşı ve Değeri</span> <span>• İşbirlikli İletişim ve Ağlar</span> <span>• Enerji Verimli ve Yeşil Ağlar</span> <span>• Holografik Yüzeyler ve MIMO</span> <span>• Uç Bilişim, Uç Zekâsı ve Sis Ağları</span> <span>• Millimetre Dalgalar ve Terahertz İletişim</span> <span>• Ağ Güvenliği ve Mahremiyet</span> <span>• Fiziksel Katman Güvenliği</span> <span>• Özkaynak Tahsisi</span> <span>• Yazılım Tabanlı Ağlar, Ağ Fonksiyonlarını Sanallaştırma</span> <span>• Semantik ve Hedef Odaklı İletişim</span> <span>• İnsansız Hava Araçları ve Karasal Olmayan İletişim</span> <span>• Telsiz Güç ve Bilgi Transferi</span> <span>• Telsiz Ağlar</span> <span>• Geri Saçılım ve Akıllı Yansıtıcı Yüzeyler Aracılığı ile İletişim</span>",
    yz028: "Kulvar 2: Görüntü İşleme ve Bilgisayarlı Görü",
    yz029: "<span>• Görüntü ve Video İşleme</span> <span>• Obje Algılama ve Desen Tanıma</span> <span>• Çok Kanallı ve Çok Kameralı İşleme</span> <span>• Görüntü/Video Kodlama ve Sıkıştırma</span> <span>• Görüntü ve Video Tabanlı Biyometrik</span> <span>• Belge Analizi ve Anlama</span> <span>• Uzaktan Algılama ve Coğrafi Analiz</span> <span>• 3B Görüntü ve Hesaplamalı Fotoğrafçılık</span> <span>• Görü Temel Modelleri, Görü-Dil Modelleri</span>",
    yz030: "Kulvar 3: Sinyal İşleme ve Robotik",
    yz031: "<span>• Sinyal İşleme Teorisi</span> <span>• İstatistiksel Sinyal İşleme</span> <span>• Ses/Konuşma İşleme</span> <span>• Radar Sinyal İşleme</span> <span>• Siber Güvenlik Uygulamaları için Sinyal İşleme</span> <span>• Otonom Sistemler için Sinyal İşleme</span> <span>• Endüstriyel ve Otomotiv Uygulamaları</span> <span>• Gerçek Zamanlı Sinyal İşleme ve Gömülü Sistemler</span> <span>• E-Sağlık Uygulamaları ve Destekleyici Teknolojiler</span> <span>• Finansal Sinyal İşleme</span> <span>• Deniz, Hava ve Kara Robotları</span> <span>• Endüstriyel Robotlar</span> <span>• İnsansı ve Sosyal Robotlar</span> <span>• Sürü Robotları</span> <span>• Kontrol Algoritmaları</span> <span>• Konumlandırma, Haritalandırma ve Yön Bulma</span> <span>• İnsan-Robot Etkileşimi</span> <span>• Robot-Nesne Etkileşimi</span> <span>• Robot Mimarileri, Yazılımları, Benzeticileri ve İşletim Sistemleri</span> <span>• Robotlarda Görme ve Algılama</span>",
    yz032: "Kulvar 4: Makine Öğrenmesi ve Yapay Zekâ",
    yz033: "<span>• Makine Öğrenmesi Kuramı</span> <span>• Derin Öğrenme</span> <span>• Sağlık Uygulamaları için Makine Öğrenmesi</span> <span>• İletişim Sistemleri için Makine Öğrenmesi</span> <span>• Çok Modlu Analiz</span> <span>• Pekiştirmeli Öğrenme</span> <span>• Çekişmeli Öğrenme ve Dayanıklı Yapay Zekâ</span> <span>• Aktarmalı, Yarı-Gözetmenli ve Gözetimsiz Öğrenme</span> <span>• İşaret/İmge İşleme Uygulamaları için Makine Öğrenmesi</span> <span>• Makine Öğrenmesi Tekniklerinin Başarım Analizi</span> <span>• Açıklanabilir Yapay Zekâ ve Güvenilir Makine Öğrenmesi</span>",
    yz034: "Kulvar 5: Biyomedikal Sinyal/Görüntü İşleme",
    yz035: "<span>• Biyomedikal Sinyal Analizi</span> <span>• Tıbbi Görüntü Analizi ve Uygulamaları</span> <span>• Biyoinformatik ve Genomik Sinyal İşleme</span> <span>• Giyilebilir Algılayıcılar ve E-Sağlık</span> <span>• Biyomedikal Veri Gizliliği ve Güvenliği</span> <span>• Sağlık İzleme için Biyosinyal İşleme</span> <span>• Tıbbi Tanıda Yapay Zekâ Uygulamaları</span> <span>• Tele-tıp ve Uzaktan Hasta Takibi</span> <span>• Nöromühendislik ve Beyin Sinyali İşleme</span>",
    yz035a: "Kulvar 6: Doğal Dil İşleme",
    yz035b: "<span>• Büyük Dil Modelleri ve Eğitim Stratejileri</span> <span>• Yapay Zekâ ve Büyük Dil Modeli Ajanları</span> <span>• Diyalog ve Etkileşimli Sistemler</span> <span>• Bilgi Çıkarma ve Erişimi</span> <span>• Dil Teorileri ve Bilişsel Modeller</span> <span>• Tercüme ve Çoklu Dil İşleme</span> <span>• Fonoloji, Morfoloji ve Kelime Bölütleme</span> <span>• Dilde Anlambilim (Semantik)</span> <span>• Metinlerde Duygu, Stil ve Argüman Analizi</span> <span>• Konuşma İşleme ve Tanıma</span> <span>• Metin Özetleme ve Soru-Cevaplama</span>",
    yz036: "<strong>Not:</strong> SİU 2027'ye özel önceden yapılandırılmış şablon paketi hazırlandığında bu sayfada yayımlanacaktır. O tarihe kadar yukarıdaki resmî IEEE konferans şablonlarını kullanınız.",
    yz037: "BİLİMSEL DEĞERLENDİRME İLKELERİ",
    yz038: "Biçim ve Çift Kör (Double-Blind) Kuralları",
    yz039: "SİU 2027'de bilimsel tarafsızlığı ve en yüksek akademik kaliteyi güvenceye almak amacıyla <strong>çift kör değerlendirme</strong> süreci uygulanmaktadır. Yazarların ilk inceleme için hazırlayacakları PDF kopyalarında şu hususlara dikkat etmeleri zorunludur:",
    yz040: "Bildiri başlığının altına <strong>yazar adı, unvan, kurum ve e-posta</strong> bilgisi yazılmamalıdır.",
    yz041: "Bildiri içindeki teşekkür (acknowledgements) ve proje fon numarası gibi yazar kimliğini ele veren kısımlar ilk inceleme sürümünden çıkarılmalıdır.",
    yz042: "Yazarlar kendi önceki çalışmalarına atıf yaparken üçüncü şahıs dili kullanmalıdır (Örn: <em>\"Önceki çalışmamızda [3]\"</em> yerine <em>\"[3] numaralı çalışmada\"</em>).",
    yz043: "PDF dosyasının özelliklerindeki (metadata) yazar adı ve bilgisayar kullanıcı adı temizlenmelidir.",
    yz044: "BAŞVURU PORTALI",
    yz045: "Microsoft CMT Bildiri Gönderim Kılavuzu",
    yz046: "Araştırma bildirileri yalnızca Microsoft CMT (Conference Management Toolkit) sistemi üzerinden gönderilecektir. E-posta yoluyla gönderilen bildiriler değerlendirmeye alınmayacaktır. Gönderim sistemi bildiri gönderim dönemi başlamadan önce açılacak ve bağlantı bu sayfada duyurulacaktır.",
    yz047: "Adım Adım Gönderim Süreci:",
    yz048: "Microsoft CMT hesabınızla giriş yapın. Hesabınız yoksa CMT üzerinden ücretsiz bir hesap oluşturun.",
    yz048b: "SİU 2027 gönderim sayfasını açın: <a href=\"https://cmt3.research.microsoft.com/SIU2027\" target=\"_blank\" rel=\"noopener\">cmt3.research.microsoft.com/SIU2027</a>",
    yz049: "\"Create new submission\" seçeneğine tıklayın.",
    yz050: "Bildirinizin konusuna en uygun <strong>Birincil Kulvarı (Primary Track)</strong> ve gerekirse İkincil Kulvarı seçin.",
    yz052: "Çift kör kuralına uygun olarak hazırlanmış (yazar bilgisi içermeyen) <strong>en fazla 4 sayfalık PDF</strong> dosyasını yükleyin.",
    yz053: "\"Submit\" düğmesine tıklayarak onay e-postasını kontrol edin.",
    yz053b: "Gönderiminizi son tarihten önce tamamlayın: <strong>1 Şubat 2027</strong>.",
    yz054: "Microsoft CMT SİU 2027 Gönderim Sayfası",
    yz054b: "Gönderim sistemi henüz açılmamıştır; açıldığında bu sayfada duyurulacaktır.",
    yz055: "DOSYA FORMATLARI",
    yz056: "Bildiri Şablonları (IEEE LaTeX & MS Word)",
    yz057: "Bildiriler standart <strong>IEEE iki sütunlu A4</strong> konferans formatına uygun olarak hazırlanmalıdır. Şablonlarda sayfa boyutu, kenar boşlukları, yazı tipi boyutları veya sütun genişliklerinde kesinlikle değişiklik yapılmamalıdır.",
    yz057a: "Bildiri şablonu burada duyurulacaktır.",
    yz058: "IEEE LaTeX Şablon Paketi",
    yz059: "Tüm makro ve stil dosyalarını (.cls, .tex, .bib) içeren güncel IEEEtran Overleaf ve TeX Live uyumlu paket.",
    yz060: "Resmî IEEE LaTeX Şablonu ↗",
    yz061: "IEEE Microsoft Word Şablonu",
    yz062: "A4 boyutunda, önceden tanımlanmış IEEE stillerini içeren Microsoft Word (.docx) şablon dosyası.",
    yz063: "Resmî IEEE Word Şablonu ↗",
    yz064: "ÖZEL OTURUM ÇAĞRISI",
    yz065: "Özel Oturum (Special Session) Öneri Yönergesi",
    yz067: "Özel oturum başlığı ve kapsam özeti (en fazla 1 sayfa)",
    yz068: "Oturum düzenleyicilerinin (organizers) özgeçmişleri ve iletişim bilgileri",
    yz069: "Oturuma davet edilmesi planlanan en az 5 adet taslak bildiri başlığı ve yazar listesi",
    yz070: "YAYIN VE TELİF SÜRECİ",
    yz071: "Baskıya Hazır Bildiri & IEEE Telif Devir Süreci",
    yz072: "Hakem değerlendirmesi sonucu kabul edilen bildirilerin <strong>IEEE Xplore Dijital Kütüphanesi'nde (IEEE Xplore Digital Library)</strong> yayınlanabilmesi için yazarların aşağıdaki adımları tamamlaması gerekmektedir:",
    yz072a: "Baskıya hazır bildiri ve IEEE telif devri süreci burada duyurulacaktır.",
    yz073: "<strong>Yazar ve Kurum Bilgilerinin Eklenmesi:</strong> Hakem eleştirileri doğrultusunda revize edilen kamera-hazır metne tüm yazarların adı, soyadı, kurum bilgileri ve e-posta adresleri eklenmelidir.",
    yz074: "<strong>IEEE PDF eXpress Kontrolü:</strong> Nihai PDF dosyası, IEEE Xplore format uyumluluğunu denetleyen <strong>IEEE PDF eXpress</strong> sisteminden geçirilmelidir. (Sistem konferans ID'si kabul mektuplarıyla duyurulacaktır).",
    yz075: "<strong>IEEE Telif Devri (IEEE eCF):</strong> Microsoft CMT sistemi üzerinden yönlendirilecek <strong>IEEE Electronic Copyright Form (eCF)</strong> bağlantısı üzerinden telif hakkı devir işlemi online olarak onaylanmalıdır.",
    arh001: "Kurultay Haritası (1993 – 2027)",
    arh002: "SİU kurultaylarının Türkiye ve KKTC genelindeki dağılımı. Yıl çubuğunu sürükleyerek ya da ok tuşlarıyla kurultayları sırayla gezebilirsiniz; daire büyüklüğü o yerin kaç kez ev sahipliği yaptığını gösterir.",
    arh003: "Yıl",
    arh004: "Önceki kurultay",
    arh005: "Sonraki kurultay",
    arh006: "Sırayla oynat",
    arh007: "Durdur",
    arh008: "Çevrim içi düzenlendi — harita üzerinde konum yok.",
    arh009: "Kurultay",
    arh010: "Ev sahibi şehir",
    arh011: "Ev sahibi kurum",
    arh012: "Harita verileri © OpenStreetMap katkıcıları (ODbL). Tam liste aşağıdaki tablodadır.",
    ky001: "Katılımcı Bilgileri",
    ky002: "Ad Soyad",
    ky003: "E-posta Adresi",
    ky004: "Kurum / Üniversite",
    ky005: "Unvan",
    ky006: "Kayıt Kategorisi",
    ky007: "Lütfen bir kategori seçin…",
    ky008: "Tam Kayıt (Akademisyen / Sektör)",
    ky009: "Öğrenci Yazar Kaydı",
    ky010: "Lisansüstü Dinleyici Kaydı",
    ky011: "Lisans Dinleyici Kaydı",
    ky012: "Bildiri Numarası",
    ky013: "Kabul edilmiş bildiriniz varsa CMT üzerindeki numarasını yazın (örn. #104). Dinleyici kayıtlarında boş bırakın.",
    ky014: "Fatura Bilgileri",
    ky015: "Bireysel fatura",
    ky016: "Kurumsal fatura",
    ky017: "Fatura Unvanı",
    ky018: "Vergi Dairesi",
    ky019: "Vergi / TCKN Numarası",
    ky020: "Eklemek istedikleriniz",
    ky021: "Erişilebilirlik, beslenme ya da fatura ile ilgili özel bir durumunuz varsa buraya yazabilirsiniz.",
    ky022: "Ön Kaydı Tamamla",
    ky023: "Zorunlu alan",
    ky024: "Kayıt kategorileri",
    ky025: "Kayıt kategorileri ve paket içerikleri Katılım ve Kayıt sayfasındadır.",
    ky026: "Katılım ve Kayıt sayfası",
    ky027: "Ödeme bu adımda alınmaz",
    ky028: "Bu form yalnızca ön kayıt oluşturur. Kart bilgisi istenmez ve saklanmaz. Ücretler kesinleştiğinde ödeme adımı ayrıca duyurulacaktır.",
    ky029: "Ön kaydınız alındı.",
    ky030: "Kayıt numaranız",
    ky031: "Onay iletisi e-posta adresinize gönderildi. Bu numarayı yazışmalarınızda kullanın.",
    ky032: "Gönderiliyor…",
    kyKicker: "KATILIMCI KAYDI",
    kyLede: "SİU 2027 ön kaydınızı buradan oluşturabilirsiniz. Kayıt ücretleri henüz kesinleşmediği için bu adımda ödeme alınmaz; ücretler onaylandığında bildirdiğiniz e-posta adresine bilgi verilir.",
    kyTitle: "Kayıt Formu",
    ft001: "Bildiri Çağrısı (CFP)",
    ft001a: "Konular ve Kulvarlar",
    ft003: "Bildiri Şablonları",
    ft004: "Bilimsel Program",
    ft005: "Kayıt Ücretleri",
    ft006: "Lisans Proje Yarışması",
    ft007: "Kurultay Eş Başkanları",
    ft008: "Düzenleme Kurulu",
    ft009: "Teknik Program Komitesi",
    ft010: "İstanbul Medipol Üniversitesi",
    ft011: "1993–2027 Kurultay Arşivi",
    ft012: "Adres",
    ft013: "E-posta",
    ft014: "Telefon",
    ft015: "İstanbul Medipol Üniversitesi Kavacık Güney Kampüsü, Göztepe Mah. Atatürk Cad. No: 40/16, 34815 Beykoz / İstanbul",
    ft016: "© 2027 Sinyal İşleme ve İletişim Uygulamaları Kurultayı (SİU 2027). Tüm hakları saklıdır.",
    ft017: "Erişilebilirlik",
    ft018: "KVKK Aydınlatma Metni",
    ft019: "Kalıcı Arşiv",
    ft020: "Aramak istediğiniz konuyu yazın veya hızlı başlıklardan seçin.",
    searchNoResults: "Eşleşen sonuç bulunamadı.",
    ft021: "Aramayı kapat",
    ft022: "Menüyü kapat",
    ft023: "Menüyü aç",
  },
  en: {
    ar001: "Conference Chronology (1993 – 2027)",
    ar002: "The year, edition number, host institution and host city of each SIU conference. You can filter past conferences by searching the table.",
    ar003: "Search the archive",
    ar004: "No.",
    ar005: "Year",
    ar006: "Host / Partner Institution",
    ar007: "City / Venue / Format",
    ar009: "Istanbul Medipol University",
    ar010: "Kavacık, Istanbul (in person)",
    ar012: "Piri Reis University",
    ar013: "Tuzla, İstanbul",
    ar015: "Işık University",
    ar016: "Şile, İstanbul",
    ar018: "Tarsus University",
    ar019: "Tarsus / Mersin",
    ar021: "Istanbul Technical University",
    ar022: "Ayazağa, İstanbul",
    ar024: "Bahçeşehir University",
    ar025: "Safranbolu (hybrid)",
    ar027: "Bahçeşehir University",
    ar028: "Online (virtual)",
    ar030: "Istanbul Medipol University",
    ar031: "Online (pandemic period)",
    ar033: "Gebze Technical Univ. + Sivas Cumhuriyet Univ.",
    ar034: "Sivas",
    ar036: "İzmir Kâtip Çelebi University",
    ar037: "İzmir",
    ar039: "Istanbul Technical University",
    ar040: "Antalya",
    ar042: "Bülent Ecevit University",
    ar043: "Zonguldak",
    ar045: "İnönü University",
    ar046: "Malatya",
    ar048: "Karadeniz Technical University",
    ar049: "Trabzon",
    ar051: "Cyprus International University",
    ar052: "Kyrenia, TRNC",
    ar054: "Özyeğin University",
    ar055: "Fethiye, Muğla",
    ar057: "Hacettepe University",
    ar058: "Kemer, Antalya",
    ar060: "Dicle University",
    ar061: "Diyarbakır",
    ar063: "Kocaeli University",
    ar064: "Antalya",
    ar066: "Middle East Technical University (METU)",
    ar067: "Didim, Aydın",
    ar069: "Anadolu University",
    ar070: "Eskişehir",
    ar072: "Sabancı University",
    ar073: "Belek, Antalya",
    ar075: "Erciyes University",
    ar076: "Kayseri",
    ar078: "Istanbul Technical University",
    ar079: "Kuşadası, Aydın",
    ar081: "Koç University",
    ar082: "Rumelifeneri, İstanbul",
    ar084: "Işık University",
    ar085: "Pamukkale, Denizli",
    ar087: "Eastern Mediterranean University",
    ar088: "Famagusta, TRNC",
    ar090: "Istanbul University",
    ar091: "Beldibi, Antalya",
    ar093: "Bilkent University",
    ar094: "Bilkent, Ankara",
    ar096: "Başkent University",
    ar097: "Kızılcahamam, Ankara",
    ar099: "Boğaziçi University",
    ar100: "Kuşadası, Aydın",
    ar102: "Middle East Technical University (METU)",
    ar103: "Kemer, Antalya",
    ar105: "İTÜ + TÜBİTAK MAM",
    ar106: "Cappadocia, Nevşehir",
    ar108: "Bilkent University + Boğaziçi University",
    ar109: "Gökova, Muğla",
    ar111: "Boğaziçi University",
    ar112: "Bebek, İstanbul",
    arsivKicker: "INSTITUTIONAL MEMORY & SCIENTIFIC ARCHIVE",
    arsivPageDesc: "35-year conference chronology originating at Bogazici University, with host institutions and locations.",
    arsivPageTitle: "SIU Historical Archive (1993 – 2027)",
    brandSubtitle: "35th Signal Processing & Communications Applications Conference",
    btnCfp: "Call for Papers (CFP)",
    btnTracks: "Paper Topics / Tracks",
    btnRegister: "Register Now",
    btnSubmit: "Submit Paper (To Be Announced)",
    btnViewProgram: "View Program",
    btnViewTracks: "Go to the Authors page",
    cal001: "Add key dates to my calendar",
    cal002: "Add conference dates",
    cal003: "Add to Google Calendar",
    cal004: ".ics file — works with Apple Calendar, Outlook, Google Calendar and Thunderbird. Reminders included.",
    cfp001: "Call for Papers (PDF, Turkish)",
    cfp002: "Call for Papers (PDF, English)",
    cmt001: "The Microsoft CMT service was used for managing the peer-reviewing process for this conference. This service was provided for free by Microsoft and they bore all expenses, including costs for Azure cloud services as well as for software development and support.",
    cmt002: "The Microsoft CMT service was used for managing the peer-reviewing process for this conference. This service was provided for free by Microsoft and they bore all expenses, including costs for Azure cloud services as well as for software development and support.",
    countdownDays: "DAYS",
    countdownHours: "HOURS",
    countdownMins: "MINS",
    countdownSecs: "SECS",
    countdownTitle: "Countdown to SIU 2027",
    datesKicker: "TIMELINE & MILESTONES",
    datesThDeadline: "Deadline",
    datesThDate: "Date",
    datesThProcess: "Milestone / Process",
    datesThStatus: "Status",
    descAboutHistory: "35-year conference chronology",
    descAboutHost: "Istanbul Medipol University",
    descAboutMsg: "Welcome message from conference chairs",
    descAboutScope: "Scientific vision and scope",
    descAuthorsCamera: "To be announced",
    descAuthorsCfp: "To be announced",
    descAuthorsSpecial: "Special session proposal",
    descAuthorsTemplates: "To be announced",
    descAuthorsTracks: "6 technical research tracks",
    descCompetitionsThesis: "MS & PhD 5-minute thesis",
    descCompetitionsTravel: "SIU 2027 student travel grants",
    descCompetitionsUndergrad: "Capstone project awards",
    descProgramDetail: "To be announced",
    descProgramOverview: "To be announced",
    descProgramSocial: "To be announced",
    descProgramSpeakers: "To be announced",
    descProgramTutorials: "Days and times to be announced",
    descProgramPanels: "To be announced",
    descRegistrationAccom: "Accommodation around Kavacık",
    descRegistrationFaq: "FAQ for authors and attendees",
    descRegistrationFees: "Registration categories and packages",
    descRegistrationTravel: "Campus map and public transport",
    dil001: "SIU 2027 is a distinguished platform for presenting the most recent theoretical and applied research in signal processing, communications, computer vision, machine learning, biomedical engineering and robotics. Papers must be written in <strong>Turkish</strong>. Papers written in English will be considered for review if one of the authors is not a native speaker of Turkish. Submitted papers must be original work not previously published at another conference or in a journal.",
    dil002: "Language of Submission: Turkish",
    dil003: "Papers must be written in Turkish; English papers are accepted if one of the authors is not a native speaker of Turkish.",
    dil004: "Enter the paper title, abstract and keywords into the system.",
    yz051b: "Enter the full name, affiliation and email address of every author into CMT completely and correctly.",
    dil005: "What language should papers and presentations be in?",
    dil006: "Papers must be written in Turkish. If one of the authors is not a native speaker of Turkish, papers written in English are considered for review. Turkish papers are presented in Turkish and English papers in English.",
    dr01Desc: "Special session proposals sent to the Conference Secretariat",
    dr01Due: "November 16, 2026",
    dr01Name: "Call for Special Session Proposals",
    dr01Status: "Open",
    dr02Desc: "Tutorial proposals sent to the Conference Secretariat",
    dr02Due: "November 16, 2026",
    dr02Name: "Call for Tutorial Proposals",
    dr02Status: "Open",
    dr03Desc: "Accepted special sessions announced to organisers",
    dr03Due: "November 30, 2026",
    dr03Name: "Notification of Special Session Acceptance",
    dr03Status: "Scheduled",
    dr04Desc: "Accepted tutorials announced to instructors",
    dr04Due: "November 30, 2026",
    dr04Name: "Notification of Tutorial Acceptance",
    dr04Status: "Scheduled",
    dr05Desc: "Double-blind PDF of at most 4 pages via Microsoft CMT",
    dr05Due: "February 1, 2027",
    dr05Name: "Paper Submission",
    dr05Note: "Before submitting, review the <a href=\"yazarlar#sablonlar\">paper format</a> and the <a href=\"#kulvarlar\">tracks</a>.",
    dr05Status: "Scheduled",
    dr06Desc: "Review results communicated to authors",
    dr06Due: "April 30, 2027",
    dr06Name: "Notification of Acceptance",
    dr06Status: "Scheduled",
    dr07Desc: "IEEE PDF eXpress approval, copyright transfer (eCF) and registration of at least one author",
    dr07Due: "May 24, 2027",
    dr07Name: "Camera-Ready Paper Submission",
    dr07Note: "<a class=\"link-off\" aria-disabled=\"true\">IEEE publication and copyright process</a> — TBA",
    dr07Status: "Scheduled",
    dr08Desc: "Istanbul Medipol University, Kavacık South Campus",
    dr08Due: "July 4–7, 2027",
    dr08Name: "Conference Dates",
    dr08Status: "Event",
    dt001: "Special sessions on current and specialised research topics will be organised within SIU 2027. Researchers wishing to organise a special session should send a proposal containing the following information to <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a> by <strong>November 16, 2026</strong> at the latest:",
    dt002: "<strong>Author Registration:</strong> for the paper to remain in the programme and enter the IEEE publication process, at least one author must complete conference registration by <strong>May 24, 2027</strong>.",
    dt003: "Organisers will be notified of accepted special sessions by <strong>November 30, 2026</strong>.",
    dt004: "Session titles, halls, timings and the papers to be presented will be published once the peer review process is complete (after April 30, 2027). For the tracks in which papers are accepted, see the <a href=\"yazarlar#kulvarlar\">Topics and Research Tracks</a> page.",
    dt005: "Half-day tutorials and industry panels will be held as part of SIU 2027. Tutorial proposals must be sent to the Conference Secretariat by <strong>November 16, 2026</strong>; instructors will be notified of accepted tutorials by <strong>November 30, 2026</strong>. Accepted titles will be published in this section together with their dates and times. <strong>Tutorial dates and times: To Be Announced (TBA).</strong>",
    dt006: "Registration fees will be tiered according to early registration and student status. The amounts and the early registration deadline have not been finalised yet; they will be announced on this page once approved.",
    dt007: "Early registration date to be announced",
    dt008: "After the early registration period",
    dt009: "Early Registration",
    dt010: "For accepted papers presented at the conference to be submitted to the <strong>IEEE Xplore Digital Library</strong> and included in the programme, at least one of their authors must register by <strong>May 24, 2027</strong>.",
    dt011: "<strong>Cancellation and refund terms:</strong> these will be announced together with the registration fees. Cancellation requests must be submitted in writing to <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a>.",
    dt012: "<strong>Application Deadline:</strong> To Be Announced (TBA)",
    footerAbout: "The 35th Signal Processing and Communications Applications Conference will be held on July 4–7, 2027 at Istanbul Medipol University, Kavacık South Campus.",
    footerInstitutional: "Institutional",
    footerQuickLinks: "Quick Access",
    footerSecretariat: "Conference Secretariat",
    hakkindaKicker: "INSTITUTIONAL & SCIENTIFIC OVERVIEW",
    hakkindaPageDesc: "Vision and scope of the 35th Signal Processing and Communications Applications Conference (SIU 2027), and its host Istanbul Medipol University.",
    hakkindaPageTitle: "About Conference",
    heroBadge: "35TH EDITION • OFFICIAL CONFERENCE PORTAL",
    heroDesc: "Turkey's premier scientific forum in signal processing, wireless communications, computer vision, and artificial intelligence.",
    heroVenueSub: "Kavacık South Campus",
    heroVenueVal: "Istanbul Medipol University",
    heroMainTitle: "35th Signal Processing and Communications Applications Conference — <span class=\"cyan-word\">SIU 2027</span>",
    heroTopics: "Artificial Intelligence • 6G • Biomedical • Computer Vision • Autonomous Systems",
    hk001: "Sections",
    hk002: "• Welcome Message",
    hk003: "• Scope and Aims",
    hk004: "• Host Institution",
    hk006: "INVITATION AND MESSAGE",
    hk007: "Welcome Message from the Conference Chairs",
    hk008: "Dear Researchers, Colleagues and Students,",
    hk009: "We are honoured and delighted to host the <strong>35th Signal Processing and Communications Applications Conference (SIU 2027)</strong>, the meeting point of the signal processing and communications fields, on <strong>July 4–7, 2027</strong> at <strong>Istanbul Medipol University</strong>.",
    hk010: "What began at Boğaziçi University in 1993 has, in its thirty-fifth year, grown into a substantial scientific ecosystem that brings together hundreds of academics, early-career researchers and representatives of the defence and information technology industries from across Türkiye and abroad.",
    hk011: "We are pleased to invite you to the conference at our Kavacık Campus, next to the incomparable Bosphorus view of Istanbul.",
    hk012: "On behalf of the SIU 2027 Organising Committee",
    hk013: "Prof. Dr. Hüseyin Arslan & Prof. Dr. Elif Uysal",
    hk014: "Conference Co-Chairs",
    hk015: "MISSION AND OBJECTIVES",
    hk016: "Scope and Aims",
    hk017: "The core aim of the SIU Conference is to provide a national and international platform on which researchers working in signal processing, communication theory, computer vision, machine learning and control can present original work, share experience and strengthen university–industry collaboration. The conference topics are organised under <a href=\"./#kulvarlar\">6 tracks</a>.",
    hk022: "HOST UNIVERSITY",
    hk023: "Istanbul Medipol University",
    hk024: "With its contemporary approach to education, strong research centres (SABİTA, 6G and Artificial Intelligence Laboratories), technology transfer ecosystem and international academic staff, Istanbul Medipol University is among Türkiye's leading higher education institutions.",
    hk025: "University Website",
    hk026: "Medipol Logo (PNG)",
    hk027: "Kavacık South Campus & Congress Centre",
    hk027b: "Virtual Campus Tour",
    hk029: "VISUAL IDENTITY & EMBLEM",
    hk030: "The Official SIU 2027 Logo and Its Meaning",
    hk031: "The SIU 2027 logo visualises the four technological pillars the conference represents:",
    hk032: "<strong>Signal Wave (left):</strong> classical signal processing, biomedical signals, RF waves and time series.",
    hk033: "<strong>Human Mind and Neural Network (centre):</strong> machine learning, deep learning, generative artificial intelligence and large language models (LLMs).",
    hk034: "<strong>Radio Tower and Waves (right):</strong> 5G/6G, satellite networks, ISAC and wireless telecommunications infrastructure.",
    hk035: "<strong>Orbital Ring and Nodes:</strong> the continuity of a 35-year scientific ecosystem and the connectedness of its network.",
    hk036: "Download the High-Resolution Logo (PNG)",
    il001: "SECRETARIAT INFORMATION",
    il002: "Istanbul Medipol University Kavacık South Campus",
    il003: "Conference Address",
    il004: "Istanbul Medipol University Kavacık South Campus, Congress and Culture Centre<br> Göztepe Mah. Atatürk Cad. No: 40/16, 34815 Beykoz / Istanbul",
    il005: "E-mail Address",
    il006: "General enquiries and registration: <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a>",
    il007: "Telephone & Call Centre",
    il008: "+90 (216) 681 51 00 (switchboard) • Ext.: TBA",
    il009: "Location and Parking",
    il010: "Information about the use of the campus car park will be announced. For navigation, search for: <em>\"İstanbul Medipol Üniversitesi Kavacık Güney Kampüsü\"</em>.",
    il011: "QUICK SUPPORT FORM",
    il012: "Send Us a Message",
    il013: "Full Name *",
    il014: "E-mail Address *",
    il015: "Institution / University",
    il016: "Subject *",
    il017: "Please select a subject...",
    il018: "CMT and Paper Process Support",
    il019: "Registration and Payment",
    il020: "Special Session Proposal",
    il021: "Undergraduate Project / Thesis Competition",
    il022: "Sponsorship and Exhibition Space",
    il023: "Other / General Enquiry",
    il024: "Your Message *",
    il025: "I have read the <a href=\"kvkk\">Personal Data Protection (KVKK) Notice</a> and consent to my name, surname, e-mail address and institution being processed in order to handle my request. *",
    il026: "Send Message by E-mail",
    il027: "The send button opens the form as a pre-filled message in the e-mail application on your computer; you need to send the message yourself. Alternatively, you can write directly to <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a>.",
    iletisimKicker: "INQUIRIES & SUPPORT",
    iletisimPageDesc: "Get in touch with the SIU 2027 Organizing Committee, paper management desk, registration, and sponsorship team.",
    iletisimPageTitle: "Contact and Secretariat",
    importantDatesDesc: "The official calendar of every milestone, from special session and tutorial calls to camera-ready papers.",
    importantDatesTitle: "Important Dates",
    ix008: "Information Theory and Coding",
    ix009: "Communication Theory and Applications",
    ix010: "Wireless Communications and Networks",
    ix011: "6G and Beyond Technologies",
    ix012: "Internet of Things (IoT)",
    ix013: "Vehicular Communications",
    ix014: "Image and Video Processing",
    ix015: "Object Detection and Pattern Recognition",
    ix016: "Multi-Channel and Multi-Camera Processing",
    ix017: "Image/Video Coding and Compression",
    ix018: "Image and Video-based Biometrics",
    ix019: "Document Analysis and Understanding",
    ix020: "Signal Processing Theory",
    ix021: "Statistical Signal Processing",
    ix023: "Audio/Speech Processing",
    ix024: "Radar Signal Processing",
    ix026: "Machine Learning Theory",
    ix027: "Deep Learning",
    ix028: "Machine Learning for Healthcare",
    ix029: "ML/DL for Communication Systems",
    ix030: "Multimodal Analysis",
    ix031: "Reinforcement Learning",
    ix032: "Biomedical Signal Analysis",
    ix033: "Medical Image Analysis and Applications",
    ix034: "Bioinformatics and Genomic Signal Processing",
    ix035: "Wearable Sensors and E-Health",
    ix036: "Biomedical Data Privacy and Security",
    ix037: "Biosignal Processing for Health Monitoring",
    ix038: "Large Language Models and Training Strategies",
    ix039: "Artificial Intelligence and Large Language Model Agents",
    ix040: "Dialogue and Interactive Systems",
    ix041: "Information Extraction and Retrieval",
    ix042: "Linguistic Theories, Cognitive Models",
    ix043: "Translation and Multi-Language Processing",
    ix044: "Marine, Air and Land Robots",
    ix045: "Industrial Robots",
    ix046: "Humanoid and Social Robots",
    ix047: "Swarm Robots",
    ix049: "Control Algorithms",
    ix050: "Cyber-Physical Systems",
    ix051: "Integrated Sensing and Communications",
    ix052: "Satellite and Deep Space Communications",
    ix053: "Optical Communications and Networking",
    ix054: "Energy Harvesting and Low Energy Communications",
    ix055: "Security and Privacy in Communications and Networking",
    ix056: "Digital Twins",
    ix057: "Molecular and Nano Communications",
    ix058: "Quantum Communications",
    ix059: "Age and Value of Information",
    ix060: "Cooperative Communications and Networking",
    ix061: "Energy-Efficient and Green Networking",
    ix062: "Holographic Surfaces and MIMO",
    ix063: "Edge Computing, Edge Intelligence and Fog Networks",
    ix064: "Millimeter-Wave and Terahertz Communications",
    ix065: "Network Security and Privacy",
    ix066: "Physical Layer Security",
    ix067: "Resource Allocation",
    ix068: "Software-Defined Networking and Network Function Virtualization",
    ix069: "Semantic and Goal-Oriented Communication",
    ix070: "UAVs and Non-Terrestrial Networks",
    ix071: "Wireless Power and Information Transfer",
    ix072: "Wireless Networks",
    ix073: "Backscatter and RIS-based Communications",
    ix074: "Remote Sensing and Geospatial Analysis",
    ix075: "3D Imaging and Computational Photography",
    ix076: "Signal Processing for Cybersecurity Applications",
    ix077: "Signal Processing for Autonomous Systems",
    ix078: "Human-Computer Interaction and Behaviour Analysis",
    ix079: "Industrial and Automotive Applications",
    ix080: "Real-Time Signal Processing and Embedded Systems",
    ix081: "E-Health Applications and Assistive Technologies",
    ix082: "Financial Signal Processing",
    ix083: "Robotics and Automation",
    ix084: "ML/DL for Signal and Image Processing Applications",
    ix085: "Explainable AI and Trustworthy ML",
    ix086: "Adversarial ML and Robust AI",
    ix087: "Transfer, Semi-Supervised and Unsupervised Learning",
    ix088: "Performance Analysis of ML Techniques",
    ix089: "Unsupervised and Generative Models",
    ix090: "Biometric Signal Processing",
    ix091: "Applications of Artificial Intelligence for Medical Diagnosis",
    ix092: "Telemedicine and Remote Patient Monitoring",
    ix093: "Neuroengineering and Brain Signal Processing",
    katilimKicker: "ATTENDEE GUIDE & REGISTRATION",
    katilimPageDesc: "Registration fees, early-bird rates, accommodation options, Istanbul Medipol Kavacik Campus directions, and FAQ.",
    katilimPageTitle: "Registration and Attendance",
    keyDateSub: "In-Person • 4-Day Program",
    keyDateTitle: "Conference Dates",
    keyDateVal: "July 4–7, 2027",
    keyDeadlineTitle: "Paper Submission Deadline",
    keyDeadlineVal: "February 1, 2027",
    keyLocationTitle: "Venue",
    keynotesDesc: "The invited talks planned for SIU 2027 and their speakers will be announced as invitations are confirmed.",
    keynotesPendingNote: "Speakers will be announced <a href=\"program#konusmacilar\">here</a>.",
    keynotesPendingTitle: "Invited speakers have not been finalised yet.",
    keynotesTitle: "Keynote Speakers",
    km001: "Conference Co-Chairs",
    km002: "Conference Co-Chair",
    km003: "Conference Co-Chair",
    km004: "Technical Programme Committee Co-Chairs (TPC Co-Chairs)",
    km005: "TPC Co-Chair",
    km006: "TPC Co-Chair",
    km007: "TPC Co-Chair",
    km008: "Organising Committee & Roles",
    km009: "Special Sessions Chair",
    km010: "Special Sessions Chair",
    km011: "Tutorials Chair",
    km012: "Tutorials Chair",
    km013: "Keynote Speakers Chair",
    km014: "Industry Relations and Sponsorship Chair",
    km015: "Industry Relations and Sponsorship Chair",
    km016: "Publications Chair",
    km017: "Multimedia Publications Chair (Promotion and Media)",
    km018: "Social Events Chair",
    km019: "PhD Students Committee",
    km020: "To be announced",
    km021: "Will be announced shortly",
    km022: "Honorary Board",
    km023: "Honorary Board Member",
    kma01: "Istanbul Medipol University",
    kma02: "Middle East Technical University (METU)",
    kma03: "Bilkent University",
    kma04: "Bilkent University",
    kma05: "Bilkent University / UMRAM",
    kma06: "Türk Telekom",
    kma07: "Boğaziçi University",
    kma08: "TÜBİTAK BİLGEM / Medipol Univ.",
    kma09: "Istanbul Technical University (İTÜ)",
    kma10: "Middle East Technical University (METU)",
    kma11: "Istanbul Medipol University",
    kma12: "Istanbul Medipol University",
    kma13: "Istanbul Univ. - Cerrahpaşa",
    kma14: "Middle East Technical University (METU)",
    kma15: "Middle East Technical University (METU)",
    kma16: "Boğaziçi University",
    kma17: "Boğaziçi University",
    kma18: "Bilkent University",
    kma19: "Sabancı University",
    kma20: "Middle East Technical University (METU)",
    komitelerKicker: "ORGANIZATION & SCIENTIFIC LEADERSHIP",
    komitelerPageDesc: "SIU 2027 General Co-Chairs, Technical Program Committee Co-Chairs, Organising Committee and Honorary Board.",
    komitelerPageTitle: "Conference Committees",
    kt001: "Participation Menu",
    kt002: "• Registration and Fees",
    kt003: "• What Registration Covers",
    kt004: "• Accommodation Options",
    kt005: "• Travel and Map",
    kt006: "• Frequently Asked Questions",
    kt007: "REGISTRATION RATES",
    kt008: "Registration Fees",
    kt011: "Early Registration (Full)",
    kt012: "Academics and industry researchers",
    kt014: "Presentation of 1 paper",
    kt015: "Access to all scientific sessions",
    kt016: "Conference bag & proceedings drive",
    kt017: "Lunches & coffee breaks",
    kt019: "Register Now",
    kt020: "Standard Registration (Full)",
    kt022: "Standard & on-site registration",
    kt023: "Presentation of 1 paper",
    kt024: "Access to all scientific sessions",
    kt025: "Conference bag & documents",
    kt026: "Lunches & coffee breaks",
    kt028: "Register Now",
    kt029: "Student Author Registration",
    kt030: "For authors or presenters who are students",
    kt032: "Presentation of 1 paper",
    kt033: "All sessions and tutorials",
    kt034: "Lunches & coffee breaks",
    kt035: "Certificate of attendance",
    kt037: "Register as a Student",
    kt038: "Undergraduate Listener Registration",
    kt039: "Undergraduate students without a paper",
    kt042: "Listener access to all sessions",
    kt043: "Tutorials",
    kt044: "Coffee breaks and refreshments",
    kt045: "Digital certificate of attendance",
    kt046: "(Paper presentation & gala dinner not included)",
    kt047: "Register",
    kp01: "One paper presentation",
    kp02: "Welcome reception",
    kp03: "Gala dinner",
    kp04: "Access to all conference sessions",
    kp05: "Refreshments at coffee breaks",
    kp06: "Lunches",
    kp10: "Participation in social excursions",
    kp11: "Conference materials",
    kp12: "Certificate of attendance",
    kt048: "All Registration Categories and Fees",
    kt049: "Registration Category",
    kt051: "Standard & On-Site Registration",
    kt052: "Coverage and Entitlements",
    kt053: "Full Registration (Academic / Industry)",
    kt054: "Presentation of 1 paper, all scientific sessions, lunches, refreshments, conference bag, Bosphorus tour & gala dinner.",
    kt055: "Student Author Registration",
    kt057: "Graduate Listener Registration",
    kt058: "Graduate listener without a paper; all sessions, tutorials, lunches and coffee breaks.",
    kt059: "Undergraduate Listener Registration (Free / Nominal)",
    kt061: "Entitles undergraduate students without a paper to attend sessions and posters, join tutorials, refreshments and a digital certificate.",
    kt062: "Additional Paper Fee (Same Author)",
    kt063: "For the 2nd and subsequent papers of an author whose first paper is covered by a full or student registration.",
    kt064: "Gala Dinner Ticket (Additional / Guest)",
    kt065: "Bosphorus tour and evening conference gala, open to students and listeners.",
    kt066: "IMPORTANT CONDITIONS",
    kt067: "Registration Coverage and Payment Terms",
    kt070: "All registration fees in the table are <strong>VAT inclusive</strong>.",
    kt071: "Payments can be made by 3D Secure credit card or bank transfer through the University's revolving fund. Invoice requests are collected on the registration screen.",
    kt074: "ACCOMMODATION",
    kt075: "Accommodation Options",
    kt076: "Accommodation options around Kavacık for conference participants will be announced here.",
    kt077: "Istanbul Medipol University Kavacık Halls of Residence & Guesthouse",
    kt078: "BUDGET-FRIENDLY OPTION",
    kt080: "<em><strong>Note:</strong> students awarded the SIU 2027 Travel and Accommodation Support Grant will be provided with accommodation in the halls of residence <strong>free of charge</strong>.</em>",
    kt081: "Applications & reservations: places are limited; applications can be made by e-mail to <a href=\"mailto:siu2027@medipol.edu.tr?subject=SİU%202027%20Yurt%20Konaklama%20Talebi\">siu2027@medipol.edu.tr</a>.",
    kt082: "Accommodation facilities around the campus are listed below. Distances are straight-line distances to the Kavacık South Campus.",
    kt083: "Map data © <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a> contributors (ODbL). When the map loads, tile images are fetched from OpenStreetMap servers.",
    kt084: "Limak Eurasia Luxury Hotel",
    kt085: "5-star • ~0.9 km from campus",
    kt086: "Bilek Hotel Istanbul",
    kt087: "Kavacık • ~0.7 km from campus",
    kt088: "Park Inn by Radisson Istanbul Asia Kavacık",
    kt089: "Kavacık • ~1.2 km from campus",
    kt090: "A'ija Hotel",
    kt091: "Kanlıca • ~2.6 km from campus",
    kt092: "<strong>Note:</strong> negotiated room rates and reservation codes for the conference have not been arranged yet. Once agreements are concluded, rates and discount codes will be announced in this section. Listing does not imply a partnership with the facilities concerned.",
    kt092a: "Conference-rate room prices and booking codes have not been set yet. Rates will be announced in this section once the agreements are finalised.",
    kt093: "GETTING TO THE CAMPUS",
    kt094: "Travel and Campus Map",
    kt095: "Istanbul Medipol University Kavacık South Campus is strategically located at the Anatolian-side foot of the Fatih Sultan Mehmet (FSM) Bridge:",
    kt099: "FREQUENTLY ASKED QUESTIONS",
    kt100: "Frequently Asked Questions (FAQ)",
    kt101: "How many papers can be presented with one registration?",
    kt102: "Each full or student registration covers the presentation of 1 paper and its inclusion in the Conference Proceedings. An additional paper fee must be paid for a second paper by the same author.",
    kt105: "Can the registration invoice be issued to my institution?",
    kt106: "Yes. During registration you can tick the corporate invoice option and enter your university's or institution's tax number and invoice title.",
    kt107: "Get directions on Google Maps",
    kt108: "Open in OpenStreetMap",
    kt109: "The blue dots mark bus stops within walking distance of the campus. Map data © OpenStreetMap contributors (ODbL).",
    kv001: "Privacy Notice",
    kv002: "Pursuant to Law No. 6698 on the Protection of Personal Data (\"KVKK\"), our disclosure obligation regarding personal data collected within the scope of the SIU 2027 Conference is fulfilled below.",
    kv003: "1. Data Controller",
    kv004: "The data controller is <strong>Istanbul Medipol University</strong>, the host of the SIU 2027 Conference. Address: Göztepe Mah. Atatürk Cad. No: 40/16, 34815 Beykoz / Istanbul. Contact: <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a>",
    kv005: "2. Personal Data Processed",
    kv006: "<strong>Identity and contact data:</strong> name, surname, e-mail address, telephone number.",
    kv007: "<strong>Professional data:</strong> institution/university, title, department.",
    kv008: "<strong>Paper and application data:</strong> paper title, abstract, author list, paper number.",
    kv009: "<strong>Registration and payment data:</strong> registration category, invoice details, payment transaction record. Credit card details are not stored by the University; payment is taken through the infrastructure of a licensed payment institution.",
    kv010: "<strong>Support application data:</strong> student certificate and reference letter submitted with travel/registration support applications.",
    kv011: "3. Purposes of Processing",
    kv012: "Conducting paper submission, peer review and scientific programme processes,",
    kv013: "Completing conference registration, payment, invoicing and certificate of attendance procedures,",
    kv014: "Sending participants announcements and information about the conference,",
    kv015: "Publishing accepted papers in the Proceedings and the IEEE Xplore Digital Library,",
    kv016: "Responding to requests and complaints submitted via the contact form and by e-mail,",
    kv017: "Fulfilling statutory retention, reporting and audit obligations.",
    kv018: "4. Legal Basis and Method of Collection",
    kv019: "Personal data is collected electronically via the conference website, the contact form, e-mail, the Microsoft CMT paper management system and the online registration system. Under Article 5/2 of the KVKK, processing is based on the grounds that it is <em>necessary for the conclusion or performance of a contract</em>, <em>necessary for the fulfilment of a legal obligation</em> and <em>necessary for the legitimate interests of the data controller</em>; in all other cases it is based on <em>your explicit consent</em>.",
    kv020: "5. Transfers",
    kv021: "Personal data may be transferred to reviewers and to the paper management system provider in order to conduct the review process, to IEEE within the publication process, to the payment institution during payment, and to authorised public institutions upon request, in accordance with the conditions set out in Articles 8 and 9 of the KVKK. As IEEE Xplore and the paper management system are services based abroad, transfers outside Türkiye may occur in this context.",
    kv022: "6. Retention Period",
    kv023: "Data is retained for the periods prescribed by the relevant legislation and for as long as the conference and publication processes require; at the end of these periods it is deleted, destroyed or anonymised. Author information in published papers is retained permanently in the archive as part of the scientific record.",
    kv024: "7. Rights of the Data Subject",
    kv025: "Pursuant to Article 11 of the KVKK, you have the right to: learn whether your personal data is processed; request information if it has been processed; learn the purpose of processing and whether the data is used in accordance with that purpose; know the third parties to whom the data is transferred in Türkiye or abroad; request correction if the data is incomplete or incorrect; request erasure or destruction; request that these actions be notified to third parties to whom the data was transferred; object to an outcome adverse to you arising from analysis carried out exclusively by automated systems; and claim compensation if you suffer damage.",
    kv026: "You may submit your requests to <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a> or to the University's postal address above. Applications are concluded within thirty days at the latest.",
    kv027: "8. Cookies",
    kv028: "This website does not use advertising or tracking cookies. Your browser's local storage (<code>localStorage</code>) is used only to remember your language preference; this data is not sent to the server and can be cleared from your browser settings.",
    kv029: "The campus map in the Travel section of the Registration page and the map on the Archive page load imagery from the OpenStreetMap project's public tile servers. In doing so, your browser's IP address is transmitted to those servers; no cookies are used. The map library (Leaflet) is served directly from this website, not from a third-party server.",
    kv030: "9. Accessibility",
    kv031: "The SIU 2027 website is developed in line with the WCAG 2.1 AA criteria and the Turkish Public Websites Guide: semantic HTML structure, full keyboard navigation, visible focus indicators, alternative text on all images and reduced-motion support for users sensitive to animation. If you identify an accessibility problem, please report it to <a href=\"mailto:siu2027@medipol.edu.tr?subject=Eri%C5%9Filebilirlik%20Geri%20Bildirimi\">siu2027@medipol.edu.tr</a>.",
    kv032: "This text is for information purposes and must be approved by the Istanbul Medipol University Legal Counsel / KVKK unit before publication.",
    mobileMenuLang: "LANGUAGE",
    navAbout: "About",
    navAboutHistory: "SIU History (1993–2027)",
    navAboutHost: "Host Institution",
    navAboutMsg: "Welcome Message",
    navAboutScope: "Scope and Objectives",
    navArchive: "Archive",
    navAuthors: "Authors",
    navAuthorsCamera: "Camera-Ready & Copyright",
    navAuthorsCfp: "Call for Papers (CFP)",
    navAuthorsSpecial: "Call for Special Sessions",
    navAuthorsTemplates: "Paper Templates",
    navAuthorsTracks: "Topics and Tracks",
    navCommittees: "Committees",
    navCompetitions: "Competitions",
    navCompetitionsThesis: "5-Minute Thesis Competition",
    navCompetitionsTravel: "Student Travel Grants",
    navCompetitionsUndergrad: "Undergraduate Project Contest",
    navContact: "Contact",
    navHome: "Home",
    navProgram: "Program",
    navProgramDetail: "Detailed Scientific Program",
    navProgramOverview: "Program at a Glance",
    navProgramSocial: "Social Program & Gala",
    navProgramSpeakers: "Keynote Speakers",
    navProgramTutorials: "Tutorials",
    navProgramPanels: "Panels",
    navQuickSubmit: "Paper Submission",
    navRegistration: "Registration",
    navRegistrationAccom: "Accommodation",
    navRegistrationFaq: "Frequently Asked Questions",
    navRegistrationFees: "Registration Fees",
    navRegistrationTravel: "Transportation & Campus Map",
    newsDesc4: "Travel, accommodation and other support for students will be announced.",
    newsTag4: "STUDENT SUPPORT",
    newsTitle4: "Student Support",
    newsTag5: "SPECIAL SESSIONS",
    newsTitle5: "Call for Special Sessions: Proposals Due November 16, 2026",
    newsDesc5: "Special sessions on current and specialised research topics will be organised at SIU 2027. Proposals must be sent to siu2027@medipol.edu.tr by November 16, 2026; accepted sessions will be notified by November 30, 2026.",
    nf001: "ERROR 404",
    nf002: "The page you are looking for was not found",
    nf003: "The link may have moved, been renamed, or the address may be mistyped. You can continue from the sections below.",
    nf004: "<a href=\"/siu2027/\" class=\"btn btn--primary\">Home</a> <a href=\"/siu2027/yazarlar#cfp\" class=\"btn\">Call for Papers</a> <a href=\"/siu2027/program\" class=\"btn\">Scientific Programme</a> <a href=\"/siu2027/katilim#kayit\" class=\"btn\">Registration and Fees</a> <a href=\"/siu2027/iletisim\" class=\"btn\">Contact</a>",
    nf005: "If the problem persists, please report it to <a href=\"mailto:siu2027@medipol.edu.tr\">siu2027@medipol.edu.tr</a>.",
    pr001: "PROGRAMME AT A GLANCE",
    pr029: "Session Schedule",
    pr072: "KEYNOTE SPEAKERS",
    pr073: "Keynote Speakers",
    pr074: "Keynote speakers will be announced here.",
    pr076: "TUTORIALS",
    pr077: "Tutorials",
    pr078a: "Tutorial days and times will be announced.",
    pr078b: "Panels",
    pr078c: "Panels will be announced here.",
    pr079: "CALL FOR TUTORIALS",
    pr080: "Tutorial Proposals",
    pr081: "Half-day (3-hour) tutorial proposals may be sent to the Conference Secretariat, including the title, a summary of the scope, the target audience and the instructors' biographies.",
    pr082: "SUBMIT A PROPOSAL",
    pr083: "CALL FOR PANELS",
    pr084: "Industry and Defence Panels",
    pr085: "Panel proposals on university–industry collaboration, 6G, autonomous systems and defence technologies are welcome.",
    pr086: "SUBMIT A PROPOSAL",
    pr087: "SOCIAL EVENTS",
    pr088a: "The social programme will be announced here.",
    programKicker: "CONFERENCE SCHEDULE & SESSIONS",
    programPageDesc: "Overall flow, session schedule, keynote speakers, tutorials and social programme.",
    programPageTitle: "Conference Program",
    readMore: "READ MORE",
    searchPlaceholder: "Search SIU 2027 (papers, templates, registration, program)...",
    speakersKicker: "SCIENTIFIC VISION",
    sponsorsCta: "Contact us about sponsorship",
    sponsorsPending: "Technical sponsorship, corporate sponsorship and exhibition space have not been finalised yet. Supporting organisations will be announced here once confirmed.",
    sponsorsTierHost: "HOST AND ORGANIZING INSTITUTIONS",
    sponsorsTierTech: "TECHNICAL SPONSORSHIP",
    tba101: "SIU 2027 will run for four days, July 4–7, 2027.",
    tba102: "Daily programme schedule — To Be Announced (TBA)",
    tba103: "The daily schedule and timings for the opening session, parallel sessions, poster session, panels and closing ceremony will be published on this page as the scientific programme is finalised.",
    tba104: "DETAILED SCIENTIFIC PROGRAMME",
    tba105: "Session schedule — To Be Announced (TBA)",
    tba107: "GO TO THE CALL FOR PAPERS",
    tba109: "Social Programme",
    tba110: "A gala dinner and social events programme are planned as part of the conference. The content, date and venue of these events will be announced in this section and in the conference announcements once confirmed.",
    tba201: "TBA",
    tba202: "Fees will be announced once confirmed",
    tba203: "Gala dinner ticket: TBA",
    tba204: "Presentation of 1 paper (student presenter), all sessions, lunches, refreshments, certificate. (Gala ticket optional.)",
    tba205: "A single full or student registration covers at most one (1) paper presentation. A discounted additional paper fee applies to a second accepted paper by the same author; the amount will be announced in the fee table.",
    tba206: "Social programme (TBA)",
    tba207: "<strong>Registration fees have not been finalised yet.</strong> The amounts will be published in this table once approved by the University.",
    tba208: "<strong>Istanbul Airport (IST):</strong> HAVAİST airport buses provide access with a transfer at Kavacık. For current routes and timetables see <a href=\"https://hava.ist\" target=\"_blank\" rel=\"noopener\">hava.ist</a>.",
    tba209: "<strong>Sabiha Gökçen Airport (SAW):</strong> HAVABÜS lines or İETT buses can be used via Kadıköy / Levent with a transfer at Kavacık.",
    tba210: "<strong>Public transport:</strong> Kavacık is a transfer hub reachable by İETT buses from both sides of Istanbul. The stops within walking distance of the campus are marked on the map below; for current route numbers see <a href=\"https://iett.istanbul\" target=\"_blank\" rel=\"noopener\">iett.istanbul</a> or use a maps application.",
    tba211: "<strong>On campus:</strong> the Medipol halls of residence and guesthouse on the Kavacık South Campus are planned to be made available, particularly for students, graduate researchers and participants looking for budget-friendly accommodation. Capacity, pricing and room facilities will be announced once confirmed.",
    tba301: "Award amounts will be announced once confirmed.",
    tba401: "Opening Session: <strong>July 4, 2027</strong> • Time: TBA",
    tba501: "Conference activities will take place at the Congress and Culture Centre on the Kavacık South Campus, in the main conference auditorium, the parallel session halls and the poster foyer. The allocation of halls and their capacities will be announced once the programme is finalised. Located at the exit of the Fatih Sultan Mehmet Bridge, the campus is easily reached from both sides of Istanbul.",
    theLatestKicker: "ANNOUNCEMENTS",
    topbarDate: "July 4–7, 2027 | Istanbul",
    topbarSearchBtn: "Search",
    track1Title: "Communications and Networks",
    track2Title: "Image Processing and Computer Vision",
    track3Title: "Signal Processing and Robotics",
    track4Title: "Machine Learning and Artificial Intelligence",
    track6Title: "Natural Language Processing",
    track5Title: "Biomedical Signal/Image Processing",
    trackNum1: "TRACK 1",
    trackNum2: "TRACK 2",
    trackNum3: "TRACK 3",
    trackNum4: "TRACK 4",
    trackNum5: "TRACK 5",
    trackNum6: "TRACK 6",
    tracksKicker: "TECHNICAL PROGRAM & TRACKS",
    tracksTitle: "Topics and Research Tracks",
    ttl404: "Page Not Found (404) | IEEE SIU 2027",
    ttlArsiv: "SIU Conference Archive 1993–2027 | IEEE SIU 2027",
    ttlHakkinda: "About the Conference | IEEE SIU 2027 — Istanbul Medipol University",
    ttlIletisim: "Contact and Conference Secretariat | IEEE SIU 2027",
    ttlIndex: "IEEE SIU 2027 | 35th Signal Processing and Communications Applications Conference",
    ttlKatilim: "Registration: Fees, Accommodation, Travel | IEEE SIU 2027",
    ttlKomiteler: "Committees and Organising Committee | IEEE SIU 2027",
    ttlKayit: "Registration Form | IEEE SIU 2027",
    ttlKvkk: "Personal Data Protection (KVKK) Notice | IEEE SIU 2027",
    ttlProgram: "Scientific Programme and Sessions | IEEE SIU 2027",
    ttlYarisma: "Competitions and Student Support | IEEE SIU 2027",
    ttlYazarlar: "For Authors: Call for Papers and Templates | IEEE SIU 2027",
    viewAllNews: "View All News",
    yarismaKicker: "YOUNG RESEARCHER & STUDENT PROGRAMS",
    yarismaPageDesc: "Undergraduate Project Competition (LISPO), 5-Minute Thesis Competition (5DTC), and SIU 2027 Student Travel & Registration Grants.",
    yarismaPageTitle: "Competitions and Grants",
    yazarlarKicker: "AUTHOR GUIDELINES & PAPER SUBMISSION",
    yazarlarPageDesc: "Call for Papers (CFP), the Microsoft CMT submission system, standard two-column templates, the double-blind review policy, and special session proposals.",
    yazarlarPageTitle: "For Authors",
    yr001: "Competitions",
    yr002: "• Undergraduate Project Competition",
    yr003: "• 5-Minute Thesis Competition",
    yr004: "• Travel & Registration Support",
    yr005: "UNDERGRADUATE CAPSTONE AND RESEARCH PROJECTS",
    yr006: "SIU Undergraduate Project Competition (LİSPO 2027)",
    yr007: "LİSPO is organised to reward the capstone or research projects of undergraduate students in Electrical–Electronics, Communications, Computer, Biomedical and Artificial Intelligence Engineering at universities in Türkiye and the TRNC, and to bring those projects together with industry.",
    yr008: "LİSPO 2027 Awards",
    yr009: "FIRST PRIZE",
    yr010: "SECOND PRIZE",
    yr011: "THIRD PRIZE",
    yr012: "Eligibility:",
    yr013: "Applicants must be enrolled in a relevant undergraduate programme during the 2026–2027 academic year.",
    yr014: "A project paper of at most 4 pages and a 2-minute introductory video must be uploaded to the system.",
    yr015: "Projects passing the preselection will be presented to the jury at the conference venue with a poster and a working prototype.",
    yr017: "GRADUATE THESIS PRESENTATIONS",
    yr018: "5-Minute Thesis Competition (5DTY 2027)",
    yr019: "A dynamic science communication competition in which master's and doctoral students present their thesis topic effectively to a broad audience and an evaluation jury within just 5 minutes, using a single static slide.",
    yr020: "Format & Criteria:",
    yr021: "The time limit is strictly 5 minutes (the microphone is cut off if it is exceeded).",
    yr022: "Only a single static slide may be used (animation and audio recordings are not permitted).",
    yr023: "Assessment: scientific depth, societal impact, presentation skills and time management.",
    yr024: "Separate awards will be given in the doctoral and master's categories.",
    yr025: "CONFERENCE STUDENT SUPPORT FUND",
    yr026: "Student Travel and Registration Support",
    yr027: "With contributions from Istanbul Medipol University, <strong>travel and free registration support</strong> will be provided to undergraduate and graduate students in need who travel from outside Istanbul to present an accepted paper as an oral or poster presentation.",
    yr028: "Required Documents:",
    yr029: "Accepted paper number (Paper ID) and acceptance letter",
    yr030: "Reference and support request letter from the supervising faculty member",
    yr031: "Current student certificate",
    yr032: "Short letter of motivation and estimated budget summary",
    yr033: "Send Travel Support Application E-mail",
    yz001: "Author Guide",
    yz002: "• Call for Papers (CFP)",
    yz003: "• Topics and Tracks (6 Tracks)",
    yz004: "• Format & Double-Blind Rules",
    yz005: "• CMT Submission Guide",
    yz006: "• Paper Templates (LaTeX/Word)",
    yz007: "• Call for Special Sessions",
    navAuthorsTutCall: "Call for Tutorials",
    descAuthorsTutCall: "To be announced",
    navAuthorsPanelCall: "Call for Panels",
    descAuthorsPanelCall: "To be announced",
    yzTutCallTitle: "Call for Tutorials",
    yzTutCallNote: "The call for tutorials will be announced here.",
    yzPanelCallTitle: "Call for Panels",
    yzPanelCallNote: "The call for panels will be announced here.",
    yzTutCallToc: "• Call for Tutorials",
    yzPanelCallToc: "• Call for Panels",
    yz008: "• Camera-Ready & Copyright",
    yz009: "OFFICIAL CALL",
    yz010: "Call for Papers",
    yz011: "The 35th Signal Processing and Communications Applications Conference (SIU 2027) will be held <strong>July 4–7, 2027</strong> at the Kavacık Campus of <strong>Istanbul Medipol University</strong>.",
    yz011a: "The call for papers (CFP) will be announced here.",
    yz013: "Page Limit: 4 Pages Maximum",
    yz014: "Papers must be at most 4 pages in the standard IEEE two-column format, including references and all figures.",
    yz015: "Double-Blind Review",
    yz016: "Author names, affiliations and acknowledgements must be omitted in the initial submission.",
    yz019: "IEEE Xplore and Proceedings",
    yz020: "Accepted and presented full-text papers meeting the applicable IEEE publication requirements are planned to be submitted for inclusion in the IEEE Xplore Digital Library.",
    yz022: "CMT Paper Submission System",
    yz022a: "Publication of Papers in IEEE Xplore Is Planned",
    yz022b: "Full papers presented at the conference are planned to be submitted to IEEE Xplore. Details will be announced once the technical sponsorship process is complete.",
    yz023: "OFFICIAL TRACKS",
    yz024: "Topics and Research Tracks",
    yz025: "SIU 2027 accepts original research papers in the <strong>6 official main tracks</strong> listed below and their related subtopics. Beyond these headings, original papers from every theoretical and applied area of signal processing and communications are also welcome:",
    yz026: "Track 1: Communications and Networks",
    yz027: "<span>• Information Theory and Coding</span> <span>• Communication Theory and Applications</span> <span>• Wireless Communications and Networks</span> <span>• 6G and Beyond Technologies</span> <span>• Internet of Things (IoT)</span> <span>• Vehicular Communications</span> <span>• Cyber-Physical Systems</span> <span>• Integrated Sensing and Communications</span> <span>• Satellite and Deep Space Communications</span> <span>• Optical Communications and Networking</span> <span>• Energy Harvesting and Low Energy Communications</span> <span>• Security and Privacy in Communications and Networking</span> <span>• Digital Twins</span> <span>• Molecular and Nano Communications</span> <span>• Quantum Communications</span> <span>• Age and Value of Information</span> <span>• Cooperative Communications and Networking</span> <span>• Energy-Efficient and Green Networking</span> <span>• Holographic Surfaces and MIMO</span> <span>• Edge Computing, Edge Intelligence and Fog Networks</span> <span>• Millimeter-Wave and Terahertz</span> <span>• Network Security and Privacy</span> <span>• Physical Layer Security</span> <span>• Resource Allocation</span> <span>• SDN/NFV</span> <span>• Semantic and Goal-Oriented Communication</span> <span>• UAVs and Non-Terrestrial Networks</span> <span>• Wireless Power and Information Transfer</span> <span>• Wireless Networks</span> <span>• Backscatter and RIS-based Communications</span>",
    yz028: "Track 2: Image Processing and Computer Vision",
    yz029: "<span>• Image and Video Processing</span> <span>• Object Detection and Pattern Recognition</span> <span>• Multi-Channel and Multi-Camera Processing</span> <span>• Image/Video Coding and Compression</span> <span>• Image and Video-based Biometrics</span> <span>• Document Analysis and Understanding</span> <span>• Remote Sensing and Geospatial Analysis</span> <span>• 3D Imaging and Computational Photography</span> <span>• Vision Foundation Models, Vision-Language Models</span>",
    yz030: "Track 3: Signal Processing and Robotics",
    yz031: "<span>• Signal Processing Theory</span> <span>• Statistical Signal Processing</span> <span>• Audio/Speech Processing</span> <span>• Radar Signal Processing</span> <span>• Signal Processing for Cybersecurity Applications</span> <span>• Signal Processing for Autonomous Systems</span> <span>• Industrial and Automotive Applications</span> <span>• Real-Time Signal Processing and Embedded Systems</span> <span>• E-Health Applications and Assistive Technologies</span> <span>• Financial Signal Processing</span> <span>• Marine, Air and Land Robots</span> <span>• Industrial Robots</span> <span>• Humanoid and Social Robots</span> <span>• Swarm Robots</span> <span>• Control Algorithms</span> <span>• Positioning, Mapping and Navigation</span> <span>• Human-Robot Interaction</span> <span>• Robot-Object Interaction</span> <span>• Robot Architectures, Software, Simulators and Operating Systems</span> <span>• Vision and Perception in Robots</span>",
    yz032: "Track 4: Machine Learning and Artificial Intelligence",
    yz033: "<span>• Machine Learning Theory</span> <span>• Deep Learning</span> <span>• Machine Learning for Healthcare</span> <span>• ML/DL for Communication Systems</span> <span>• Multimodal Analysis</span> <span>• Reinforcement Learning</span> <span>• Adversarial ML and Robust AI</span> <span>• Transfer, Semi-Supervised and Unsupervised Learning</span> <span>• ML/DL in Signal Processing</span> <span>• Performance Analysis of ML Techniques</span> <span>• Explainable AI and Trustworthy ML</span>",
    yz034: "Track 5: Biomedical Signal/Image Processing",
    yz035: "<span>• Biomedical Signal Analysis</span> <span>• Medical Image Analysis and Applications</span> <span>• Bioinformatics and Genomic Signal Processing</span> <span>• Wearable Sensors and E-Health</span> <span>• Biomedical Data Privacy and Security</span> <span>• Biosignal Processing for Health Monitoring</span> <span>• Applications of Artificial Intelligence for Medical Diagnosis</span> <span>• Telemedicine and Remote Patient Monitoring</span> <span>• Neuroengineering and Brain Signal Processing</span>",
    yz035a: "Track 6: Natural Language Processing",
    yz035b: "<span>• Large Language Models and Training Strategies</span> <span>• Artificial Intelligence and Large Language Model Agents</span> <span>• Dialogue and Interactive Systems</span> <span>• Information Extraction and Retrieval</span> <span>• Linguistic Theories, Cognitive Models</span> <span>• Translation and Multi-Language Processing</span> <span>• Phonology, Morphology and Word Segmentation</span> <span>• Semantics in Language</span> <span>• Sentiment, Style and Argument Analysis in Texts</span> <span>• Speech Processing and Recognition</span> <span>• Text Summarization, Question Answering</span>",
    yz036: "<strong>Note:</strong> A pre-configured template package specific to SIU 2027 will be published on this page once it is ready. Until then, please use the official IEEE conference templates above.",
    yz037: "SCIENTIFIC REVIEW PRINCIPLES",
    yz038: "Format and Double-Blind Rules",
    yz039: "SIU 2027 applies a <strong>double-blind review</strong> process to safeguard scientific impartiality and the highest academic quality. Authors must observe the following in the PDF they prepare for the initial review:",
    yz040: "<strong>Author names, titles, affiliations and e-mail addresses</strong> must not appear beneath the paper title.",
    yz041: "Sections that reveal author identity, such as acknowledgements and project grant numbers, must be removed from the initial review version.",
    yz042: "When citing their own previous work, authors must use third-person wording (e.g. <em>\"In [3] it was shown\"</em> instead of <em>\"In our previous work [3]\"</em>).",
    yz043: "The author name and computer user name in the PDF file properties (metadata) must be cleared.",
    yz044: "SUBMISSION PORTAL",
    yz045: "Microsoft CMT Paper Submission Guide",
    yz046: "Research papers will be submitted exclusively through the Microsoft CMT (Conference Management Toolkit) system. Papers submitted by email will not be considered. The submission system will open before the paper submission period begins, and the link will be announced on this page.",
    yz047: "Step-by-Step Submission Process:",
    yz048: "Sign in with your Microsoft CMT account. If you do not have one, create a free account on CMT.",
    yz048b: "Open the SIU 2027 submission page: <a href=\"https://cmt3.research.microsoft.com/SIU2027\" target=\"_blank\" rel=\"noopener\">cmt3.research.microsoft.com/SIU2027</a>",
    yz049: "Click \"Create new submission\".",
    yz050: "Select the <strong>Primary Track</strong> that best matches your paper's topic and, if needed, a Secondary Track.",
    yz052: "Upload the <strong>PDF of at most 4 pages</strong>, prepared in line with the double-blind rules (containing no author information).",
    yz053: "Click \"Submit\" and check for the confirmation e-mail.",
    yz053b: "Complete your submission before the deadline: <strong>February 1, 2027</strong>.",
    yz054: "Microsoft CMT SIU 2027 Submission Page",
    yz054b: "The submission system is not open yet; it will be announced on this page once it opens.",
    yz055: "FILE FORMATS",
    yz056: "Paper Templates (IEEE LaTeX & MS Word)",
    yz057: "Papers must be prepared in the standard <strong>IEEE two-column A4</strong> conference format. The page size, margins, font sizes and column widths in the templates must not be altered under any circumstances.",
    yz057a: "The paper template will be announced here.",
    yz058: "IEEE LaTeX Template Package",
    yz059: "The current IEEEtran package, compatible with Overleaf and TeX Live, containing all macro and style files (.cls, .tex, .bib).",
    yz060: "Official IEEE LaTeX Template ↗",
    yz061: "IEEE Microsoft Word Template",
    yz062: "A Microsoft Word (.docx) template file in A4 size containing predefined IEEE styles.",
    yz063: "Official IEEE Word Template ↗",
    yz064: "CALL FOR SPECIAL SESSIONS",
    yz065: "Special Session Proposal Guidelines",
    yz067: "Special session title and a summary of its scope (maximum 1 page)",
    yz068: "Biographies and contact details of the session organisers",
    yz069: "At least 5 draft paper titles and their author lists planned to be invited to the session",
    yz070: "PUBLICATION AND COPYRIGHT PROCESS",
    yz071: "Camera-Ready Paper & IEEE Copyright Transfer",
    yz072: "For papers accepted after peer review to be published in the <strong>IEEE Xplore Digital Library</strong>, authors must complete the following steps:",
    yz072a: "The camera-ready paper and IEEE copyright transfer process will be announced here.",
    yz073: "<strong>Adding Author and Affiliation Information:</strong> the names, surnames, affiliations and e-mail addresses of all authors must be added to the camera-ready text revised in line with the reviewers' comments.",
    yz074: "<strong>IEEE PDF eXpress Check:</strong> the final PDF must be processed through <strong>IEEE PDF eXpress</strong>, which verifies IEEE Xplore format compliance. (The system conference ID will be announced with the acceptance letters.)",
    yz075: "<strong>IEEE Copyright Transfer (IEEE eCF):</strong> the copyright transfer must be approved online via the <strong>IEEE Electronic Copyright Form (eCF)</strong> link provided through the Microsoft CMT system.",
    arh001: "Conference Map (1993 – 2027)",
    arh002: "Where SIU conferences have been held across Türkiye and the TRNC. Drag the year slider or use the arrow keys to step through the conferences; circle size shows how many times a place has hosted.",
    arh003: "Year",
    arh004: "Previous conference",
    arh005: "Next conference",
    arh006: "Play in sequence",
    arh007: "Stop",
    arh008: "Held online — no location on the map.",
    arh009: "Conferences",
    arh010: "Host cities",
    arh011: "Host institutions",
    arh012: "Map data © OpenStreetMap contributors (ODbL). The full list is in the table below.",
    ky001: "Participant Details",
    ky002: "Full Name",
    ky003: "E-mail Address",
    ky004: "Institution / University",
    ky005: "Title",
    ky006: "Registration Category",
    ky007: "Please choose a category…",
    ky008: "Full Registration (Academic / Industry)",
    ky009: "Student Author Registration",
    ky010: "Graduate Listener Registration",
    ky011: "Undergraduate Listener Registration",
    ky012: "Paper Number",
    ky013: "If you have an accepted paper, enter its CMT number (e.g. #104). Leave blank for listener registrations.",
    ky014: "Invoice Details",
    ky015: "Individual invoice",
    ky016: "Corporate invoice",
    ky017: "Invoice Title",
    ky018: "Tax Office",
    ky019: "Tax / National ID Number",
    ky020: "Anything to add",
    ky021: "Let us know if you have any accessibility, dietary or invoicing requirements.",
    ky022: "Complete Pre-Registration",
    ky023: "Required field",
    ky024: "Registration categories",
    ky025: "Registration categories and package contents are on the Registration page.",
    ky026: "Registration page",
    ky027: "No payment at this step",
    ky028: "This form only creates a pre-registration. No card details are requested or stored. The payment step will be announced separately once fees are final.",
    ky029: "Your pre-registration has been received.",
    ky030: "Your registration number",
    ky031: "A confirmation message has been sent to your e-mail address. Please quote this number in correspondence.",
    ky032: "Sending…",
    kyKicker: "PARTICIPANT REGISTRATION",
    kyLede: "You can create your SIU 2027 pre-registration here. Because registration fees have not been finalised, no payment is taken at this step; you will be notified by e-mail once the fees are approved.",
    kyTitle: "Registration Form",
    ft001: "Call for Papers (CFP)",
    ft001a: "Topics and Tracks",
    ft003: "Paper Templates",
    ft004: "Scientific Programme",
    ft005: "Registration Fees",
    ft006: "Undergraduate Project Competition",
    ft007: "Conference Co-Chairs",
    ft008: "Organising Committee",
    ft009: "Technical Programme Committee",
    ft010: "Istanbul Medipol University",
    ft011: "1993–2027 Conference Archive",
    ft012: "Address",
    ft013: "E-mail",
    ft014: "Telephone",
    ft015: "Istanbul Medipol University, Kavacık South Campus, Göztepe Mah. Atatürk Cad. No: 40/16, 34815 Beykoz / Istanbul",
    ft016: "© 2027 Signal Processing and Communications Applications Conference (SIU 2027). All rights reserved.",
    ft017: "Accessibility",
    ft018: "Personal Data Protection (KVKK) Notice",
    ft019: "Permanent Archive",
    ft020: "Type what you are looking for, or pick one of the shortcuts.",
    searchNoResults: "No matching results.",
    ft021: "Close search",
    ft022: "Close menu",
    ft023: "Open menu",
  }
};

/* Dil tercihi deposu: tarayıcı site verisini engellerse localStorage hata fırlatır;
   o durumda tercih hatırlanmaz ama sayfanın geri kalanı çalışmaya devam eder. */
function getStoredLang() {
  try { return localStorage.getItem('siu_lang'); } catch (e) { return null; }
}
function setStoredLang(lang) {
  try { localStorage.setItem('siu_lang', lang); } catch (e) { /* depolama kapalı */ }
}

function initLangSwitcher() {
  // URL parametresi (?lang=en) localStorage'dan önceliklidir:
  // kurultay sekreterliği CMT başvurusunda doğrudan İngilizce bağlantı paylaşabilsin.
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  let currentLang = (urlLang === 'en' || urlLang === 'tr')
    ? urlLang
    : (getStoredLang() || 'tr');

  function setLanguage(lang) {
    currentLang = lang;
    setStoredLang(lang);
    document.documentElement.lang = lang;

    // Sekme başlığı da dile uysun (CMT/uluslararası ziyaretçiler için)
    const titleKey = document.body.getAttribute('data-title-key');
    if (titleKey && i18nDictionary[lang] && i18nDictionary[lang][titleKey]) {
      document.title = i18nDictionary[lang][titleKey];
    }

    // Buton aktiflik durumu (tüm butonlar: desktop topbar + header + mobile drawer)
    document.querySelectorAll('.lang-btn-tr').forEach(btn => {
      btn.classList.toggle('active', lang === 'tr');
    });
    document.querySelectorAll('.lang-btn-en').forEach(btn => {
      btn.classList.toggle('active', lang === 'en');
    });

    // data-i18n etiketlerini güncelle (metin içeriği)
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (i18nDictionary[lang] && i18nDictionary[lang][key] !== undefined) {
        el.textContent = i18nDictionary[lang][key];
      }
    });

    // data-i18n-html etiketlerini güncelle (HTML formatlı içerik)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      if (i18nDictionary[lang] && i18nDictionary[lang][key] !== undefined) {
        el.innerHTML = i18nDictionary[lang][key];
      }
    });

    // Input placeholder çevirisi
    document.querySelectorAll('#globalSearchInput, [data-i18n-placeholder]').forEach(input => {
      if (i18nDictionary[lang] && i18nDictionary[lang].searchPlaceholder) {
        input.placeholder = i18nDictionary[lang].searchPlaceholder;
      }
    });
  }

  // Event listener bağlama (hem mevcut hem sonradan eklenen butonlar için)
  document.addEventListener('click', (e) => {
    const trTarget = e.target.closest('.lang-btn-tr');
    if (trTarget) {
      setLanguage('tr');
      return;
    }
    const enTarget = e.target.closest('.lang-btn-en');
    if (enTarget) {
      setLanguage('en');
      return;
    }
  });

  // İlk yükleme
  setLanguage(currentLang);
}

/* ==========================================================================
   4. İnteraktif Bilimsel Program Filtresi
   ========================================================================== */
function initProgramFilters() {
  const dayTabs = document.querySelectorAll('.filter-day-btn');
  const hallTabs = document.querySelectorAll('.filter-hall-btn');
  const trackTabs = document.querySelectorAll('.filter-track-btn');
  const searchInput = document.getElementById('programSearchInput');
  const sessionCards = document.querySelectorAll('.session-card');

  if (!sessionCards.length) return;

  let activeDay = 'all';
  let activeHall = 'all';
  let activeTrack = 'all';
  let searchKeyword = '';

  function applyFilters() {
    sessionCards.forEach(card => {
      const cardDay = card.getAttribute('data-day') || 'all';
      const cardHall = card.getAttribute('data-hall') || 'all';
      const cardTrack = card.getAttribute('data-track') || 'all';
      const textContent = card.textContent.toLowerCase();

      const matchDay = (activeDay === 'all' || cardDay === activeDay);
      const matchHall = (activeHall === 'all' || cardHall === activeHall);
      const matchTrack = (activeTrack === 'all' || cardTrack === activeTrack);
      const matchSearch = (!searchKeyword || textContent.includes(searchKeyword));

      if (matchDay && matchHall && matchTrack && matchSearch) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  }

  dayTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      dayTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDay = btn.getAttribute('data-filter-day');
      applyFilters();
    });
  });

  hallTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      hallTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeHall = btn.getAttribute('data-filter-hall');
      applyFilters();
    });
  });

  trackTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      trackTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTrack = btn.getAttribute('data-filter-track');
      applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchKeyword = e.target.value.toLowerCase().trim();
      applyFilters();
    });
  }
}

/* ==========================================================================
   5. Tarihsel Arşiv Canlı Arama (1993–2027 SİU Tablosu)
   ========================================================================== */
function initArchiveSearch() {
  const archiveInput = document.getElementById('archiveSearchInput');
  const tableRows = document.querySelectorAll('.archive-table tbody tr');

  if (!archiveInput || !tableRows.length) return;

  archiveInput.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
    tableRows.forEach(row => {
      const text = row.textContent.toLowerCase();
      if (text.includes(val)) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  });
}

/* ==========================================================================
   6. Global Arama Modalı (Ctrl+K / Modal Trigger)
   ========================================================================== */
function initSearchModal() {
  let modal = document.getElementById('searchModal');
  const openBtns = document.querySelectorAll('.open-search-modal');

  if (!modal && openBtns.length > 0) {
    modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'searchModal';
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('role', 'dialog');
    modal.innerHTML = `
      <div class="search-modal-box">
        <div class="search-modal-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="search-modal-input" id="globalSearchInput" placeholder="SİU 2027'de arayın (bildiri, şablon, kayıt, program)..." autocomplete="off">
          <button type="button" class="search-modal-close" aria-label="Aramayı kapat">&times;</button>
        </div>
        <div class="search-modal-results" id="globalSearchResults">
          <p class="search-modal__hint">Aramak istediğiniz konuyu yazın veya hızlı başlıklardan seçin.</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  if (!modal) return;

  const closeBtn = modal.querySelector('.search-modal-close');
  const input = modal.querySelector('#globalSearchInput');
  const resultsWrap = modal.querySelector('#globalSearchResults');

  function openModal() {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    if (input) {
      setTimeout(() => input.focus(), 100);
    }
  }

  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  openBtns.forEach(btn => btn.addEventListener('click', openModal));
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      modal.classList.contains('open') ? closeModal() : openModal();
    }
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeModal();
    }
  });

  // Arama dizini: her kayıt iki dilde başlık/yol + eşleşme için anahtar kelimeler.
  const searchIndex = [
    { url: 'yazarlar#cfp', tr: ['Bildiri Çağrısı (CFP)', 'Yazarlar İçin › Bildiri Çağrısı'], en: ['Call for Papers (CFP)', 'For Authors › Call for Papers'], kw: 'cfp bildiri çağrı gönderim cmt call papers paper submission' },
    { url: 'yazarlar#kulvarlar', tr: ['Konular ve Araştırma Kulvarları', 'Yazarlar İçin › Kulvarlar'], en: ['Topics and Research Tracks', 'For Authors › Tracks'], kw: 'kulvar konu iletişim ağlar 6g görüntü bilgisayarlı görü sinyal robotik makine öğrenmesi yapay zeka biyomedikal doğal dil track topic communications vision robotics machine learning ai biomedical nlp' },
    { url: 'yazarlar#sablonlar', tr: ['Bildiri Şablonları', 'Yazarlar İçin › Şablonlar'], en: ['Paper Templates', 'For Authors › Templates'], kw: 'şablon latex word format ieee template' },
    { url: 'yazarlar#ozel-oturumlar', tr: ['Özel Oturum Çağrısı', 'Yazarlar İçin › Özel Oturumlar'], en: ['Call for Special Sessions', 'For Authors › Special Sessions'], kw: 'özel oturum öneri special session proposal' },
    { url: 'yazarlar#egitim-cagrisi', tr: ['Eğitim Semineri Çağrısı', 'Yazarlar İçin › Eğitim Semineri Çağrısı'], en: ['Call for Tutorials', 'For Authors › Call for Tutorials'], kw: 'tutorial seminer eğitim çağrı öneri call proposal' },
    { url: 'yazarlar#panel-cagrisi', tr: ['Panel Çağrısı', 'Yazarlar İçin › Panel Çağrısı'], en: ['Call for Panels', 'For Authors › Call for Panels'], kw: 'panel çağrı öneri panels call proposal' },
    { url: 'yazarlar#baskiya-hazir', tr: ['Baskıya Hazır Bildiri ve Telif', 'Yazarlar İçin › Baskıya Hazır'], en: ['Camera-Ready Paper and Copyright', 'For Authors › Camera-Ready'], kw: 'baskıya hazır telif ecf pdf express camera ready copyright' },
    { url: './#tarihler', tr: ['Önemli Tarihler', 'Kurultay › Önemli Tarihler'], en: ['Important Dates', 'Conference › Important Dates'], kw: 'tarih son tarih takvim deadline dates calendar' },
    { url: 'program', tr: ['Bilimsel Program', 'Program'], en: ['Scientific Programme', 'Programme'], kw: 'program oturum akış session schedule' },
    { url: 'program#konusmacilar', tr: ['Davetli Konuşmacılar', 'Program › Davetli Konuşmacılar'], en: ['Keynote Speakers', 'Programme › Keynote Speakers'], kw: 'keynote davetli konuşmacı speaker' },
    { url: 'program#seminerler', tr: ['Eğitim Seminerleri', 'Program › Eğitim Seminerleri'], en: ['Tutorials', 'Programme › Tutorials'], kw: 'tutorial seminer eğitim' },
    { url: 'program#paneller', tr: ['Paneller', 'Program › Paneller'], en: ['Panels', 'Programme › Panels'], kw: 'panel panels' },
    { url: 'program#sosyal-program', tr: ['Sosyal Program', 'Program › Sosyal Program'], en: ['Social Programme', 'Programme › Social Programme'], kw: 'sosyal gala etkinlik social dinner' },
    { url: 'katilim#kayit', tr: ['Kayıt Ücretleri ve Paketler', 'Katılım › Kayıt Ücretleri'], en: ['Registration Fees and Packages', 'Registration › Fees'], kw: 'kayıt ücret paket öğrenci registration fee package student' },
    { url: 'kayit', tr: ['Kayıt Formu', 'Katılım › Kayıt Formu'], en: ['Registration Form', 'Registration › Form'], kw: 'kayıt form kaydol register form' },
    { url: 'katilim#konaklama', tr: ['Konaklama', 'Katılım › Konaklama'], en: ['Accommodation', 'Registration › Accommodation'], kw: 'konaklama otel oda accommodation hotel room' },
    { url: 'katilim#ulasim', tr: ['Ulaşım ve Kampüs Haritası', 'Katılım › Ulaşım'], en: ['Travel and Campus Map', 'Registration › Travel'], kw: 'ulaşım harita havalimanı otobüs kavacık güney kampüs travel map airport bus campus' },
    { url: 'komiteler', tr: ['Komiteler ve Kurullar', 'Komiteler'], en: ['Committees', 'Committees'], kw: 'komite kurul başkan eş başkan tpc onur kurulu committee chair co-chair honorary' },
    { url: 'hakkinda', tr: ['Kurultay Hakkında', 'Kurultay › Hakkında'], en: ['About the Conference', 'Conference › About'], kw: 'hakkında hoş geldiniz kapsam medipol ev sahibi about welcome scope host' },
    { url: 'arsiv', tr: ['SİU Kurultay Arşivi (1993–2027)', 'Arşiv › Kurultay Kronolojisi'], en: ['SIU Conference Archive (1993–2027)', 'Archive › Chronology'], kw: 'arşiv tarihçe geçmiş kronoloji archive history chronology' },
    { url: 'iletisim', tr: ['İletişim ve Sekreterlik', 'İletişim › Adres ve E-posta'], en: ['Contact and Secretariat', 'Contact › Address and E-mail'], kw: 'iletişim sekreterlik e-posta telefon adres contact secretariat email phone address' },
    { url: 'kvkk', tr: ['KVKK Aydınlatma Metni', 'Kurumsal › KVKK'], en: ['Privacy Notice', 'Legal › Privacy'], kw: 'kvkk gizlilik kişisel veri çerez privacy personal data cookie' }
  ];

  // Karşılaştırma harf ve aksandan bağımsız: "sablon" → "Şablon", "iletisim" → "İletişim".
  function fold(text) {
    return text.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  }
  searchIndex.forEach(item => {
    item.hay = fold([item.tr[0], item.tr[1], item.en[0], item.en[1], item.kw].join(' '));
  });

  // Bağlantılar sayfanın bulunduğu köke göre kurulur (404 sayfası kök yollar kullanır).
  const cssLink = document.querySelector('link[href*="css/style.css"]');
  const base = cssLink ? cssLink.getAttribute('href').split('css/style.css')[0] : '';

  function currentLang() { return getStoredLang() === 'en' ? 'en' : 'tr'; }
  function t(key) {
    const dict = i18nDictionary[currentLang()] || i18nDictionary.tr;
    return dict[key] || i18nDictionary.tr[key] || '';
  }

  function render() {
    if (!input || !resultsWrap) return;
    const lang = currentLang();
    const words = fold(input.value.trim()).split(/\s+/).filter(Boolean);
    const matches = words.length
      ? searchIndex.filter(item => words.every(w => item.hay.includes(w)))
      : searchIndex;

    const hint = words.length ? '' : `<p class="search-modal__hint">${t('ft020')}</p>`;
    if (!matches.length) {
      resultsWrap.innerHTML = `<p class="search-modal__hint">${t('searchNoResults')}</p>`;
      return;
    }
    resultsWrap.innerHTML = hint + matches.map(item => `
      <a href="${base}${item.url}" class="search-result-item">
        <div class="search-result-title">${item[lang][0]}</div>
        <div class="search-result-crumb">${item[lang][1]}</div>
      </a>
    `).join('');
  }

  if (input && resultsWrap) {
    input.addEventListener('input', render);
    openBtns.forEach(btn => btn.addEventListener('click', render));
    document.querySelectorAll('.lang-btn-tr, .lang-btn-en').forEach(btn => btn.addEventListener('click', () => setTimeout(render, 0)));
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'k') setTimeout(render, 0);
    });
    render();
  }
}

/* ==========================================================================
   7. Mobil Çekmece Menüsü (Kusursuz Responsive Destek & Backdrop)
   ========================================================================== */
function initMobileMenu() {
  const toggleBtn = document.querySelector('.mobile-toggle');
  if (!toggleBtn) return;
  toggleBtn.setAttribute('aria-expanded', 'false');

  function getDrawer() {
    return document.getElementById('mobileDrawer');
  }

  function getBackdrop() {
    let backdrop = document.querySelector('.mobile-drawer-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'mobile-drawer-backdrop';
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', closeDrawer);
    }
    return backdrop;
  }

  function openDrawer() {
    const drawer = getDrawer();
    const backdrop = getBackdrop();
    if (drawer) drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function closeDrawer() {
    const drawer = getDrawer();
    const backdrop = document.querySelector('.mobile-drawer-backdrop');
    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.style.overflow = '';
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDrawer();
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('.mobile-drawer-close')) {
      closeDrawer();
    }
    if (e.target.closest('#mobileDrawer a')) {
      closeDrawer();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const drawer = getDrawer();
      if (drawer && drawer.classList.contains('open')) {
        closeDrawer();
      }
    }
  });
}

/* ==========================================================================
   9. Komite Üyesi Biyografileri (Modal)
   Not: Özetler kurumsal/açık kaynaklardan derlenmiştir; yayımdan önce
   ilgili kişilere teyit ettirilmelidir.
   ========================================================================== */
const committeeBios = {
  arslan: {
    url: 'https://avesis.medipol.edu.tr/huseyinarslan',
    tr: 'Lisans derecesini 1992’de Orta Doğu Teknik Üniversitesi’nden, yüksek lisans ve doktora derecelerini 1994 ve 1998’de Southern Methodist University’den (ABD) aldı. 1998–2002 arasında Ericsson’da 2G/3G kablosuz haberleşme projelerinde çalıştı; 2002–2022 arasında University of South Florida Elektrik Mühendisliği Bölümü’nde öğretim üyesi olarak görev yaptı. 2013’te İstanbul Medipol Üniversitesi’ne katılarak Mühendislik ve Doğa Bilimleri Fakültesi’ni kurdu ve fakültenin dekanlığını yürütmektedir. Başlıca çalışma alanları 5G/6G dalga biçimi tasarımı, fiziksel katman güvenliği, dinamik spektrum erişimi, bilişsel radyo ve vücut içi (in vivo) kanal modellemesidir. 2016’da bilişsel radyo ağlarında spektrum algılamaya katkılarından dolayı IEEE Fellow unvanını almıştır.',
    en: 'He received his B.S. from Middle East Technical University in 1992 and his M.S. and Ph.D. from Southern Methodist University (USA) in 1994 and 1998. From 1998 to 2002 he worked at Ericsson on 2G/3G wireless communication projects, and from 2002 to 2022 he was a faculty member in the Department of Electrical Engineering at the University of South Florida. He joined Istanbul Medipol University in 2013, where he founded the School of Engineering and Natural Sciences and serves as its Dean. His main research areas are 5G/6G waveform design, physical layer security, dynamic spectrum access, cognitive radio and in vivo channel modelling. He was named an IEEE Fellow in 2016 for contributions to spectrum sensing in cognitive radio networks.'
  },
  uysal: {
    url: 'https://eee.metu.edu.tr/personel/elif-uysal',
    tr: 'Lisans derecesini 1997’de ODTÜ’den, yüksek lisans derecesini 1999’da MIT’den ve doktorasını 2003’te Stanford Üniversitesi’nden aldı. 2003–2005 arasında MIT’de öğretim görevlisi, 2005–2006 arasında Ohio State University’de yardımcı doçent olarak çalıştı; 2006’dan bu yana ODTÜ Elektrik-Elektronik Mühendisliği Bölümü’nde öğretim üyesidir. Araştırmaları haberleşme ve ağ kuramının kesişiminde, enerji verimli ve düşük gecikmeli kablosuz sistemler üzerinde yoğunlaşmaktadır. 2015’ten itibaren haberleşme ağlarında Bilgi Yaşı (Age of Information) denetimine ilişkin temel ilkeleri geliştirmiş; bu alandaki öncü katkıları nedeniyle 2022’de IEEE Fellow seçilmiştir. TÜBİTAK Öncü Araştırmacı desteği, Bilim Akademisi Genç Bilim İnsanı Ödülü (2014) ve IBM Faculty Award (2010) sahibidir.',
    en: 'She received her B.S. from METU in 1997, her S.M. from MIT in 1999 and her Ph.D. from Stanford University in 2003. She was a lecturer at MIT (2003–2005) and an assistant professor at Ohio State University (2005–2006), and has been with the Department of Electrical and Electronics Engineering at METU since 2006. Her research lies at the intersection of communication and networking theory, focusing on energy-efficient and low-latency wireless systems. Since 2015 she has developed fundamental principles for the control of Age of Information in communication networks, and she was elevated to IEEE Fellow in 2022 for her pioneering contributions in this field. Her awards include the TÜBİTAK Pioneer Researcher grant, the Science Academy Young Scientist Award (2014) and an IBM Faculty Award (2010).'
  },
  duman: {
    url: 'http://ctar.bilkent.edu.tr/index.php/tolga-m-duman/',
    tr: 'Lisans derecesini 1993’te Bilkent Üniversitesi’nden, yüksek lisans ve doktora derecelerini 1995 ve 1998’de Northeastern University’den (ABD) aldı. 1998–2012 arasında Arizona State University’de sırasıyla yardımcı doçent, doçent ve profesör olarak görev yaptı; 2012’den bu yana Bilkent Üniversitesi Elektrik-Elektronik Mühendisliği Bölümü’nde profesördür. Başlıca çalışma alanları kablosuz ve mobil haberleşme, kodlama ve modülasyon, kablosuz sistemler için kanal kodlama ve makine öğrenmesi uygulamalarıdır. IEEE Fellow ve Bilim Akademisi üyesidir.',
    en: 'He received his B.S. from Bilkent University in 1993 and his M.S. and Ph.D. from Northeastern University (USA) in 1995 and 1998. From 1998 to 2012 he served at Arizona State University as assistant professor, associate professor and professor, and since 2012 he has been a professor in the Department of Electrical and Electronics Engineering at Bilkent University. His main research areas are wireless and mobile communications, coding and modulation, coding for wireless systems and machine learning applications. He is an IEEE Fellow and a member of the Science Academy of Türkiye.'
  },
  gezici: {
    url: 'https://www.ee.bilkent.edu.tr/~gezici/',
    tr: 'Lisans derecesini 2001’de Bilkent Üniversitesi’nden, doktorasını 2006’da Princeton Üniversitesi’nden aldı. 2006–2007 arasında Mitsubishi Electric Research Laboratories’de (ABD) çalıştı; 2007’den bu yana Bilkent Üniversitesi Elektrik-Elektronik Mühendisliği Bölümü’nde görev yapmakta olup hâlen profesördür. Araştırma alanları sezme ve kestirim kuramı, kablosuz haberleşme ve konumlandırma sistemleridir. Kablosuz konumlandırma ve ultra geniş bantlı (UWB) sistemlere katkılarından dolayı IEEE Fellow seçilmiştir.',
    en: 'He received his B.Sc. from Bilkent University in 2001 and his Ph.D. from Princeton University in 2006. He worked at Mitsubishi Electric Research Laboratories (USA) from 2006 to 2007 and has been with the Department of Electrical and Electronics Engineering at Bilkent University since 2007, where he is currently a professor. His research areas are detection and estimation theory, wireless communications and localization systems. He was named an IEEE Fellow for his contributions to wireless localization and ultra-wideband systems.'
  },
  koc: {
    url: 'http://aykut.koc.bilkent.edu.tr/',
    tr: 'Lisans derecesini 2005’te Bilkent Üniversitesi Elektrik-Elektronik Mühendisliği’nden aldı; yüksek lisans (elektrik mühendisliği, 2007), yüksek lisans (yönetim bilimi ve mühendisliği, 2009) ve doktora (elektrik mühendisliği, 2011) derecelerini Stanford Üniversitesi’nden tamamladı. Ayrıca Ankara Üniversitesi Hukuk Fakültesi mezunudur. Bilkent Üniversitesi Elektrik-Elektronik Mühendisliği Bölümü ve Ulusal Manyetik Rezonans Araştırma Merkezi’nde (UMRAM) öğretim üyesidir. Araştırma grubu, sinyal işleme ve makine öğrenmesinin doğal dil işleme ve çizge sinyal işleme (GSP) alanlarına uzanan kesişiminde; özellikle kesirli Fourier dönüşümü tabanlı yöntemler üzerinde çalışmaktadır.',
    en: 'He received his B.S. in electrical and electronics engineering from Bilkent University in 2005, and an M.S. in electrical engineering (2007), an M.S. in management science and engineering (2009) and a Ph.D. in electrical engineering (2011), all from Stanford University. He also holds an LL.B. from the Faculty of Law at Ankara University. He is a faculty member in the Department of Electrical and Electronics Engineering and at the National Magnetic Resonance Research Center (UMRAM) at Bilkent University. His research group works at the intersection of signal processing and machine learning, extending into natural language processing and graph signal processing (GSP), with a particular focus on fractional Fourier transform based methods.'
  },
  yazar: {
    url: 'https://sites.google.com/view/ahmetyazar/home',
    tr: 'Doktorasını 2020’de İstanbul Medipol Üniversitesi’nde “5G ve ötesi için yeni radyo kaynak yönetimi teknikleri” konusunda tamamladı. 2015–2021 arasında İstanbul Medipol Üniversitesi bünyesindeki CoSiNC (Haberleşme, Sinyal İşleme ve Ağ Merkezi) genel koordinatörlüğünü yürüttü. Başlıca çalışma alanları 5G/6G dalga biçimi tasarımı, çoklu numeroloji, radyo kaynak yönetimi ve kablosuz haberleşmede makine öğrenmesi uygulamalarıdır.',
    en: 'He completed his Ph.D. at Istanbul Medipol University in 2020 on novel radio resource management techniques for 5G and beyond. From 2015 to 2021 he served as general coordinator of CoSiNC (Communications, Signal Processing and Networking Center) at Istanbul Medipol University. His main research areas are 5G/6G waveform design, multi-numerology, radio resource management and machine learning applications in wireless communications.'
  },
  altun: {
    url: 'https://dsai.bogazici.edu.tr/en/personel/huseyin-oktay/5297',
    tr: 'Boğaziçi Üniversitesi Veri Bilimi ve Yapay Zekâ Enstitüsü’nde öğretim üyesidir. Araştırma ilgi alanları arasında dışbükey optimizasyon tabanlı çoklu ortam güvenliği, tıbbi ve askerî sinyal işleme, benzetim ortamlarında pekiştirmeli öğrenme ile akıllı sanal varlık tasarımı ve çevresel/finansal zaman serilerinin öngörüsü yer almaktadır.',
    en: 'He is a faculty member at the Institute for Data Science and Artificial Intelligence at Boğaziçi University. His research interests include multimedia security based on convex optimisation, medical and military signal processing, the design of intelligent virtual entities in simulation environments via reinforcement learning, and time-series prediction of environmental and financial data.'
  },
  hokelek: {
    url: 'https://dblp.uni-trier.de/pid/56/4337.html',
    tr: 'Doktora derecesini City University of New York (CUNY) Elektrik Mühendisliği programından aldı. TÜBİTAK BİLGEM Bilişim ve Bilgi Güvenliği İleri Teknolojiler Araştırma Merkezi’nde görev yapmaktadır. Çalışma alanları 6G teknolojileri, akıllı yansıtıcı yüzeyler (RIS), ağ dilimleme, radyo erişim ağlarında kaynak tahsisi ve determinist haberleşme ağlarıdır. Ortak yazarı olduğu, RIS destekli sistemlerde fiziksel katman güvenliğinin ölçüme dayalı karakterizasyonuna ilişkin çalışma IEEE VTC2023-Spring Konferansı’nda En İyi Bildiri Ödülü’ne değer görülmüştür.',
    en: 'He received his Ph.D. in electrical engineering from the City University of New York (CUNY). He works at the TÜBİTAK BİLGEM Informatics and Information Security Research Center. His research areas are 6G technologies, reconfigurable intelligent surfaces (RIS), network slicing, resource allocation in radio access networks and deterministic communication networks. A paper he co-authored on the measurement-based characterisation of physical layer security in RIS-assisted systems received the Best Paper Award at the IEEE VTC2023-Spring Conference.'
  },
  cirpan: {
    url: 'https://avesis.itu.edu.tr/cirpanh',
    tr: 'İstanbul Teknik Üniversitesi Elektronik ve Haberleşme Mühendisliği Bölümü’nde profesördür ve bölümün Elektronik ve Haberleşme Mühendisliği anabilim dalı başkanlığını yürütmektedir. Başlıca çalışma alanları kablosuz haberleşme, istatistiksel sinyal işleme ve kestirim kuramıdır; özellikle kanal kestirimi, en büyük olabilirlik yöntemleri, dikgen frekans bölmeli çoğullama (OFDM) ve sönümlemeli kanallar üzerine çalışmaktadır.',
    en: 'He is a professor in the Department of Electronics and Communication Engineering at Istanbul Technical University, where he also heads the Electronics and Communication Engineering division. His main research areas are wireless communications, statistical signal processing and estimation theory, with a particular focus on channel estimation, maximum-likelihood methods, orthogonal frequency division multiplexing (OFDM) and fading channels.'
  },
  aydin: {
    url: 'https://avesis.iuc.edu.tr/zeynepg',
    tr: 'İstanbul Üniversitesi-Cerrahpaşa Mühendislik Fakültesi Bilgisayar Mühendisliği Bölümü’nde öğretim üyesidir. Çalışma alanları bilgisayar ağları, siber güvenlik ve görüntü işlemedir; son dönem çalışmaları arasında renk uzayı dönüşümlerinin tek görüntüden süper çözünürlük başarımına etkisi yer almaktadır. Üniversitesindeki siber güvenlik öğrenci topluluğunun akademik danışmanlığını yürütmektedir.',
    en: 'She is a faculty member in the Department of Computer Engineering at the Faculty of Engineering, Istanbul University-Cerrahpaşa. Her research areas are computer networks, cyber security and image processing; her recent work includes the effect of colour space transformations on single-image super-resolution performance. She is the academic advisor of the cyber security student club at her university.'
  },
  gokay: { tr: '', en: '' },
  batgi: { tr: '', en: '' },
  celik: { tr: '', en: '' },
  osunluk: { tr: '', en: '' }
};

function initCommitteeBios() {
  const modal = document.getElementById('bioModal');
  if (!modal) return;

  const elName   = modal.querySelector('#bioName');
  const elRole   = modal.querySelector('#bioRole');
  const elAff    = modal.querySelector('#bioAff');
  const elText   = modal.querySelector('#bioText');
  const elAvatar = modal.querySelector('#bioAvatar');
  const elSource = modal.querySelector('#bioSource');
  const closeBtn = modal.querySelector('.bio-modal-close');
  let lastFocused = null;

  const TXT = {
    tr: {
      pending: 'Biyografi yakında eklenecektir.',
      source: 'Bu özet kurumsal ve açık kaynaklardan derlenmiştir.',
      profile: 'Akademik sayfa ↗',
      close: 'Kapat'
    },
    en: {
      pending: 'A biography will be added soon.',
      source: 'This summary has been compiled from institutional and public sources.',
      profile: 'Academic page ↗',
      close: 'Close'
    }
  };

  function lang() {
    return getStoredLang() === 'en' ? 'en' : 'tr';
  }

  function open(card) {
    const key = card.getAttribute('data-bio');
    const bio = committeeBios[key];
    if (!bio) return;
    const L = TXT[lang()];

    elName.textContent = card.querySelector('.committee-name').textContent.trim();
    const role = card.querySelector('.committee-role-badge');
    elRole.textContent = role ? role.textContent.trim() : '';
    elRole.hidden = !role;
    const aff = card.querySelector('.committee-affiliation');
    const affText = aff ? aff.textContent.trim() : '';
    elAff.textContent = (affText === '—') ? '' : affText;

    const img = card.querySelector('img');
    if (img) {
      elAvatar.src = img.getAttribute('src');
      elAvatar.alt = '';
    }

    const body = bio[lang()] || bio.tr;
    elText.textContent = body || L.pending;

    if (body && bio.url) {
      elSource.innerHTML = L.source +
        ' <a href="' + bio.url + '" target="_blank" rel="noopener" style="color:var(--medipol-cyan);">' +
        L.profile + '</a>';
    } else {
      elSource.textContent = '';
    }

    closeBtn.setAttribute('aria-label', L.close);
    lastFocused = card;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => closeBtn.focus(), 50);
  }

  function close() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (lastFocused) lastFocused.focus();
  }

  document.querySelectorAll('[data-bio]').forEach(card => {
    card.addEventListener('click', () => open(card));
  });

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
}


/* ==========================================================================
   10. Arşiv Tarihçe Haritası (yıllara göre dağılım)
   Tek doğru kaynak arşiv tablosudur: satırlardaki data-lat/data-lon/data-online
   okunur. Tablo değişirse harita da değişir.
   ========================================================================== */
function initArchiveMap() {
  const el = document.getElementById('arsivHarita');
  if (!el || typeof L === 'undefined') return;

  const rows = [...document.querySelectorAll('.archive-table tbody tr')];
  if (!rows.length) return;

  const kayitlar = rows.map(tr => {
    const td = tr.querySelectorAll('td');
    return {
      no: (tr.querySelector('th') || {}).textContent.trim(),
      yil: parseInt(td[0].textContent.trim(), 10),
      kurum: td[1].textContent.trim(),
      sehir: td[2] ? td[2].textContent.trim() : '',
      lat: tr.dataset.lat ? parseFloat(tr.dataset.lat) : null,
      lon: tr.dataset.lon ? parseFloat(tr.dataset.lon) : null,
      online: tr.dataset.online === '1'
    };
  }).filter(k => !isNaN(k.yil)).sort((a, b) => a.yil - b.yil);

  // Aynı noktada kaç kurultay yapılmış?
  const anahtar = k => k.lat.toFixed(3) + ',' + k.lon.toFixed(3);
  const sayim = {};
  kayitlar.filter(k => k.lat !== null).forEach(k => { sayim[anahtar(k)] = (sayim[anahtar(k)] || 0) + 1; });

  // İstatistikler
  const setText = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  setText('statKurultay', String(kayitlar.length));
  setText('statSehir', String(new Set(kayitlar.filter(k => k.lat !== null).map(anahtar)).size));
  setText('statKurum', String(new Set(kayitlar.map(k => k.kurum)).size));

  const harita = L.map(el, { scrollWheelZoom: false, keyboard: true }).setView([39.3, 33.5], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıcıları'
  }).addTo(harita);

  const NAVY = '#002B49', CYAN = '#00A3E0';
  const isaretciler = new Map();
  kayitlar.filter(k => k.lat !== null).forEach(k => {
    const key = anahtar(k);
    if (isaretciler.has(key)) return;
    const n = sayim[key];
    const m = L.circleMarker([k.lat, k.lon], {
      radius: 5 + Math.min(n - 1, 4) * 2.2,
      color: NAVY, weight: 1.5, fillColor: '#FFFFFF', fillOpacity: 0.9
    }).addTo(harita);
    isaretciler.set(key, m);
  });

  const sinir = L.latLngBounds(kayitlar.filter(k => k.lat !== null).map(k => [k.lat, k.lon]));
  harita.fitBounds(sinir.pad(0.12));

  const range = document.getElementById('yearRange');
  const readout = document.getElementById('yearReadout');
  const playBtn = document.getElementById('yearPlay');
  const prevBtn = document.getElementById('yearPrev');
  const nextBtn = document.getElementById('yearNext');
  const yillar = kayitlar.map(k => k.yil);
  const dil = () => (getStoredLang() === 'en' ? 'en' : 'tr');
  const S = (k, y) => (i18nDictionary[dil()] && i18nDictionary[dil()][k]) || y || '';

  let aktif = null;
  function goster(yil) {
    const k = kayitlar.find(x => x.yil === yil);
    if (!k) return;
    // önceki vurguyu sıfırla
    isaretciler.forEach(m => m.setStyle({ color: NAVY, weight: 1.5, fillColor: '#FFFFFF', fillOpacity: 0.9 }));
    if (k.lat !== null) {
      const m = isaretciler.get(anahtar(k));
      if (m) {
        m.setStyle({ color: NAVY, weight: 2, fillColor: CYAN, fillOpacity: 1 });
        m.bringToFront();
        harita.panTo([k.lat, k.lon], { animate: true, duration: 0.6 });
      }
    }
    const parcalar = [k.yil + ' · ' + k.no + '. ' + S('arh009').replace(/s$/, ''), k.kurum];
    if (k.online) parcalar.push(S('arh008'));
    else if (k.sehir) parcalar.push(k.sehir);
    readout.textContent = parcalar.join('  ·  ');
    if (range.value !== String(yil)) range.value = String(yil);
    aktif = yil;
    // tabloda ilgili satırı işaretle
    rows.forEach(tr => tr.classList.toggle('is-active', parseInt(tr.querySelectorAll('td')[0].textContent, 10) === yil));
  }

  function adim(delta) {
    const i = yillar.indexOf(aktif);
    const j = Math.min(yillar.length - 1, Math.max(0, (i === -1 ? yillar.length - 1 : i) + delta));
    goster(yillar[j]);
  }

  range.addEventListener('input', () => {
    // aradaki boş yıllara denk gelirse en yakın kurultay yılına oturt
    const v = parseInt(range.value, 10);
    const en = yillar.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), yillar[0]);
    goster(en);
  });
  prevBtn.addEventListener('click', () => { dur(); adim(-1); });
  nextBtn.addEventListener('click', () => { dur(); adim(1); });

  // Sırayla oynat — otomatik başlamaz; hareket azaltma tercihinde düğme gizlenir
  let timer = null;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) playBtn.hidden = true;
  function dur() {
    if (timer) { clearInterval(timer); timer = null; }
    playBtn.textContent = S('arh006');
    playBtn.setAttribute('aria-pressed', 'false');
  }
  playBtn.addEventListener('click', () => {
    if (timer) { dur(); return; }
    if (aktif === yillar[yillar.length - 1]) goster(yillar[0]);
    playBtn.textContent = S('arh007');
    playBtn.setAttribute('aria-pressed', 'true');
    timer = setInterval(() => {
      const i = yillar.indexOf(aktif);
      if (i >= yillar.length - 1) { dur(); return; }
      goster(yillar[i + 1]);
    }, 1100);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) dur(); });

  // Tablodaki satıra tıklanınca haritada göster
  rows.forEach(tr => tr.addEventListener('click', () => {
    dur();
    goster(parseInt(tr.querySelectorAll('td')[0].textContent, 10));
  }));

  goster(yillar[yillar.length - 1]);
  setTimeout(() => harita.invalidateSize(), 200);
}


/* ==========================================================================
   11. Kayıt Formu (ilerlemeli geliştirme)
   JS kapalıysa form normal POST ile api/kayit.php'ye gider ve sunucu sonucu
   kendi sayfasında gösterir. JS varsa aynı uç nokta fetch ile çağrılır,
   sonuç sayfadan ayrılmadan gösterilir.
   ========================================================================== */
function initRegistrationForm() {
  const form = document.getElementById('kayitForm');
  if (!form) return;

  const dilAlan   = document.getElementById('kayitDil');
  const csrfAlan  = document.getElementById('kayitCsrf');
  const sonuc     = document.getElementById('kayitSonuc');
  const refAlan   = document.getElementById('kayitRef');
  const genelHata = document.getElementById('kayitHata');
  const gonder    = document.getElementById('kayitGonder');
  const faturaKut = document.getElementById('faturaAlanlari');
  const dil = () => (getStoredLang() === 'en' ? 'en' : 'tr');
  const S = (k) => (i18nDictionary[dil()] && i18nDictionary[dil()][k]) || '';

  if (dilAlan) dilAlan.value = dil();

  // Kurumsal fatura alanları yalnızca seçilince görünür
  function faturaGuncelle() {
    const kurumsal = form.querySelector('input[name="fatura_tipi"][value="kurumsal"]');
    if (faturaKut && kurumsal) faturaKut.hidden = !kurumsal.checked;
  }
  form.querySelectorAll('input[name="fatura_tipi"]').forEach(r => r.addEventListener('change', faturaGuncelle));
  faturaGuncelle();

  // CSRF anahtarını al; alınamazsa form yine de normal POST ile çalışır
  fetch('api/token.php', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(d => { if (csrfAlan && d && d.csrf) csrfAlan.value = d.csrf; })
    .catch(() => {});

  function hatalariTemizle() {
    form.querySelectorAll('.form-error').forEach(p => { p.hidden = true; p.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    if (genelHata) { genelHata.hidden = true; genelHata.textContent = ''; }
  }

  function hataGoster(alanlar) {
    let ilk = null;
    Object.keys(alanlar || {}).forEach(ad => {
      const p = form.querySelector('[data-error-for="' + ad + '"]');
      const el = form.querySelector('[name="' + ad + '"]');
      if (p) { p.textContent = alanlar[ad]; p.hidden = false; }
      if (el) { el.setAttribute('aria-invalid', 'true'); if (!ilk) ilk = el; }
    });
    if (ilk) ilk.focus();
  }

  form.addEventListener('submit', async (e) => {
    if (!csrfAlan || !csrfAlan.value) return;      // anahtar yoksa normal gönderime bırak
    e.preventDefault();
    hatalariTemizle();

    const eskiEtiket = gonder.textContent;
    gonder.disabled = true;
    gonder.textContent = S('ky032') || eskiEtiket;

    try {
      const yanit = await fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
        body: new URLSearchParams(new FormData(form))
      });
      const d = await yanit.json();

      if (d.ok) {
        if (refAlan) refAlan.textContent = d.ref || '';
        if (sonuc) { sonuc.hidden = false; sonuc.scrollIntoView({ block: 'center' }); }
        form.hidden = true;
      } else {
        const alanVar = d.alanlar && Object.keys(d.alanlar).length > 0;
        if (alanVar) {
          hataGoster(d.alanlar);                     // alan hataları varsa genel mesaj tekrar etmesin
        } else if (genelHata && d.hata) {
          genelHata.textContent = d.hata;
          genelHata.hidden = false;
          genelHata.scrollIntoView({ block: 'center' });
        }
      }
    } catch (err) {
      if (genelHata) {
        genelHata.textContent = (i18nDictionary[dil()] && i18nDictionary[dil()].ky032) ? '' : '';
        genelHata.textContent = dil() === 'en'
          ? 'The registration could not be sent. Please check your connection or write to siu2027@medipol.edu.tr.'
          : 'Kayıt gönderilemedi. Bağlantınızı kontrol edin ya da siu2027@medipol.edu.tr adresine yazın.';
        genelHata.hidden = false;
      }
    } finally {
      gonder.disabled = false;
      gonder.textContent = eskiEtiket;
    }
  });
}
