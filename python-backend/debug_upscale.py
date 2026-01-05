import cv2
import os
import requests
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MODEL_DIR = Path("models")
MODEL_DIR.mkdir(exist_ok=True)

def download_fsrcnn_model(scale=4):
    model_name = f"FSRCNN_x{scale}.pb"
    model_path = MODEL_DIR / model_name
    
    if model_path.exists():
        logger.info(f"✅ Model {model_name} exists at {model_path}")
        return str(model_path)
    
    logger.info(f"📥 Downloading {model_name}...")
    url = f"https://github.com/Saafke/FSRCNN_Tensorflow/raw/master/models/FSRCNN_x{scale}.pb"
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        with open(model_path, 'wb') as f:
            f.write(response.content)
        logger.info(f"✅ Downloaded {model_name}")
        return str(model_path)
    except Exception as e:
        logger.error(f"❌ Download failed: {e}")
        raise

print(f"OpenCV Version: {cv2.__version__}")
try:
    path = download_fsrcnn_model(4)
    print(f"Model path: {path}")
    
    sr = cv2.dnn_superres.DnnSuperResImpl_create()
    print("Created DnnSuperResImpl")
    
    sr.readModel(path)
    print("Read model")
    
    sr.setModel("fsrcnn", 4)
    print("Set model")
    
    print("SUCCESS!")
except Exception as e:
    print(f"FAILURE: {e}")
