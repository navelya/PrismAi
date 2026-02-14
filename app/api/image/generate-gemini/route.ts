import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Nano Banana models in order of preference
// Docs: https://ai.google.dev/gemini-api/docs/image-generation
const GEMINI_IMAGE_MODELS = [
    'imagen-3.0-generate-001',
    'gemini-2.5-flash-image',       // Nano Banana
    'gemini-3-pro-image-preview',   // Nano Banana Pro
];

/**
 * Proxy for Gemini Nano Banana image generation.
 * Uses generateContent with the correct Nano Banana models.
 * 
 * NOTE: Image generation on Gemini API typically requires a billed project.
 * The free tier often has a quota limit of 0 for image generation models.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const prompt = searchParams.get('prompt');
        const aspectRatio = searchParams.get('aspectRatio') || '1:1';
        const modelParam = searchParams.get('model');

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
        }

        // Determine which models to try
        // If a specific model is requested, try only that one.
        // Otherwise, fall back to trying all available valid models.
        let modelsToTry = GEMINI_IMAGE_MODELS;
        if (modelParam && GEMINI_IMAGE_MODELS.includes(modelParam)) {
            modelsToTry = [modelParam];
        } else if (modelParam && modelParam !== 'gemini') {
            // If unknown model requested, warn but try default list
            console.warn(`Unknown model requested: ${modelParam}, falling back to defaults`);
        }

        // Build request body per official docs
        // https://ai.google.dev/gemini-api/docs/image-generation
        const body: any = {
            contents: [{
                parts: [{ text: prompt }]
            }],
        };

        // Add optional aspect ratio via imageConfig
        if (aspectRatio !== '1:1') {
            body.generationConfig = {
                imageConfig: {
                    aspectRatio: aspectRatio,
                }
            };
        }

        const bodyStr = JSON.stringify(body);

        // Try each model
        let lastError = '';
        for (const model of modelsToTry) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
            console.log(`🎨 Trying Gemini image model: ${model}`);

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': apiKey,
                    },
                    body: bodyStr,
                });

                if (response.status === 429) {
                    const errorText = await response.text();
                    // Check if it's a quota limit of 0 (common for free tier image gen)
                    if (errorText.includes('limit: 0')) {
                        lastError = `Gemini Image Generation not available on free tier for this project.`;
                        console.warn(`⚠️ ${model} quota limit is 0 (not available on free tier)`);
                        break; // Don't retry other models if quota is 0
                    }

                    lastError = `${model}: Rate limited. Please try again later.`;
                    console.warn(`⚠️ ${model} rate limited, trying next model...`);
                    continue;
                }

                if (response.status === 404) {
                    lastError = `${model}: Model not available`;
                    console.warn(`⚠️ ${model} not found, trying next...`);
                    continue;
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    lastError = `${model}: HTTP ${response.status} - ${errorText.substring(0, 100)}`;
                    console.error(`${model} error:`, response.status, errorText.substring(0, 300));
                    continue;
                }

                const data = await response.json();

                const candidates = data.candidates || [];
                if (candidates.length === 0) {
                    lastError = `${model}: No candidates in response`;
                    continue;
                }

                const parts = candidates[0].content?.parts || [];
                const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));

                if (!imagePart) {
                    // Model returned text-only
                    const textPart = parts.find((p: any) => p.text);
                    lastError = `${model}: No image generated${textPart ? ' — ' + textPart.text.substring(0, 100) : ''}`;
                    continue;
                }

                // Success!
                const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
                const mimeType = imagePart.inlineData.mimeType || 'image/png';
                console.log(`✅ Image generated with ${model} (${imageBuffer.length} bytes)`);

                return new NextResponse(imageBuffer, {
                    headers: {
                        'Content-Type': mimeType,
                        'Cache-Control': 'no-store',
                    },
                });

            } catch (fetchError) {
                lastError = `${model}: ${fetchError instanceof Error ? fetchError.message : 'Network error'}`;
                console.error(`${model} fetch error:`, fetchError);
                continue;
            }
        }

        throw new Error(lastError || 'All Gemini image models failed');

    } catch (error) {
        console.error('❌ Gemini image generation error:', error);
        // Clean up error message for user
        const msg = error instanceof Error ? error.message : 'Failed to generate image';
        const cleanMsg = msg.replace(/.*: /, ''); // Remove prefix

        return NextResponse.json(
            { error: cleanMsg },
            { status: 500 }
        );
    }
}
