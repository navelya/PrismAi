import { ExecutionContext, NodeExecutionResult, AIGenerateImageConfig } from '../../types';

export const aiGenerateImageExecutor = async (
    config: AIGenerateImageConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const aiConfig = config;

        // Use dynamically routed text input if available
        // The Prompt node outputs { text: string } OR it could just be a string
        const incomingPromptObj = input?.prompt_in || input?.text || input;
        const dynamicPrompt = typeof incomingPromptObj === 'object' ? incomingPromptObj.text : incomingPromptObj;

        const prompt = typeof dynamicPrompt === 'string' && dynamicPrompt.trim() !== '' ? dynamicPrompt : (aiConfig.prompt || 'A beautiful image');

        const { model = 'gemini', aspectRatio = '1:1' } = aiConfig;

        // Determine dimensions based on aspect ratio
        const [width, height] = aspectRatio === '16:9' ? [1920, 1080] :
            aspectRatio === '4:3' ? [1600, 1200] : [1024, 1024];

        const isBrowser = typeof window !== 'undefined';

        if (isBrowser) {
            // CLIENT-SIDE: Proxy through Next.js API routes
            const baseUrl = window.location.origin;

            let proxyUrl: string;
            let sourceName: string;

            switch (model) {
                case 'pollinations':
                    proxyUrl = `${baseUrl}/api/image/generate?prompt=${encodeURIComponent(prompt)}&width=${width}&height=${height}`;
                    sourceName = 'Pollinations.ai';
                    break;
                case 'huggingface':
                    proxyUrl = `${baseUrl}/api/image/generate-hf?prompt=${encodeURIComponent(prompt)}`;
                    sourceName = 'Stable Diffusion XL (Hugging Face)';
                    break;
                default:
                    const geminiModel = model === 'gemini' ? 'gemini-2.5-flash-image' : model;
                    proxyUrl = `${baseUrl}/api/image/generate-gemini?prompt=${encodeURIComponent(prompt)}&aspectRatio=${aspectRatio}&model=${geminiModel}`;
                    if (model === 'gemini-3-pro-image-preview') sourceName = 'Gemini 3 Pro';
                    else if (model === 'gemini-2.5-flash-image') sourceName = 'Nano Banana';
                    else sourceName = 'Gemini Imagen';
                    break;
            }

            const response = await fetch(proxyUrl);
            if (!response.ok) {
                const errorBody = await response.text();
                let errorMsg = `Image generation failed (${sourceName}): ${response.status}`;
                try {
                    const parsed = JSON.parse(errorBody);
                    if (parsed.error) errorMsg = `${sourceName}: ${parsed.error}`;
                } catch { /* use default error */ }
                throw new Error(errorMsg);
            }

            const blob = await response.blob();
            if (blob.size === 0) throw new Error(`Received empty image from ${sourceName}`);

            const arrayBuffer = await blob.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const mimeType = blob.type || 'image/png';
            const base64 = `data:${mimeType};base64,${buffer.toString('base64')}`;

            return {
                success: true,
                data: [{
                    url: base64,
                    resolution: { width: model === 'gemini' ? 1024 : width, height: model === 'gemini' ? 1024 : height },
                    metadata: {
                        title: `AI Generated: ${prompt}`,
                        source: sourceName,
                        format: mimeType.split('/')[1] || 'png',
                        generatedBy: `${sourceName} (AI)`,
                        prompt,
                    },
                }],
            };
        } else {
            // SERVER-SIDE: Call Gemini API directly
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) throw new Error('GEMINI_API_KEY not configured on server');

            const geminiModel = (model === 'gemini' || !model) ? 'gemini-2.5-flash-image' : model;
            const sourceName = geminiModel === 'gemini-3-pro-image-preview' ? 'Gemini 3 Pro' : 'Nano Banana';

            // Gemini Image Generation models to try
            const modelsToTry = [geminiModel, 'gemini-2.5-flash-image', 'imagen-3.0-generate-001'].filter(
                (v, i, arr) => arr.indexOf(v) === i // deduplicate
            );

            const body: any = {
                contents: [{ parts: [{ text: prompt }] }],
            };
            if (aspectRatio !== '1:1') {
                body.generationConfig = { imageConfig: { aspectRatio } };
            }
            const bodyStr = JSON.stringify(body);

            let lastError = '';
            for (const tryModel of modelsToTry) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${tryModel}:generateContent`;
                console.log(`🎨 [Server] Trying Gemini image model: ${tryModel}`);

                try {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-goog-api-key': apiKey,
                        },
                        body: bodyStr,
                    });

                    if (response.status === 429 || response.status === 404) {
                        lastError = `${tryModel}: ${response.status === 429 ? 'Rate limited' : 'Not found'}`;
                        console.warn(`⚠️ ${lastError}, trying next...`);
                        continue;
                    }

                    if (!response.ok) {
                        const errorText = await response.text();
                        lastError = `${tryModel}: HTTP ${response.status}`;
                        console.error(`${tryModel} error:`, errorText.substring(0, 300));
                        continue;
                    }

                    const data = await response.json();
                    const candidates = data.candidates || [];
                    if (candidates.length === 0) { lastError = `${tryModel}: No candidates`; continue; }

                    const parts = candidates[0].content?.parts || [];
                    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
                    if (!imagePart) { lastError = `${tryModel}: No image in response`; continue; }

                    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
                    const mimeType = imagePart.inlineData.mimeType || 'image/png';
                    const base64 = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
                    console.log(`✅ [Server] Image generated with ${tryModel} (${imageBuffer.length} bytes)`);

                    return {
                        success: true,
                        data: [{
                            url: base64,
                            resolution: { width: 1024, height: 1024 },
                            metadata: {
                                title: `AI Generated: ${prompt}`,
                                source: sourceName,
                                format: mimeType.split('/')[1] || 'png',
                                generatedBy: `${sourceName} (AI)`,
                                prompt,
                            },
                        }],
                    };
                } catch (fetchError) {
                    lastError = `${tryModel}: ${fetchError instanceof Error ? fetchError.message : 'Network error'}`;
                    console.error(`${tryModel} fetch error:`, fetchError);
                    continue;
                }
            }

            throw new Error(lastError || 'All Gemini image models failed on server');
        }
    } catch (error) {
        console.error('❌ AI Image Generation Error:', error);
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to generate image',
        };
    }
};
