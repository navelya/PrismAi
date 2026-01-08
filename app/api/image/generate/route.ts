import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering - this route uses request.url
export const dynamic = 'force-dynamic';

/**
 * Proxy for Pollinations.ai image generation
 * This route exists because Pollinations.ai blocks server-side requests (403)
 * but works fine from browser/client
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const prompt = searchParams.get('prompt');
        const width = searchParams.get('width') || '1024';
        const height = searchParams.get('height') || '1024';

        if (!prompt) {
            return NextResponse.json(
                { error: 'Prompt is required' },
                { status: 400 }
            );
        }

        const encodedPrompt = encodeURIComponent(prompt);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;

        console.log(`🎨 Proxying image generation: "${prompt}"`);

        // Fetch with browser-like headers
        const response = await fetch(imageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            },
            // @ts-ignore - Next.js specific
            next: { revalidate: 0 },
        });

        if (!response.ok) {
            throw new Error(`Pollinations.ai returned ${response.status}`);
        }

        // Get the image data
        const imageBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);

        // Return image with proper headers
        return new NextResponse(buffer, {
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });

    } catch (error) {
        console.error('❌ Image generation proxy error:', error);
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to generate image',
            },
            { status: 500 }
        );
    }
}
