# 🚀 Starting PrismAI

## Quick Start

```bash
npm install
npm run dev
```

**Done!** Open http://localhost:3000

The app runs as a single Next.js server (port 3000). All AI generation —
including background removal, upscaling, and image/video/audio generation — runs
through external providers (Replicate, Gemini, ElevenLabs, FAL, and others) via
the `ai_generator` node. There is no separate local microservice to run.

See [`.env.local.example`](.env.local.example) for the environment variables you
need before generation will work.

---

## Troubleshooting

### Port 3000 already in use
- Another application is using port 3000.
- Solution: stop the other process, or run `npm run dev -- -p <port>`.

### Generation fails / nodes error
- Check that the relevant provider key is set in `.env.local`
  (`REPLICATE_API_TOKEN`, `GEMINI_API_KEY`, etc.).
- Check the Next.js console for the API call and workflow-execution logs.
