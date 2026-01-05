# 🚀 PrismAI Deployment Guide

Deploy PrismAI to the cloud with **automatic deployments** on every `git push`.

## Architecture

| Component | Platform | Cost |
|-----------|----------|------|
| Frontend (Next.js) | [Vercel](https://vercel.com) | Free |
| Backend (Python AI) | [Hugging Face Spaces](https://huggingface.co/spaces) | Free |
| Database | [Supabase](https://supabase.com) | Free tier |

---

## Step 1: Deploy Backend to Hugging Face Spaces

### 1.1 Create a Hugging Face Account
1. Go to [huggingface.co](https://huggingface.co)
2. Sign up for a free account

### 1.2 Create a New Space
1. Click **"New Space"** in the top right
2. Configure:
   - **Space name**: `prismai-backend`
   - **License**: MIT
   - **SDK**: `Docker`
   - **Hardware**: `CPU basic` (free)
3. Click **"Create Space"**

### 1.3 Push Backend Code
```bash
# Clone your new space
git clone https://huggingface.co/spaces/YOUR_USERNAME/prismai-backend

# Copy backend files
cp -r python-backend/* prismai-backend/

# Push to Hugging Face
cd prismai-backend
git add .
git commit -m "Initial deployment"
git push
```

### 1.4 Get Your Backend URL
Once deployed, your backend URL will be:
```
https://YOUR_USERNAME-prismai-backend.hf.space
```

---

## Step 2: Deploy Frontend to Vercel

### 2.1 Connect to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Sign up with your GitHub account
3. Click **"Add New Project"**
4. Import your GitHub repository

### 2.2 Configure Environment Variables
In Vercel project settings, add these environment variables:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `GEMINI_API_KEY` | Your Google Gemini API key |
| `PIXABAY_API_KEY` | Your Pixabay API key |
| `NEXT_PUBLIC_BACKEND_URL` | `https://YOUR_USERNAME-prismai-backend.hf.space` |

### 2.3 Deploy
Click **"Deploy"** - Vercel will build and deploy automatically.

Your frontend URL will be:
```
https://your-project-name.vercel.app
```

---

## Step 3: Verify Deployment

1. Open your Vercel URL
2. Try creating a workflow with "Scrape Images" node
3. Try "Remove Background" or "Upscale" to verify backend connection

---

## Automatic Deployments

After initial setup:

| Action | Result |
|--------|--------|
| Push to GitHub | Vercel auto-deploys frontend |
| Push to Hugging Face | Backend auto-rebuilds |

---

## Troubleshooting

### Backend not connecting?
- Check Hugging Face Space logs for errors
- Verify `NEXT_PUBLIC_BACKEND_URL` is set correctly in Vercel

### CORS errors?
- The backend is configured to accept requests from `*.vercel.app`
- If using a custom domain, add it to the CORS config in `image_service.py`

### Images not processing?
- Hugging Face free tier has 2 vCPU - processing may be slower than local
- Large images may timeout on free tier

---

## Optional: Custom Domain

### Vercel
1. Go to Project Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed

### Update Backend CORS
Add your custom domain to `image_service.py`:
```python
allow_origins=[
    "https://yourdomain.com",
    # ... existing origins
]
```
