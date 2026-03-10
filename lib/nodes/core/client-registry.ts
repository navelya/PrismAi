import { NodeClientDef } from './types';
import { scrapeImagesClientDef } from '../plugins/scrape_images/component';
import { removeBackgroundClientDef } from '../plugins/remove_background/component';
import { filterSortClientDef } from '../plugins/filter_sort/component';
import { aiGenerateImageClientDef } from '../plugins/ai_generate_image/component';
import { upscaleImageClientDef } from '../plugins/upscale_image/component';
import { mediaInputClientDef } from '../plugins/media_input/component';
import { compositorClientDef } from '../plugins/compositor/component';
import { promptClientDef } from '../plugins/prompt/component';

// The client-side registry mapping definition types
// Only import this in Browser/React components
export const clientRegistry: Record<string, NodeClientDef> = {
    prompt: promptClientDef,
    scrape_images: scrapeImagesClientDef,
    remove_background: removeBackgroundClientDef,
    filter_sort: filterSortClientDef,
    ai_generate_image: aiGenerateImageClientDef,
    upscale_image: upscaleImageClientDef,
    media_input: mediaInputClientDef,
    compositor: compositorClientDef,
};
