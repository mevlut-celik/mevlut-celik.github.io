const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(cors({
    origin: ['https://mevlut-celik.github.io', 'http://localhost:3000', 'https://ptns-oy8ufal3b-mevlut-celiks-projects.vercel.app'],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: true
}));
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

// MongoDB bağlantısı
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('MongoDB bağlantısı başarılı');
    } catch (err) {
        console.error('MongoDB bağlantı hatası:', err);
        console.error('MONGODB_URI:', process.env.MONGODB_URI ? 'Tanımlı' : 'Tanımlı değil');
        process.exit(1);
    }
};

connectDB();

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

const Form = mongoose.model('Form', formSchema);

// Test endpoint
app.get('/test', (req, res) => {
    res.json({ message: 'API çalışıyor!' });
});

// Form gönderme endpoint'i
app.post('/submit', async (req, res) => {
    try {
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
app.get('/submissions', async (req, res) => {
    try {
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server ${PORT} portunda çalışıyor`));

module.exports = app;
