from pymongo import MongoClient
import logging

# Logging ayarları
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# MongoDB bağlantısı
MONGODB_URI = "mongodb+srv://mevlutttttt54:Qw2183481@cluster0.reovq.mongodb.net/ptns?retryWrites=true&w=majority&appName=Cluster0"

try:
    logger.info("MongoDB bağlantısı başlatılıyor...")
    client = MongoClient(MONGODB_URI)
    
    # Bağlantıyı test et
    client.admin.command('ping')
    logger.info("MongoDB bağlantısı başarılı!")
    
    # Veritabanı ve koleksiyonları listele
    db = client.ptns
    logger.info(f"Veritabanları: {client.list_database_names()}")
    logger.info(f"Koleksiyonlar: {db.list_collection_names()}")
    
except Exception as e:
    logger.error(f"MongoDB bağlantı hatası: {str(e)}")
    logger.error(f"MONGODB_URI: {MONGODB_URI}")
finally:
    if 'client' in locals():
        client.close()
        logger.info("MongoDB bağlantısı kapatıldı") 