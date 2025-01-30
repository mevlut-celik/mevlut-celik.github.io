from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
from datetime import datetime
import json
import os

app = FastAPI()

# CORS ayarları
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

# Form verilerini kaydetmek için fonksiyon
def save_form_data(data: dict):
    # Dosya adını oluştur
    filename = "form_data.txt"
    
    # Veriyi JSON formatına çevir
    json_data = json.dumps(data, ensure_ascii=False, indent=2)
    
    # Veriyi dosyaya ekle
    with open(filename, "a", encoding="utf-8") as f:
        f.write(json_data + "\n---\n")

@app.post("/submit")
async def submit_form(form_data: FormData):
    try:
        # Form verisini dict'e çevir
        form_dict = form_data.dict()
        # Timestamp ekle
        form_dict["timestamp"] = str(datetime.now())
        # Veriyi kaydet
        save_form_data(form_dict)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/submissions")
async def get_submissions():
    try:
        # Dosyayı oku
        if not os.path.exists("form_data.txt"):
            return []
        
        with open("form_data.txt", "r", encoding="utf-8") as f:
            content = f.read()
        
        # Verileri parse et
        submissions = []
        for entry in content.split("---\n"):
            if entry.strip():
                try:
                    submissions.append(json.loads(entry))
                except:
                    continue
        
        return submissions
    except Exception as e:
        return {"error": str(e)}

@app.get("/test")
async def test():
    return {"message": "API çalışıyor!"} 