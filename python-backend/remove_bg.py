from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from rembg import remove
from PIL import Image
import io
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Background Removal Service")

# Add CORS middleware to allow requests from Next.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "service": "Background Removal API",
        "version": "1.0.0"
    }

@app.post("/remove-background")
async def remove_background(file: UploadFile = File(...)):
    """
    Remove background from uploaded image
    
    Args:
        file: Image file (JPG, PNG, etc.)
    
    Returns:
        PNG image with transparent background
    """
    try:
        logger.info(f"Processing image: {file.filename}")
        
        # Read uploaded file
        contents = await file.read()
        input_image = Image.open(io.BytesIO(contents))
        
        logger.info(f"Image size: {input_image.size}, mode: {input_image.mode}")
        
        # Remove background using rembg
        logger.info("Removing background...")
        output_image = remove(input_image)
        
        # Convert to PNG bytes
        img_byte_arr = io.BytesIO()
        output_image.save(img_byte_arr, format='PNG')
        img_byte_arr.seek(0)
        
        logger.info("Background removal successful")
        
        return StreamingResponse(
            img_byte_arr,
            media_type="image/png",
            headers={
                "Content-Disposition": f"inline; filename=no-bg-{file.filename}"
            }
        )
        
    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check for monitoring"""
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
