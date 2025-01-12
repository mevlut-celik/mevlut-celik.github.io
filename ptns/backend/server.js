const express = require('express');
const cors = require('cors');
const app = express();

// CORS ayarlarını güncelle
app.use(cors({
    origin: ['https://mevlut-celik.github.io', 'http://localhost:3001'],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Accept']
}));

// Vercel için export ekle
module.exports = app;