import type { AiModel } from '@/lib/nodes/types';
import type { ChatPreferences } from '@/lib/store/types';

/**
 * Shared option sets + resolvers for the chat composer's standing preferences.
 * Client-safe (types + pure functions only) so the Preferences menu, the chip
 * row, and the send-payload builder all agree on labels and which models count
 * as image vs video.
 */

export const ASPECT_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'];
export const VIDEO_DURATION_OPTIONS = ['5s', '10s', '15s'];
export const QUALITY_OPTIONS = ['480p', '720p', '1080p'];
export const OUTPUTS_OPTIONS = ['1', '2', '4'];
export const STYLE_OPTIONS = ['Photorealistic', 'Cinematic', 'Illustration', 'Anime', '3D'];

// Node-type ids for the "Generate image" / "Generate video" buckets. Mirrors
// the candidate sets NodeLibraryPanel maps its Basics tiles to, so the model
// picker shows exactly the generate-image / generate-video models (NOT every
// image-output utility like upscale or refine).
const IMAGE_NODE_TYPE_IDS = ['image_generation', 'generate_image', 'generate-image'];
const VIDEO_NODE_TYPE_IDS = ['video_generation', 'generate_video', 'generate-video'];

export function imageModels(models: AiModel[]): AiModel[] {
    return models.filter((m) => m.is_active && m.node_type_id != null && IMAGE_NODE_TYPE_IDS.includes(m.node_type_id));
}

export function videoModels(models: AiModel[]): AiModel[] {
    return models.filter((m) => m.is_active && m.node_type_id != null && VIDEO_NODE_TYPE_IDS.includes(m.node_type_id));
}

export function modelDisplayName(models: AiModel[], id: string): string | undefined {
    return models.find((m) => String(m.id) === String(id))?.display_name;
}

/** Human label for an outputs count value, e.g. '2' → '2 outputs'. */
function outputsLabel(v: string): string {
    return v === '1' ? '1 output' : `${v} outputs`;
}

export interface PreferenceChip {
    key: keyof ChatPreferences;
    label: string;
}

/**
 * The non-Auto preferences as display chips. Model preferences resolve their id
 * to a live display_name; an id that no longer matches an active model is
 * dropped (treated as Auto) rather than shown as a dangling id.
 */
export function resolvePreferenceChips(
    prefs: ChatPreferences,
    models: AiModel[],
): PreferenceChip[] {
    const chips: PreferenceChip[] = [];
    const push = (key: keyof ChatPreferences, label: string | undefined) => {
        if (label) chips.push({ key, label });
    };
    if (prefs.imageModelId !== 'auto') push('imageModelId', modelDisplayName(models, prefs.imageModelId));
    if (prefs.videoModelId !== 'auto') push('videoModelId', modelDisplayName(models, prefs.videoModelId));
    if (prefs.aspectRatio !== 'auto') push('aspectRatio', prefs.aspectRatio);
    if (prefs.videoDuration !== 'auto') push('videoDuration', prefs.videoDuration);
    if (prefs.quality !== 'auto') push('quality', prefs.quality);
    if (prefs.outputs !== 'auto') push('outputs', outputsLabel(prefs.outputs));
    if (prefs.style !== 'auto') push('style', prefs.style);
    return chips;
}

/** A model preference resolved for the send payload / brain block. */
export interface ResolvedModelPref {
    id: number;
    display_name: string;
}

/**
 * The shape sent in the /api/chat/stream body. Only non-Auto keys are present;
 * model keys are resolved to { id, display_name } so the server doesn't re-look
 * them up. Returns null when every preference is Auto (nothing to send).
 */
export interface ChatPreferencesPayload {
    imageModel?: ResolvedModelPref;
    videoModel?: ResolvedModelPref;
    aspectRatio?: string;
    videoDuration?: string;
    quality?: string;
    outputs?: string;
    style?: string;
}

export function buildPreferencesPayload(
    prefs: ChatPreferences,
    models: AiModel[],
): ChatPreferencesPayload | null {
    const payload: ChatPreferencesPayload = {};
    const resolveModel = (id: string): ResolvedModelPref | undefined => {
        const m = models.find((x) => String(x.id) === String(id));
        return m ? { id: m.id, display_name: m.display_name } : undefined;
    };
    if (prefs.imageModelId !== 'auto') payload.imageModel = resolveModel(prefs.imageModelId);
    if (prefs.videoModelId !== 'auto') payload.videoModel = resolveModel(prefs.videoModelId);
    if (prefs.aspectRatio !== 'auto') payload.aspectRatio = prefs.aspectRatio;
    if (prefs.videoDuration !== 'auto') payload.videoDuration = prefs.videoDuration;
    if (prefs.quality !== 'auto') payload.quality = prefs.quality;
    if (prefs.outputs !== 'auto') payload.outputs = prefs.outputs;
    if (prefs.style !== 'auto') payload.style = prefs.style;

    return Object.keys(payload).length > 0 ? payload : null;
}
