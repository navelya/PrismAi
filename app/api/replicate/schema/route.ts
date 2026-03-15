import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get('model_id');

    if (!modelId) {
        return NextResponse.json({ error: 'Missing model_id parameter' }, { status: 400 });
    }

    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!replicateToken) {
        return NextResponse.json({ error: 'REPLICATE_API_TOKEN is not configured' }, { status: 500 });
    }

    try {
        let apiUrl = `https://api.replicate.com/v1/models/${modelId}`;
        let isVersionFetch = false;

        // Detect if modelId contains a version hash (e.g., owner/name:hash)
        if (modelId.includes(':')) {
            const [fullModelName, versionHash] = modelId.split(':');
            apiUrl = `https://api.replicate.com/v1/models/${fullModelName}/versions/${versionHash}`;
            isVersionFetch = true;
        }

        const response = await fetch(apiUrl, {
            headers: {
                Authorization: `Token ${replicateToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.json();
            return NextResponse.json({ error: error.detail || 'Failed to fetch model from Replicate' }, { status: response.status });
        }

        const data = await response.json();
        
        // If we fetched a specific version, the schema is top-level.
        // If we fetched the model, we need to look at the latest_version.
        const openapi_schema = isVersionFetch ? data.openapi_schema : data.latest_version?.openapi_schema;
        
        if (!openapi_schema) {
            return NextResponse.json({ error: 'No OpenAPI schema found for this model/version' }, { status: 404 });
        }

        // For version fetches, we might need to fetch the parent model separately to get owner/cover_image if not included
        // However, usually the response contains enough or we can derive it.
        // Let's assume for now we want the model metadata.
        
        let owner = data.owner;
        let cover_image_url = data.cover_image_url;

        if (isVersionFetch && !owner) {
            // If it's a version fetch, owner might not be in the version object
            const [ownerName] = modelId.split('/');
            owner = ownerName;
        }

        return NextResponse.json({
            openapi_schema,
            owner,
            cover_image_url,
        });
    } catch (error: any) {
        console.error('Error fetching Replicate schema:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
