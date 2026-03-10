import { NodeSharedDef } from './types';
import { promptSharedDef } from '../plugins/prompt';
import { scrapeImagesSharedDef } from '../plugins/scrape_images';
import { removeBackgroundSharedDef } from '../plugins/remove_background';
import { filterSortSharedDef } from '../plugins/filter_sort';
import { aiGenerateImageSharedDef } from '../plugins/ai_generate_image';
import { upscaleImageSharedDef } from '../plugins/upscale_image';
import { mediaInputSharedDef } from '../plugins/media_input';
import { compositorSharedDef } from '../plugins/compositor';

// The global shared registry mapping definition types
// This is safe to import { promptSharedDef } from '../plugins/prompt';

export const sharedRegistry: Record<string, NodeSharedDef<any>> = {
    prompt: promptSharedDef,
    scrape_images: scrapeImagesSharedDef,
    remove_background: removeBackgroundSharedDef,
    filter_sort: filterSortSharedDef,
    ai_generate_image: aiGenerateImageSharedDef,
    upscale_image: upscaleImageSharedDef,
    media_input: mediaInputSharedDef,
    compositor: compositorSharedDef,
};
