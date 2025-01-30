from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from dotenv import load_dotenv
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
import os
from mangum import Mangum

# .env dosyasını yükle
load_dotenv()

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
MONGODB_URI = os.getenv("MONGODB_URI")
client = None

def get_database():
    global client
    if client is None:
        client = MongoClient(MONGODB_URI)
    return client.ptns

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
        db = get_database()
        return {"message": "API çalışıyor!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Form gönderme endpoint'i
@app.post("/api/submit")
async def submit_form(form_data: FormData):
    try:
        db = get_database()
        form_dict = form_data.dict()
        form_dict["timestamp"] = datetime.now()
        result = db.forms.insert_one(form_dict)
        return {"success": True, "id": str(result.inserted_id)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Tüm formları getirme endpoint'i
@app.get("/api/submissions")
async def get_submissions():
    try:
        db = get_database()
        forms = list(db.forms.find().sort("timestamp", -1))
        for form in forms:
            form["_id"] = str(form["_id"])
        return forms
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# AWS Lambda handler
handler = Mangum(app) 