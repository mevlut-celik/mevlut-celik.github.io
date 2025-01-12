const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MongoDB bağlantısı
mongoose.connect('mongodb://localhost:27017/mydatabase', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Mongoose şema ve model
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
    selections: Array,
    timestamp: Date
});

const Form = mongoose.model('Form', formSchema);

// Form verilerini kaydetme
app.post('/submit', async (req, res) => {
    try {
        const formData = new Form({
            ...req.body,
            timestamp: new Date()
        });
        await formData.save();
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Tüm verileri alma
app.get('/submissions', async (req, res) => {
    try {
        const submissions = await Form.find();
        res.json(submissions);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Sunucuyu başlat
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 