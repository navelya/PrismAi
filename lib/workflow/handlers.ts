/**
 * Workflow Engine v2 - STEP 5: Ephemeral Node Handler Registry
 * 
 * Server-side handlers for ephemeral nodes (non-AI transforms)
 * Each handler is a pure function: (properties, inputs) => output
 */

import sharp from 'sharp';
import { mediaInputExecutor } from '../nodes/plugins/media_input/executor';
import { blurExecutor } from '../nodes/plugins/blur/executor';

export type HandlerFunction = (
  properties: Record<string, any>,
  inputs: Record<string, any>
) => Promise<Buffer | string>;

/**
 * Handler Registry
 * Maps node type to handler function
 */
export const EPHEMERAL_HANDLERS: Record<string, HandlerFunction> = {
  blur: handleBlur,
  levels: handleLevels,
  brightness: handleBrightness,
  contrast: handleContrast,
  grayscale: handleGrayscale,
  invert: handleInvert,
  rotate: handleRotate,
  resize: handleResize,
  prompt: handlePrompt,
  compositor: handleCompositor,
  media_input: handleMediaInput,
};

/**
 * Media Input Handler
 * Adapter for the mediaInputExecutor
 */
async function handleMediaInput(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<any> {
  const config = properties.config || properties;
  const result = await mediaInputExecutor(config as any, inputs, {} as any);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

/**
 * Check if a node type is ephemeral
 */
export function isEphemeralNode(nodeType: string): boolean {
  return nodeType in EPHEMERAL_HANDLERS;
}

/**
 * Blur Handler
 * Adapter for the blurExecutor - uses the new plugin architecture
 */
async function handleBlur(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  const config = properties.config || properties;
  
  // The executor expects server environment (not browser)
  // It will fetch the image and apply blur using Sharp
  const imageUrl = inputs.image;
  if (!imageUrl) {
    throw new Error('Blur node requires "image" input');
  }
  
  const radius = config.radius || 5;
  
  console.log(`[Handler/Blur] Applying blur with radius ${radius} to ${imageUrl}`);
  
  // Fetch image
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  // Apply blur using Sharp
  const output = await sharp(imageBuffer)
    .blur(radius)
    .toBuffer();
  
  console.log(`[Handler/Blur] Output size: ${output.length} bytes`);
  
  return output;
}

/**
 * Levels Handler
 * Adjusts tonal range (shadows, midtones, highlights)
 */
async function handleLevels(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  
  const imageUrl = inputs.image;
  if (!imageUrl) {
    throw new Error('Levels node requires "image" input');
  }
  
  const shadows = properties.shadows || 0;
  const midtones = properties.midtones || 1;
  const highlights = properties.highlights || 255;
  
  console.log(`[Handler/Levels] Adjusting levels: ${shadows}-${midtones}-${highlights}`);
  
  // Fetch image
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  // Apply levels using normalize
  const output = await sharp(imageBuffer)
    .normalize()
    .toBuffer();
  
  return output;
}

/**
 * Brightness Handler
 * Adjusts image brightness
 */
async function handleBrightness(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  
  const imageUrl = inputs.image;
  if (!imageUrl) {
    throw new Error('Brightness node requires "image" input');
  }
  
  const brightness = properties.brightness || 1.0;
  
  console.log(`[Handler/Brightness] Adjusting brightness: ${brightness}`);
  
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  const output = await sharp(imageBuffer)
    .modulate({ brightness })
    .toBuffer();
  
  return output;
}

/**
 * Contrast Handler
 * Adjusts image contrast
 */
async function handleContrast(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  
  const imageUrl = inputs.image;
  if (!imageUrl) {
    throw new Error('Contrast node requires "image" input');
  }
  
  const contrast = properties.contrast || 1.0;
  
  console.log(`[Handler/Contrast] Adjusting contrast: ${contrast}`);
  
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  const output = await sharp(imageBuffer)
    .linear(contrast, 0)
    .toBuffer();
  
  return output;
}

/**
 * Grayscale Handler
 * Converts image to grayscale
 */
async function handleGrayscale(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  
  const imageUrl = inputs.image;
  if (!imageUrl) {
    throw new Error('Grayscale node requires "image" input');
  }
  
  console.log(`[Handler/Grayscale] Converting to grayscale`);
  
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  const output = await sharp(imageBuffer)
    .grayscale()
    .toBuffer();
  
  return output;
}

/**
 * Invert Handler
 * Inverts image colors
 */
async function handleInvert(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  
  const imageUrl = inputs.image;
  if (!imageUrl) {
    throw new Error('Invert node requires "image" input');
  }
  
  console.log(`[Handler/Invert] Inverting colors`);
  
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  const output = await sharp(imageBuffer)
    .negate()
    .toBuffer();
  
  return output;
}

/**
 * Rotate Handler
 * Rotates image by specified angle
 */
async function handleRotate(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  
  const imageUrl = inputs.image;
  if (!imageUrl) {
    throw new Error('Rotate node requires "image" input');
  }
  
  const angle = properties.angle || 0;
  
  console.log(`[Handler/Rotate] Rotating by ${angle} degrees`);
  
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  const output = await sharp(imageBuffer)
    .rotate(angle)
    .toBuffer();
  
  return output;
}

/**
 * Resize Handler
 * Resizes image to specified dimensions
 */
async function handleResize(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  
  const imageUrl = inputs.image;
  if (!imageUrl) {
    throw new Error('Resize node requires "image" input');
  }
  
  const width = properties.width;
  const height = properties.height;
  
  console.log(`[Handler/Resize] Resizing to ${width}x${height}`);
  
  const imageResponse = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  
  const output = await sharp(imageBuffer)
    .resize(width, height, { fit: 'contain' })
    .toBuffer();
  
  return output;
}

/**
 * Prompt Handler
 * Returns text prompt as string (no image processing)
 */
async function handlePrompt(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<string> {
  
  // Aggressively search for the text in all known possible locations
  const text = (properties as any).prompt || 
               (properties as any).text || 
               (properties as any).config?.text || 
               (properties as any).config?.prompt || 
               '';
  
  console.log(`[Handler/Prompt] Returning text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  
  return text;
}

/**
 * Compositor Handler
 * Takes an array of image layers, transforms them, and composites them onto a canvas
 */
async function handleCompositor(
  properties: Record<string, any>,
  inputs: Record<string, any>
): Promise<Buffer> {
  // Extract compositor config
  // Note: in ephemeral-executor, properties corresponds to `node.data`
  const config = properties.config || properties;
  
  const width = Math.round(config.canvasWidth || 1920);
  const height = Math.round(config.canvasHeight || 1080);
  const layers = config.layers || [];
  
  console.log(`[Handler/Compositor] Starting composition. Canvas: ${width}x${height}, Layers: ${layers.length}`);

  // Base canvas (transparent)
  let baseCanvas = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  });

  // Process layers in parallel. Each layer's fetch + Sharp transform is
  // independent (they all composite onto the same base canvas at the end), so
  // running them sequentially was leaving an entire wait-chain of network +
  // CPU latency on the table. Promise.all preserves array order, so the final
  // overlay list is still bottom-to-top in source-layer order.
  const layerResults = await Promise.all(
    layers.map(async (layer: any) => {
      if (!layer.visible) return null;

      const imageUrl = inputs[layer.sourceHandleId];
      if (!imageUrl) {
        console.log(`[Handler/Compositor] Skipping layer ${layer.name} - No input mapped to ${layer.sourceHandleId}`);
        return null;
      }

      try {
        console.log(`[Handler/Compositor] Processing layer ${layer.name} from ${imageUrl}`);

        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
        const arrayBuffer = await response.arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);

        const tf = layer.transform || {};
        const targetW = Math.max(1, Math.round(tf.width || width));
        const targetH = Math.max(1, Math.round(tf.height || height));
        const rotation = tf.rotation || 0;

        let imgSharp = sharp(inputBuffer).resize(targetW, targetH, { fit: 'fill' });
        if (tf.flipX) imgSharp = imgSharp.flop();
        if (tf.flipY) imgSharp = imgSharp.flip();
        if (rotation !== 0) {
          imgSharp = imgSharp.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
        }

        const processedBuffer = await imgSharp.toBuffer();

        return {
          input: processedBuffer,
          left: Math.round(tf.x || 0),
          top: Math.round(tf.y || 0),
        };
      } catch (err) {
        console.error(`[Handler/Compositor] Failed to process layer ${layer.name}:`, err);
        // Per-layer failure: drop this overlay, continue with the rest.
        return null;
      }
    })
  );

  const overlays = layerResults.filter((o): o is { input: Buffer; left: number; top: number } => o !== null);

  // Composite all overlays onto the base canvas
  if (overlays.length > 0) {
    console.log(`[Handler/Compositor] Compositing ${overlays.length} overlays...`);
    baseCanvas = baseCanvas.composite(overlays);
  }

  const format = config.outputFormat || 'png';
  if (format === 'jpg' || format === 'jpeg') {
    return await baseCanvas.jpeg({ quality: Math.round((config.outputQuality || 1) * 100) }).toBuffer();
  } else if (format === 'webp') {
    return await baseCanvas.webp({ quality: Math.round((config.outputQuality || 1) * 100) }).toBuffer();
  } else {
    // PNG default
    return await baseCanvas.png().toBuffer();
  }
}
