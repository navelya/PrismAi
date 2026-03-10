import { NodeServerDef } from './types';
import { scrapeImagesSharedDef } from '../plugins/scrape_images';
import { scrapeImagesExecutor } from '../plugins/scrape_images/executor';
import { removeBackgroundSharedDef } from '../plugins/remove_background';
import { removeBackgroundExecutor } from '../plugins/remove_background/executor';
import { filterSortSharedDef } from '../plugins/filter_sort';
import { filterSortExecutor } from '../plugins/filter_sort/executor';
import { aiGenerateImageSharedDef } from '../plugins/ai_generate_image';
import { aiGenerateImageExecutor } from '../plugins/ai_generate_image/executor';
import { upscaleImageSharedDef } from '../plugins/upscale_image';
import { upscaleImageExecutor } from '../plugins/upscale_image/executor';
import { mediaInputSharedDef } from '../plugins/media_input';
import { mediaInputExecutor } from '../plugins/media_input/executor';
import { promptSharedDef } from '../plugins/prompt';
import { promptExecutor } from '../plugins/prompt/executor';
import { compositorSharedDef } from '../plugins/compositor';
import { compositorExecutor } from '../plugins/compositor/executor';

// The server-side registry mapping definition types
// Only import this in Node.js/Backend execution environments
export const serverRegistry: Record<string, NodeServerDef> = {
    prompt: { ...promptSharedDef, executor: promptExecutor },
    scrape_images: { ...scrapeImagesSharedDef, executor: scrapeImagesExecutor },
    remove_background: { ...removeBackgroundSharedDef, executor: removeBackgroundExecutor },
    filter_sort: { ...filterSortSharedDef, executor: filterSortExecutor },
    ai_generate_image: { ...aiGenerateImageSharedDef, executor: aiGenerateImageExecutor },
    upscale_image: { ...upscaleImageSharedDef, executor: upscaleImageExecutor },
    media_input: { ...mediaInputSharedDef, executor: mediaInputExecutor },
    compositor: { ...compositorSharedDef, executor: compositorExecutor },
};
