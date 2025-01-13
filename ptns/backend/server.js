const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB bağlantısı
mongoose.connect(process.env.MONGODB_URI)
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
        const form = new Form(req.body);
        await form.save();
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Tüm formları getirme endpoint'i
app.get('/submissions', async (req, res) => {
    try {
        const forms = await Form.find().sort({ timestamp: -1 });
        res.json(forms);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server ${PORT} portunda çalışıyor`));

module.exports = app;