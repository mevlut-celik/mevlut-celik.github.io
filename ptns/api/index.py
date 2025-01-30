from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from datetime import datetime
import os
from pymongo import MongoClient

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
client = MongoClient(MONGODB_URI)
db = client.ptns

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

# Test endpoint'i
@app.get("/test")
async def test():
    return {"message": "API çalışıyor!"}

# Form gönderme endpoint'i
@app.post("/submit")
async def submit_form(form_data: FormData):
    try:
        form_dict = form_data.dict()
        form_dict["timestamp"] = datetime.now()
        result = db.forms.insert_one(form_dict)
        return {"success": True, "id": str(result.inserted_id)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# Tüm formları getirme endpoint'i
@app.get("/submissions")
async def get_submissions():
    try:
        forms = list(db.forms.find().sort("timestamp", -1))
        for form in forms:
            form["_id"] = str(form["_id"])
        return forms
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Vercel handler
handler = app 