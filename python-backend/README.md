# Background Removal Service

Python-based background removal service using `rembg` and FastAPI.

## Features
- ✅ Free and unlimited background removal
- ✅ Fast processing (~2-5 seconds per image)
- ✅ High quality using U2-Net ML model
- ✅ REST API with CORS support

## Quick Start

### Windows
```bash
cd python-backend
start.bat
```

### Mac/Linux
```bash
cd python-backend
chmod +x start.sh
./start.sh
```

## First Run
The ML model (~180MB) will download automatically on first use. This only happens once!

## API Endpoints

### POST /remove-background
Remove background from an image.

**Request:**
- Content-Type: multipart/form-data
- Body: file (image file)

**Response:**
- Content-Type: image/png
- Body: PNG image with transparent background

### GET /
Health check and service info

### GET /health
Simple health check

## Manual Setup

1. Create virtual environment:
```bash
python -m venv venv
```

2. Activate it:
```bash
# Windows
venv\Scripts\activate

# Mac/Linux
source venv/bin/activate
```

3. Install dependencies:
```bash
pip install -r requirements.txt
```

4. Run server:
```bash
python -m uvicorn remove_bg:app --reload --port 8000
```

## Testing

```bash
curl -X POST http://localhost:8000/remove-background \
  -F "file=@test_image.jpg" \
  --output result.png
```

## Requirements
- Python 3.8 or higher
- ~200MB disk space for ML model
- Internet connection (first run only)
