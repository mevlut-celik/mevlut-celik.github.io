from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
from typing import List, Optional
import os

app = FastAPI()

# CORS ayarları
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tüm originlere izin ver (production'da değiştirilmeli)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Veri modeli
class FormData(BaseModel):
    age: int
    gender: str
    city: str
    district: str
    educationLevel: str
    graduateEducation: str
    department: str
    experience: int
    schoolType: str
    classLevels: str
    trainingExperience: str

# Verileri JSON dosyasında sakla
DATA_FILE = "responses.json"

def load_responses():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def save_responses(responses):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(responses, f, ensure_ascii=False, indent=2)

@app.post("/submit")
async def submit_form(form_data: FormData):
    try:
        responses = load_responses()
        responses.append(form_data.dict())
        save_responses(responses)
        return {"success": True, "message": "Form başarıyla kaydedildi"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-responses")
async def get_responses():
    try:
        return load_responses()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 