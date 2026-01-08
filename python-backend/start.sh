#!/bin/bash
echo "Starting Background Removal Service..."
echo ""
echo "First time? The ML model (~180MB) will download automatically."
echo "This only happens once!"
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo ""
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt
echo ""

# Start server
echo "Starting server on http://localhost:8000"
echo "Press Ctrl+C to stop"
echo ""
python3 -m uvicorn image_service:app --host 0.0.0.0 --port 8000 --reload
