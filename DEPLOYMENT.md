# 🚀 PrismAI Deployment Guide

Deploy PrismAI to the cloud with **automatic deployments** on every `git push`.

## Architecture

| Component | Platform | Cost |
|-----------|----------|------|
| Frontend (Next.js) | [Vercel](https://vercel.com) | Free |
| Database | [Supabase](https://supabase.com) | Free tier |

---

## Deploy to Vercel

### 1. Connect to Vercel
1. Go to [vercel.com](https://vercel.com)
2. Sign up with your GitHub account
3. Click **"Add New Project"**
4. Import your GitHub repository

### 2. Configure Environment Variables
In Vercel project settings, add the environment variables documented in
[`.env.local.example`](.env.local.example) (Supabase, Anthropic, Gemini,
Replicate, Dodo Payments, and the optional generation-provider keys).

### 3. Deploy
Click **"Deploy"** - Vercel will build and deploy automatically.

Your frontend URL will be:
```
https://your-project-name.vercel.app
```

---

## Automatic Deployments

After initial setup, every push to GitHub triggers a Vercel auto-deploy of the frontend.

---

## Optional: Custom Domain

### Vercel
1. Go to Project Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed
