import {
  extractRenderableMedia,
  toOutputEnvelope,
  type RenderableMediaItem,
} from './result-format';

/**
 * Ordered image/video media a chat run should show for one terminal node.
 *
 * Why this isn't just `extractRenderableMedia(nodeOutputs[id])`: an ai_generator
 * node deliberately NARROWS its `nodeOutputs[id]` envelope to the single selected
 * (carousel-front) output, so a downstream consumer (Compositor/Blur) receives
 * exactly one image — see the republish-active effect in the ai_generator
 * component. Its full per-run set instead lives in `config.outputs` (newest-first,
 * each item stamped with its `execution_id`). A fan-out run (iterations > 1)
 * therefore has N images in `config.outputs` but only 1 in `nodeOutputs`, which is
 * why reading `nodeOutputs` froze a single image into the chat result.
 *
 * For an ai_generator terminal with a known run, return every output produced by
 * THIS execution (in generation order). For any other terminal — or when the run
 * id is unknown / no matching collection items exist — fall back to the live
 * output envelope, which for those node types is already the full result.
 */
export function collectTerminalRunMedia(
  node: any,
  liveOutput: any,
  executionId: string | undefined,
): RenderableMediaItem[] {
  if (node?.type === 'ai_generator' && executionId) {
    const outputs = node?.data?.config?.outputs;
    if (Array.isArray(outputs)) {
      const runItems = outputs.filter((o: any) => o?.execution_id === executionId);
      if (runItems.length > 0) {
        const media: RenderableMediaItem[] = [];
        for (const o of runItems) {
          for (const m of extractRenderableMedia(toOutputEnvelope(o.type, [o.value]))) {
            if (m.type === 'image' || m.type === 'video') media.push(m);
          }
        }
        return media;
      }
    }
  }
  return extractRenderableMedia(liveOutput).filter((m) => m.type === 'image' || m.type === 'video');
}
