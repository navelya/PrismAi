import { ExecutionContext, NodeExecutionResult } from '../../types';
import { createServiceClient } from '@/lib/supabase/service';

export interface EphemeralUploadOptions {
    /**
     * File prefix for the uploaded blob (e.g., 'blur', 'compositor')
     */
    prefix: string;
    
    /**
     * File extension without the dot (e.g., 'mp4', 'png')
     */
    extension: string;
    
    /**
     * MIME type for the storage bucket (e.g., 'video/mp4', 'image/png')
     */
    contentType: string;
    
    /**
     * Arbitrary metadata to attach to the returned NodeExecutionResult
     */
    metadata?: Record<string, any>;
    
    /**
     * If the artifact is an image, provide the resolution.
     */
    resolution?: { width: number; height: number };
}

/**
 * Uploads a generated Buffer to the `workflow-ephemeral-tmp` Supabase bucket 
 * and returns a standardized NodeExecutionResult containing the public URL.
 */
export async function uploadEphemeralResult(
    context: ExecutionContext,
    buffer: Buffer | Uint8Array,
    options: EphemeralUploadOptions
): Promise<NodeExecutionResult> {
    const supabase = createServiceClient();
    const filename = `${context.executionId}/${context.nodeId}/${options.prefix}_${Date.now()}.${options.extension}`;
    
    const { error: uploadError } = await supabase.storage
        .from('workflow-ephemeral-tmp')
        .upload(filename, buffer, { contentType: options.contentType, cacheControl: '3600' });
        
    if (uploadError) {
        return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
    }

    const { data: urlData } = supabase.storage.from('workflow-ephemeral-tmp').getPublicUrl(filename);
    
    return {
        success: true,
        data: [
            {
                url: urlData.publicUrl,
                ...(options.resolution ? { resolution: options.resolution } : {}),
                ...(options.metadata ? { metadata: options.metadata } : {}),
            }
        ]
    };
}
