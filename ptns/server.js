const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();

// CORS ve body-parser ayarları
app.use(cors({
    origin: [
        'https://mevlut-celik.github.io',
        'http://localhost:3001',
        'https://mevlut-celik-github-io.vercel.app'
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept']
}));
app.use(bodyParser.json());

// Statik dosyaları sunmak için root dizini belirt
app.use('/', express.static(__dirname));

// Ana sayfa route'u
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Admin sayfası route'u
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Survey sayfası route'u
app.get('/survey', (req, res) => {
    res.sendFile(path.join(__dirname, 'survey.html'));
});

// Teşekkür sayfası route'u
app.get('/tesekkur', (req, res) => {
    res.sendFile(path.join(__dirname, 'tesekkur.html'));
});

// MongoDB Atlas bağlantı URL'si için environment variable kullanın
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://...";

// Port numarasını değiştir
const PORT = process.env.PORT || 3001;

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('MongoDB Atlas\'a başarıyla bağlandı');
        app.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });
    })
    .catch(err => {
        console.error('MongoDB bağlantı hatası:', err);
        process.exit(1);
    });

// Mongoose şema ve model
const formSchema = new mongoose.Schema({
    // İndex.html'den gelen veriler
    age: String,
    city: String,
    district: String,
    gender: String,
    educationLevel: String,
    graduateEducation: String,
    department: String,
    experience: String,
    schoolType: String,
    classLevels: String,
    trainingExperience: String,
    
    // Survey.html'den gelen veriler
    selections: [{
        sentence: String,
        explanation: String,
        actions: String
    }],
    
    // Zaman damgası
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const Form = mongoose.model('Form', formSchema);

// Form verilerini kaydetme
app.post('/submit', async (req, res) => {
    try {
        console.log('Gelen veri:', req.body);

        // Veri kontrolü
        if (!req.body.age || !req.body.city || !req.body.gender) {
            throw new Error('Eksik form verisi');
        }

        const formData = new Form(req.body);
        await formData.save();

        console.log('Kaydedilen veri:', formData);
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Sunucu hatası:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Tüm verileri alma
app.get('/submissions', async (req, res) => {
    try {
        const submissions = await Form.find().sort({ timestamp: -1 });
        res.json(submissions);
    } catch (error) {
        console.error('Veri çekme hatası:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}); 