const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, "uploads");
const fallbackStorePath = path.join(__dirname, "applications.ndjson");
const DEFAULT_MAIL_TO = "parlar-w@parlar.org.tr, mevlutc@freshdatatechnology.com";

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const resolveMailTo = () => {
  const raw = String(process.env.MAIL_TO || "").trim();
  const candidates = raw
    .split(",")
    .map((mail) => mail.trim())
    .filter(Boolean);
  const validRecipients = candidates.filter(isValidEmail);
  return validRecipients.length > 0 ? validRecipients.join(", ") : DEFAULT_MAIL_TO;
};

const resolveMailFrom = (req) => {
  if (isValidEmail(process.env.MAIL_FROM)) {
    return process.env.MAIL_FROM.trim();
  }

  const host = String(req.get("host") || req.hostname || "localhost")
    .replace(/^https?:\/\//, "")
    .split(":")[0];
  return `no-reply@${host}`;
};

const hasSmtpConfig = () =>
  Boolean(
    String(process.env.SMTP_HOST || "").trim() &&
      String(process.env.SMTP_USER || "").trim() &&
      String(process.env.SMTP_PASS || "").trim()
  );

const createSmtpTransport = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

const createSendmailTransport = () =>
  nodemailer.createTransport({
    sendmail: true,
    newline: "unix",
    path: process.env.SENDMAIL_PATH || "sendmail",
  });

const storeApplicationFallback = async (payload) => {
  const row = `${JSON.stringify(payload)}\n`;
  await fs.promises.appendFile(fallbackStorePath, row, "utf8");
};

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedExtensions = [".pdf", ".doc", ".docx"];
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      return cb(new Error("Sadece PDF, DOC veya DOCX dosyalari kabul edilir."));
    }
    cb(null, true);
  },
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/apply", upload.single("cv"), async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      linkedin,
      experienceYears,
      coverLetter,
      kvkkConsent,
    } = req.body;

    if (!fullName || !email || !phone || !experienceYears || !coverLetter) {
      return res.status(400).json({ message: "Lutfen zorunlu alanlari doldurunuz." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Lutfen CV dosyanizi yukleyiniz." });
    }

    if (kvkkConsent !== "true") {
      return res.status(400).json({ message: "KVKK onayi zorunludur." });
    }

    const mailPayload = {
      from: resolveMailFrom(req),
      to: resolveMailTo(),
      subject: `Yeni Basvuru - ${fullName}`,
      text: [
        "Kaynak Gelistirme ve Is Birlikleri Direktoru pozisyonu icin yeni bir basvuru alindi.",
        `Ad Soyad: ${fullName}`,
        `E-posta: ${email}`,
        `Telefon: ${phone}`,
        `LinkedIn: ${linkedin || "-"}`,
        `Deneyim (yil): ${experienceYears}`,
        "",
        "Niyet Mektubu:",
        coverLetter,
        "",
        `KVKK Onayi: ${kvkkConsent === "true" ? "Verildi" : "Verilmedi"}`,
      ].join("\n"),
      html: `
        <h2>Yeni Basvuru Alindi</h2>
        <p><strong>Pozisyon:</strong> Kaynak Gelistirme ve Is Birlikleri Direktoru</p>
        <p><strong>Ad Soyad:</strong> ${fullName}</p>
        <p><strong>E-posta:</strong> ${email}</p>
        <p><strong>Telefon:</strong> ${phone}</p>
        <p><strong>LinkedIn:</strong> ${linkedin || "-"}</p>
        <p><strong>Deneyim (yil):</strong> ${experienceYears}</p>
        <p><strong>KVKK Onayi:</strong> Verildi</p>
        <h3>Niyet Mektubu</h3>
        <p>${String(coverLetter).replace(/\n/g, "<br/>")}</p>
      `,
      attachments: [
        {
          filename: req.file.originalname,
          path: req.file.path,
        },
      ],
    };

    let sent = false;
    let deliveryMethod = "";

    if (hasSmtpConfig()) {
      try {
        const smtpTransport = createSmtpTransport();
        await smtpTransport.sendMail(mailPayload);
        sent = true;
        deliveryMethod = "smtp";
      } catch (smtpError) {
        console.error("SMTP gonderim hatasi:", smtpError.message);
      }
    }

    if (!sent) {
      try {
        const sendmailTransport = createSendmailTransport();
        await sendmailTransport.sendMail(mailPayload);
        sent = true;
        deliveryMethod = "sendmail";
      } catch (sendmailError) {
        console.error("Sendmail gonderim hatasi:", sendmailError.message);
      }
    }

    if (!sent) {
      await storeApplicationFallback({
        createdAt: new Date().toISOString(),
        fullName,
        email,
        phone,
        linkedin: linkedin || "",
        experienceYears,
        coverLetter,
        kvkkConsent,
        cvOriginalName: req.file.originalname,
        cvStoredPath: req.file.path,
      });
      deliveryMethod = "file-fallback";
    }

    const responseMessage =
      deliveryMethod === "file-fallback"
        ? "Basvurunuz alindi. Mail servisi su an kullanilamiyor; basvurunuz guvenli sekilde kaydedildi."
        : "Basvurunuz basariyla gonderildi.";

    res.json({ message: responseMessage, deliveryMethod });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Basvuru gonderilirken bir hata olustu. Lutfen daha sonra tekrar deneyiniz.",
    });
  }
});

app.use((error, _req, res, _next) => {
  res.status(400).json({ message: error.message || "Gecersiz dosya yukleme." });
});

app.listen(port, () => {
  console.log(`Server calisiyor: http://localhost:${port}`);
});
