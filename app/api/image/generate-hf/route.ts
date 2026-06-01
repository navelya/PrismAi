import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const prompt = searchParams.get('prompt');

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
        }

        const apiToken = process.env.HF_API_TOKEN;
        if (!apiToken) {
            return NextResponse.json(
                { error: 'HF_API_TOKEN not configured in .env.local' },
                { status: 500 }
            );
        }

        /* 
         * HUGGING FACE ROUTER API (New 2025 Endpoint)
         * Legacy api-inference.huggingface.co is deprecated (410 Gone).
         * 
         * Endpoint: https://router.huggingface.co/hf-inference/models/{model_id}
         * Provider: 'hf-inference' usually matches legacy free tier behavior.
         */

        // Use SDXL Base 1.0 which is widely available
        const modelId = 'stabilityai/stable-diffusion-xl-base-1.0';
        const provider = 'hf-inference';
        const url = `https://router.huggingface.co/${provider}/models/${modelId}`;

        // Add negative prompt for better quality
        const negativePrompt = "blurry, bad quality";

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
                'x-use-cache': 'false'
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    negative_prompt: negativePrompt,
                }
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('HF Router API error:', response.status, errorText);

            // Handle 503 Model Loading (common on free tier)
            if (response.status === 503) {
                let waitTime = 20;
                try {
                    const data = JSON.parse(errorText);
                    if (data.estimated_time) waitTime = Math.ceil(data.estimated_time);
                } catch (e) { }

                return NextResponse.json(
                    { error: `Model is loading (cold start). Please try again in ${waitTime} seconds.` },
                    { status: 503 }
                );
            }

            // Handle 403 Forbidden (token issues)
            if (response.status === 403 || response.status === 401) {
                return NextResponse.json(
                    { error: 'Access Denied (403). Your HF Token lacks "Inference" permissions. Go to huggingface.co/settings/tokens, create a "Fine-grained" token, and enable "Inference".' },
                    { status: 403 }
                );
            }

            // Handle 410 Gone
            if (response.status === 410) {
                return NextResponse.json(
                    { error: 'HF API Endpoint deprecated (410). Please report this issue.' },
                    { status: 410 }
                );
            }

            return NextResponse.json(
                { error: `Hugging Face API error (${response.status}): ${errorText}` },
                { status: response.status }
            );
        }

        // Response is the raw image bytes
        const imageBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);

        if (buffer.length === 0) {
            return NextResponse.json(
                { error: 'Received empty image from Hugging Face' },
                { status: 500 }
            );
        }

        return new NextResponse(buffer, {
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'no-store',
            },
        });

    } catch (error) {
        console.error('❌ HF image generation error:', error);
        const msg = error instanceof Error ? error.message : 'Failed to generate image';
        return NextResponse.json(
            { error: msg },
            { status: 500 }
        );
    }
}
