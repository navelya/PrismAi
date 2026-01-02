# 🚀 Starting PrismAI with Background Removal & AI Generation

## Two-Server Setup Required

PrismAI now runs **TWO servers** for full functionality:
1. **Next.js** (port 3000) - Main application
2. **Python** (port 8000) - Background removal service

---

## Quick Start (Windows)

### Terminal 1: Start Python Backend
```bash
cd python-backend
start.bat
```

**First time:** Will create virtual environment and download ML model (~180MB). This takes 2-3 minutes and only happens once!

### Terminal 2: Start Next.js
```bash
npm run dev
```

**Done!** Open http://localhost:3000

---

## Quick Start (Mac/Linux)

### Terminal 1: Start Python Backend
```bash
cd python-backend
chmod +x start.sh
./start.sh
```

### Terminal 2: Start Next.js
```bash
npm run dev
```

---

## What Each Server Does

### Python Backend (localhost:8000)
- ✅ Removes backgrounds from images using AI
- ✅ Free & unlimited (runs locally)
- ✅ Uses `rembg` library with U2-Net model
- ✅ Processing: ~2-5 seconds per image

### Next.js (localhost:3000)
- ✅ Main workflow interface
- ✅ Chat with AI
- ✅ Workflow editor
- ✅ AI image generation (Pollinations.ai)

---

## Testing the New Features

### Test Background Removal
1. Chat: `"Get me 5 cat images, remove the background"`
2. Click "Editor" to see workflow
3. Run workflow
4. Result: Images with transparent backgrounds! ✨

### Test AI Image Generation
1. Chat: `"Generate an image of a sunset over ocean"`
2. Run workflow
3. Result: AI-generated image from Pollinations.ai! 🎨

### Test Combined
1. Chat: `"Generate 3 flower images with AI, then remove backgrounds"`
2. Uses both features together!

---

## Troubleshooting

### "Connection refused on port 8000"
- Python server isn't running
- Solution: Start `python-backend/start.bat` first

### "ModuleNotFoundError: No module named 'rembg'"
- Dependencies not installed
- Solution: Run `pip install -r requirements.txt` in python-backend folder

### "Model download failed"
- Internet connection issue
- Solution: Check connection and try again. Model only downloads once.

### Port 8000 already in use
- Another application using port 8000
- Solution: Change port in both:
  - `python-backend/remove_bg.py` (line at bottom)
  - `lib/nodes/registry.ts` (localhost:8000 URL)

---

## Features Now Working

✅ **Background Removal**
- Free & unlimited
- High quality AI (U2-Net)
- Transparent PNG output
- Batch processing

✅ **AI Image Generation**
- Free & unlimited (Pollinations.ai)
- No API key needed
- Fast generation (~3-5 seconds)
- Multiple aspect ratios

✅ **Contextual Chat**
- Modify existing workflows
- Complex multi-step requests
- Natural language understanding

✅ **Undo/Redo System**
- Full history (50 snapshots)
- Keyboard shortcuts
- Node deletion support

---

## Birthday Gift Ready! 🎁

Your girlfriend can now:
1. **Chat naturally** - "Get me flowers, remove background, sort by size"
2. **Generate AI images** - "Create a sunset image"
3. **Process images** - Remove backgrounds from any image
4. **Undo mistakes** - Ctrl+Z works everywhere
5. **See instant results** - Everything updates in real-time

---

## Production Notes

For deploying to production:
- Use `gunicorn` for Python backend
- Add image caching
- Consider rate limiting
- Add proper error monitoring

---

## Need Help?

Check the console logs:
- Python: Shows processing progress
- Next.js: Shows API calls and workflow execution

Both servers log everything for easy debugging!
