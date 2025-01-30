from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import os
import logging
from mangum import Mangum

# Logging ayarları
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS ayarları
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB bağlantısı
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb+srv://mevlutttttt54:Qw2183481@cluster0.reovq.mongodb.net/ptns?retryWrites=true&w=majority&appName=Cluster0")
logger.info(f"MongoDB URI: {MONGODB_URI}")
client = None

def get_database():
    global client
    try:
        if client is None:
            logger.info("MongoDB bağlantısı başlatılıyor...")
            client = MongoClient(MONGODB_URI)
            # Bağlantıyı test et
            client.admin.command('ping')
            logger.info("MongoDB bağlantısı başarılı!")
        return client.ptns
    except Exception as e:
        logger.error(f"MongoDB bağlantı hatası: {str(e)}")
        logger.error(f"MONGODB_URI: {MONGODB_URI}")
        raise HTTPException(status_code=500, detail=f"Veritabanı bağlantı hatası: {str(e)}")

# Form verisi için Pydantic modeli
class Selection(BaseModel):
    sentence: str
    explanation: str
    actions: str

class FormData(BaseModel):
    age: str
    city: str
    district: str
    gender: str
    educationLevel: str
    graduateEducation: str
    department: str
    experience: str
    schoolType: str
    classLevels: str
    trainingExperience: str
    selections: List[Selection]
    timestamp: Optional[datetime] = None

# Test endpoint'i
@app.get("/api/test")
async def test():
    try:
        logger.info("Test endpoint'i çağrıldı")
        db = get_database()
        return {"message": "API çalışıyor!", "database": "Bağlantı başarılı"}
    except Exception as e:
        logger.error(f"Test endpoint hatası: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Form gönderme endpoint'i
@app.post("/api/submit")
async def submit_form(form_data: FormData):
    try:
        logger.info("Form gönderme endpoint'i çağrıldı")
        db = get_database()
        form_dict = form_data.dict()
        form_dict["timestamp"] = datetime.now()
        result = db.forms.insert_one(form_dict)
        logger.info(f"Form başarıyla kaydedildi. ID: {result.inserted_id}")
        return {"success": True, "id": str(result.inserted_id)}
    except Exception as e:
        logger.error(f"Form kaydetme hatası: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

# Tüm formları getirme endpoint'i
@app.get("/api/submissions")
async def get_submissions():
    try:
        logger.info("Tüm formları getirme endpoint'i çağrıldı")
        db = get_database()
        forms = list(db.forms.find().sort("timestamp", -1))
        for form in forms:
            form["_id"] = str(form["_id"])
        logger.info(f"Toplam {len(forms)} form getirildi")
        return forms
    except Exception as e:
        logger.error(f"Form getirme hatası: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Vercel handler
handler = app 