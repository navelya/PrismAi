/**
 * One-off: generate the 4 chat welcome-card hero images via Gemini (Nano Banana)
 * and write them to public/assets/welcome-cards/. Each image is a cohesive,
 * dark-cinematic conceptual scene illustrating one capability card's title.
 *
 *   node scripts/generate-welcome-cards.js
 *
 * Requires GEMINI_API_KEY (read from .env.local). Image generation on the
 * Gemini API generally needs a billed project — the free tier returns quota 0.
 */
const fs = require('fs');
const path = require('path');

// --- load GEMINI_API_KEY from .env.local -----------------------------------
function loadApiKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
    const envPath = path.join(__dirname, '..', '.env.local');
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*GEMINI_API_KEY\s*=\s*(.+)\s*$/);
        if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
    throw new Error('GEMINI_API_KEY not found in env or .env.local');
}

const API_KEY = loadApiKey();
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'welcome-cards');

// Nano Banana image models that use the generateContent endpoint, preferred first.
const MODELS = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];

// Shared style: real, photorealistic photography that fills the frame and
// reads cohesively as one set — cinematic grade so it sits on the dark UI.
const STYLE =
    'Realistic professional photograph, photorealistic, shot on a full-frame camera, natural light, ' +
    'cinematic color grading, moody and slightly dark, rich detail, shallow depth of field, ' +
    'subject fills the frame, wide landscape 16:9 composition. No text, no words, no logos, no UI overlays, no illustration.';

const CARDS = [
    {
        file: 'generate.png',
        prompt:
            'A modern film and photo studio set: a cinema camera on a tripod facing a beautifully lit scene, ' +
            'softbox lights and colorful gels glowing, behind-the-scenes of a vibrant photo/video shoot — ' +
            'the craft of creating images and video.',
    },
    {
        file: 'edit.png',
        prompt:
            'A polished professional studio portrait of a person against a clean seamless backdrop under soft ' +
            'beauty-dish lighting, flawless flattering skin and crisp detail — the kind of high-end headshot ' +
            'a retoucher edits and refines.',
    },
    {
        file: 'automate.png',
        prompt:
            'A backlit photographer\'s light table covered with neat rows of film slides and negatives, dozens of ' +
            'small images laid out in an orderly grid, hands sorting them — many photographs being processed ' +
            'together in batch.',
    },
    {
        file: 'guidance.png',
        prompt:
            'A lone person standing on a winding path looking out toward a bright sunrise over a vast, ' +
            'inspiring landscape, contemplative and hopeful — a sense of direction, possibility, and figuring ' +
            'out where to begin.',
    },
];

async function generateOne(card) {
    const fullPrompt = `${card.prompt}\n\n${STYLE}`;
    const body = JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { imageConfig: { aspectRatio: '16:9' } },
    });

    let lastError = '';
    for (const model of MODELS) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
                body,
            });
            if (!res.ok) {
                lastError = `${model}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`;
                console.warn(`  ⚠️  ${lastError}`);
                continue;
            }
            const data = await res.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            const img = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));
            if (!img) {
                const txt = parts.find((p) => p.text);
                lastError = `${model}: no image returned${txt ? ' — ' + txt.text.slice(0, 120) : ''}`;
                console.warn(`  ⚠️  ${lastError}`);
                continue;
            }
            const buf = Buffer.from(img.inlineData.data, 'base64');
            const outPath = path.join(OUT_DIR, card.file);
            fs.writeFileSync(outPath, buf);
            console.log(`  ✅ ${card.file}  (${model}, ${(buf.length / 1024).toFixed(0)} KB)`);
            return true;
        } catch (err) {
            lastError = `${model}: ${err.message}`;
            console.warn(`  ⚠️  ${lastError}`);
        }
    }
    console.error(`  ❌ ${card.file} FAILED — ${lastError}`);
    return false;
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    console.log(`Generating ${CARDS.length} welcome-card images → ${OUT_DIR}\n`);
    let ok = 0;
    for (const card of CARDS) {
        console.log(`• ${card.file}`);
        if (await generateOne(card)) ok++;
    }
    console.log(`\nDone: ${ok}/${CARDS.length} generated.`);
    process.exit(ok === CARDS.length ? 0 : 1);
})();
