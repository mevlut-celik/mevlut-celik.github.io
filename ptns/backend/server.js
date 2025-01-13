require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept']
}));
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

// MongoDB bağlantısı
let cachedDb = null;

const connectDB = async () => {
    if (cachedDb) {
        console.log('Önbellekten MongoDB bağlantısı kullanılıyor');
        return cachedDb;
    }

    try {
        const client = await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        cachedDb = client;
        console.log('MongoDB bağlantısı başarılı');
        return client;
    } catch (err) {
        console.error('MongoDB bağlantı hatası:', err);
        console.error('MONGODB_URI:', process.env.MONGODB_URI ? 'Tanımlı' : 'Tanımlı değil');
        throw err;
    }
};

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
    timestamp: { type: Date, default: Date.now }
});

const Form = mongoose.models.Form || mongoose.model('Form', formSchema);

// Test endpoint
app.get('/api/test', async (req, res) => {
    try {
        await connectDB();
        res.json({ message: 'API çalışıyor!' });
    } catch (error) {
        console.error('Test endpoint hatası:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Form gönderme endpoint'i
app.post('/api/submit', async (req, res) => {
    try {
        await connectDB();
        console.log('Gelen veri:', req.body);
        const form = new Form(req.body);
        await form.save();
        res.status(201).json({ success: true });
    } catch (error) {
        console.error('Form kaydetme hatası:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message,
            details: error.stack 
        });
    }
});

// Tüm formları getirme endpoint'i
app.get('/api/submissions', async (req, res) => {
    try {
        await connectDB();
        const forms = await Form.find().sort({ timestamp: -1 });
        res.json(forms);
    } catch (error) {
        console.error('Form getirme hatası:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.stack 
        });
    }
});

// Serverless ortamda dinleme işlemi yapmıyoruz
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => console.log(`Server ${PORT} portunda çalışıyor`));
}

module.exports = app;
