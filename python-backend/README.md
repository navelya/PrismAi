---
title: PrismAI Backend
emoji: 🎨
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# PrismAI Backend

Image processing API for background removal and upscaling.

## Endpoints

- `GET /` - Health check
- `POST /remove-background` - Remove image background
- `POST /upscale` - Upscale image (2x, 3x, 4x, 8x)
