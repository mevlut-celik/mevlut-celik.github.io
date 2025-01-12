const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();

// CORS ayarları
app.use(cors({
    origin: '*',  // Tüm originlere izin ver
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept']
}));

// Body parser ayarları
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MongoDB bağlantısı
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB bağlantısı başarılı'))
    .catch(err => console.error('MongoDB hatası:', err));

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;