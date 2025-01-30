from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import json
from typing import List, Optional
import os
from datetime import datetime

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

@app.post("/api/submit")
async def submit_form(form_data: FormData):
    try:
        responses = load_responses()
        form_dict = form_data.dict()
        form_dict["timestamp"] = datetime.now().isoformat()
        responses.append(form_dict)
        save_responses(responses)
        return JSONResponse(
            content={"success": True, "message": "Form başarıyla kaydedildi"},
            status_code=200
        )
    except Exception as e:
        return JSONResponse(
            content={"success": False, "message": str(e)},
            status_code=500
        )

@app.get("/api/responses")
async def get_responses():
    try:
        responses = load_responses()
        return JSONResponse(
            content=responses,
            status_code=200
        )
    except Exception as e:
        return JSONResponse(
            content={"success": False, "message": str(e)},
            status_code=500
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="localhost", port=3000) 