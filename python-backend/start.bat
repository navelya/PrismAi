@echo off
echo Starting Background Removal Service...
echo.
echo First time? The ML model (~180MB) will download automatically.
echo This only happens once!
echo.

REM Check if virtual environment exists
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
    echo.
)

REM Activate virtual environment
call venv\Scripts\activate

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt
echo.

REM Start server
echo Starting server on http://localhost:8000
echo Press Ctrl+C to stop
echo.
python -m uvicorn remove_bg:app --host 0.0.0.0 --port 8000 --reload
