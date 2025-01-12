const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// Environment variables
const MONGODB_URI = process.env.MONGODB_URI;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://mevlut-celik.github.io/ptns';
const PORT = process.env.PORT || 3001;

// CORS ayarları
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Origin'],
    credentials: true
}));

// Pre-flight istekleri için
app.options('*', cors());

// Body parser limiti artır
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

// MongoDB bağlantısı
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB Atlas\'a başarıyla bağlandı'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// Form şeması
const formSchema = new mongoose.Schema({
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
    selections: [{
        sentence: String,
        explanation: String,
        actions: String
    }],
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const Form = mongoose.model('Form', formSchema);

// Test endpoint'i
app.get('/test', (req, res) => {
    res.json({ message: 'API çalışıyor!' });
});

// Form verilerini kaydetme
app.post('/submit', async (req, res) => {
    try {
        console.log('Gelen veri:', req.body);
        const formData = new Form(req.body);
        await formData.save();
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Sunucu hatası:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Tüm verileri getirme
app.get('/submissions', async (req, res) => {
    try {
        const submissions = await Form.find().sort({ timestamp: -1 });
        res.json(submissions);
    } catch (error) {
        console.error('Veri çekme hatası:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;