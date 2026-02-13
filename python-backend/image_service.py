from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Depends, Header
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from rembg import remove
from PIL import Image
import io
import logging
import cv2
import numpy as np
import os
import requests
from pathlib import Path
from typing import Optional

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Image Processing Service")

# API Key for internal authentication (set via environment variable)
INTERNAL_API_KEY = os.environ.get("INTERNAL_API_KEY", "")

async def verify_api_key(authorization: Optional[str] = Header(None)):
    """Dependency that verifies the Authorization header contains a valid API key."""
    if not INTERNAL_API_KEY:
        # If no key is configured, skip auth (dev mode)
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization[7:]  # Strip "Bearer "
    if token != INTERNAL_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")

# Add CORS middleware - Allow Vercel deployments and localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://*.vercel.app",  # All Vercel preview deployments
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",  # Regex for Vercel subdomains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global constants
MODEL_DIR = Path("models")
MODEL_DIR.mkdir(exist_ok=True)

def download_fsrcnn_model(scale: int) -> str:
    """Download FSRCNN model if not present"""
    if scale not in [2, 3, 4]:
        raise ValueError(f"Invalid FSRCNN scale: {scale}")
        
    model_name = f"FSRCNN_x{scale}.pb"
    model_path = MODEL_DIR / model_name
    
    if model_path.exists():
        return str(model_path)
    
    logger.info(f"📥 Downloading {model_name}...")
    url = f"https://github.com/Saafke/FSRCNN_Tensorflow/raw/master/models/FSRCNN_x{scale}.pb"
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        with open(model_path, 'wb') as f:
            f.write(response.content)
        
        logger.info(f"✅ Downloaded {model_name} ({len(response.content) / 1024:.1f} KB)")
        return str(model_path)
        
    except Exception as e:
        logger.error(f"❌ Failed to download model: {e}")
        raise

def get_upscaler(scale: int):
    """Get a configured upscaler instance for the specified scale"""
    try:
        model_path = download_fsrcnn_model(scale)
        sr = cv2.dnn_superres.DnnSuperResImpl_create()
        sr.readModel(model_path)
        sr.setModel("fsrcnn", scale)
        return sr
    except Exception as e:
        logger.error(f"Failed to create upscaler for x{scale}: {e}")
        return None

def process_upscale(img_array: np.ndarray, scale: int) -> np.ndarray:
    """Run upscaling on an image array"""
    # Convert RGBA to RGB if needed
    if img_array.shape[2] == 4:
        img_array = cv2.cvtColor(img_array, cv2.COLOR_RGBA2RGB)
    elif len(img_array.shape) == 2:
        img_array = cv2.cvtColor(img_array, cv2.COLOR_GRAY2RGB)
        
    # FSRCNN expects BGR
    img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
    
    upscaler = get_upscaler(scale)
    if upscaler:
        logger.info(f"🤖 Upscaling x{scale} with FSRCNN...")
        result_bgr = upscaler.upsample(img_bgr)
        return cv2.cvtColor(result_bgr, cv2.COLOR_BGR2RGB)
    else:
        logger.warning(f"⚠️ Fallback to LANCZOS for x{scale}")
        # Manual resize fallback
        h, w = img_array.shape[:2]
        return cv2.resize(img_array, (w * scale, h * scale), interpolation=cv2.INTER_LANCZOS4)

@app.on_event("startup")
async def startup_event():
    logger.info("🚀 Server starting...")
    # Pre-download mostly used models
    try:
        download_fsrcnn_model(4)
        logger.info("✅ Pre-checked FSRCNN x4 model")
    except:
        pass

@app.get("/")
async def root():
    return {
        "status": "running",
        "service": "Image Processing API",
        "version": "3.1.0",
        "services": ["background-removal", "upscaling"]
    }

@app.post("/remove-background", dependencies=[Depends(verify_api_key)])
async def remove_background(file: UploadFile = File(...)):
    try:
        logger.info(f"Processing image: {file.filename}")
        contents = await file.read()
        input_image = Image.open(io.BytesIO(contents))
        output_image = remove(input_image)
        
        img_byte_arr = io.BytesIO()
        output_image.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        return StreamingResponse(
            img_byte_arr, 
            media_type="image/png",
            headers={"Content-Disposition": f"inline; filename=no-bg-{file.filename}"}
        )
    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/upscale", dependencies=[Depends(verify_api_key)])
async def upscale_image(file: UploadFile = File(...), scale: int = Form(default=4)):
    try:
        logger.info(f"📤 Upscaling {file.filename} at {scale}x")
        
        if scale not in [2, 3, 4, 8]:
            raise HTTPException(status_code=400, detail="Scale must be 2, 3, 4, or 8")
        
        contents = await file.read()
        input_image = Image.open(io.BytesIO(contents))
        img_array = np.array(input_image)
        
        # Logic for scales
        if scale == 8:
            # Chain 4x -> 2x
            logger.info("🔗 Chaining upscale: 4x -> 2x = 8x")
            
            # Step 1: 4x
            temp_result = process_upscale(img_array, 4)
            
            # Step 2: 2x
            final_result = process_upscale(temp_result, 2)
            
        else:
            # Single step (2x, 3x, 4x)
            final_result = process_upscale(img_array, scale)
            
        # Convert back to PIL
        output_image = Image.fromarray(final_result)
        logger.info(f"✨ Final size: {output_image.size}")
        
        img_byte_arr = io.BytesIO()
        output_format = input_image.format if input_image.format else 'PNG'
        output_image.save(img_byte_arr, format=output_format, quality=95)
        img_byte_arr.seek(0)
        
        return StreamingResponse(
            img_byte_arr,
            media_type=f"image/{output_format.lower()}",
            headers={"Content-Disposition": f"inline; filename=upscaled-{scale}x-{file.filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/merge-images", dependencies=[Depends(verify_api_key)])
async def merge_images(
    base_file: UploadFile = File(...),
    overlay_file: UploadFile = File(...),
    position: str = Form(default="bottom-right"),
    overlay_scale: float = Form(default=0.2),
    opacity: float = Form(default=1.0),
    padding: int = Form(default=10)
):
    """
    Merge Image Endpoint
    Composites an overlay image onto a base image with positioning and scaling.
    
    Args:
        base_file: The base/background image
        overlay_file: The overlay/foreground image to place on base
        position: Position of overlay (center, top-left, top-right, bottom-left, bottom-right, top-center, bottom-center)
        overlay_scale: Scale of overlay relative to base width (0.1 = 10%, 1.0 = 100%)
        opacity: Opacity of overlay (0.0 = transparent, 1.0 = opaque)
        padding: Padding from edge in pixels
    """
    try:
        logger.info(f"🖼️ Merging images: position={position}, scale={overlay_scale}, opacity={opacity}")
        
        # Load base image
        base_contents = await base_file.read()
        base_image = Image.open(io.BytesIO(base_contents)).convert("RGBA")
        
        # Load overlay image
        overlay_contents = await overlay_file.read()
        overlay_image = Image.open(io.BytesIO(overlay_contents)).convert("RGBA")
        
        # Calculate scaled overlay dimensions
        base_width, base_height = base_image.size
        overlay_width = int(base_width * overlay_scale)
        overlay_height = int(overlay_image.height * (overlay_width / overlay_image.width))
        
        # Resize overlay
        overlay_resized = overlay_image.resize((overlay_width, overlay_height), Image.Resampling.LANCZOS)
        
        # Apply opacity if needed
        if opacity < 1.0:
            # Create alpha mask
            alpha = overlay_resized.split()[3]
            alpha = alpha.point(lambda p: int(p * opacity))
            overlay_resized.putalpha(alpha)
        
        # Calculate position
        x, y = 0, 0
        if position == "center":
            x = (base_width - overlay_width) // 2
            y = (base_height - overlay_height) // 2
        elif position == "top-left":
            x, y = padding, padding
        elif position == "top-right":
            x = base_width - overlay_width - padding
            y = padding
        elif position == "top-center":
            x = (base_width - overlay_width) // 2
            y = padding
        elif position == "bottom-left":
            x = padding
            y = base_height - overlay_height - padding
        elif position == "bottom-right":
            x = base_width - overlay_width - padding
            y = base_height - overlay_height - padding
        elif position == "bottom-center":
            x = (base_width - overlay_width) // 2
            y = base_height - overlay_height - padding
        
        # Composite the images
        result = base_image.copy()
        result.paste(overlay_resized, (x, y), overlay_resized)
        
        # Convert to RGB for PNG output (remove alpha if solid background)
        # Keep RGBA to preserve any transparency
        img_byte_arr = io.BytesIO()
        result.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        logger.info(f"✅ Images merged successfully: {base_width}x{base_height}")
        
        return StreamingResponse(
            img_byte_arr,
            media_type="image/png",
            headers={"Content-Disposition": f"inline; filename=merged-{base_file.filename}"}
        )
        
    except Exception as e:
        logger.error(f"❌ Merge error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
