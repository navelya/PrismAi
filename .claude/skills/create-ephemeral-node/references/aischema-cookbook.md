# aiSchema Cookbook

Every plugin's `definition.ts` includes an `aiSchema` field. The chat brain reads this from `sharedRegistry` and uses it to construct the node from natural-language requests like "blur the cat by 30%". Under-specified schemas mean the AI can't use the node well — a vague schema makes the brain default to vague config.

`aiSchema` follows JSON Schema conventions. The brain understands `type`, `properties`, `required`, `enum`, `minimum`, `maximum`, `default`, `description`, and `items` for arrays.

## Pattern by shape

### Transform (e.g. blur, brightness, rotate)

Simple object with a few primitive controls. Each control has `description`, `default`, and bounds.

```ts
aiSchema: {
  type: 'object',
  properties: {
    radius: {
      type: 'number',
      description: 'Blur radius in pixels (0 = no blur, 50 = very heavy)',
      minimum: 0,
      maximum: 50,
      default: 5,
    },
  },
}
```

For an enum control:

```ts
properties: {
  blur_type: {
    type: 'string',
    enum: ['gaussian', 'box', 'stack'],
    description: 'The blur algorithm. Gaussian is smooth, box is faster, stack mimics motion.',
    default: 'gaussian',
  },
}
```

### Source — prompt (text input)

```ts
aiSchema: {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'The text prompt or search query.',
    },
  },
  required: ['text'],
}
```

Note `required` so the AI brain always provides text when emitting this node.

### Source — media_input (file upload)

```ts
aiSchema: {
  type: 'object',
  properties: {
    images: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array of base64 image strings or URLs',
    },
  },
}
```

The brain may pre-populate the `images` array with base64 strings or URLs from the chat thread (uploaded by the user). Without this aiSchema, the brain can't connect a chat-uploaded image to a workflow input.

### Layered — compositor

The trickiest case. The brain needs to generate a layer entry per input edge, with full transform data. Be explicit about the layer item shape:

```ts
aiSchema: {
  type: 'object',
  properties: {
    canvasWidth: { type: 'number', description: 'Width of the canvas in pixels' },
    canvasHeight: { type: 'number', description: 'Height of the canvas in pixels' },
    backgroundColor: {
      type: 'string',
      description: 'Hex color code with alpha (e.g., #00000000 for transparent)',
    },
    outputFormat: { type: 'string', enum: ['png', 'webp', 'jpeg'] },
    outputQuality: { type: 'number', minimum: 0, maximum: 1 },
    layers: {
      type: 'array',
      description:
        'CRITICAL: Array of layers. You MUST generate one layer object for ' +
        'every image you connect to this compositor.',
      items: {
        type: 'object',
        required: ['id', 'name', 'sourceHandleId', 'transform'],
        properties: {
          id: { type: 'string', description: 'Unique layer ID, e.g., layer_0' },
          name: { type: 'string', description: 'Layer name' },
          sourceHandleId: {
            type: 'string',
            description:
              'The exact ID of the targetHandle you will use in the edge ' +
              'array to connect to this layer. e.g., layer_0',
          },
          selectedIndex: { type: 'number', default: 0 },
          visible: { type: 'boolean', default: true },
          locked: { type: 'boolean', default: false },
          transform: {
            type: 'object',
            required: ['x', 'y', 'width', 'height'],
            properties: {
              x: { type: 'number', description: 'Left position' },
              y: { type: 'number', description: 'Top position' },
              width: { type: 'number', description: 'Rendered width' },
              height: { type: 'number', description: 'Rendered height' },
              rotation: { type: 'number', default: 0 },
              opacity: { type: 'number', default: 1 },
              flipX: { type: 'boolean', default: false },
              flipY: { type: 'boolean', default: false },
            },
          },
        },
      },
    },
  },
},
```

The CRITICAL note in the description is intentional — the brain reads it and pays attention. For other layered nodes, write similarly emphatic guidance about generating layer entries to match edges.

### Generative wrapper (ai_generator)

`ai_generator` is dynamic — its handles and aiSchema are pulled from the `ai_models.inputs_schema` JSONB column at runtime. The static aiSchema in its `definition.ts` is minimal:

```ts
aiSchema: {
  type: 'object',
  properties: {
    model_id: {
      type: 'number',
      description: 'ID of the selected ai_models row.',
    },
    control_values: {
      type: 'object',
      description: 'Per-model control values keyed by api_mapping_key.',
    },
  },
}
```

If you're building a non-Replicate generative wrapper (rare — see [node-recipes.md](node-recipes.md)), follow this pattern but with concrete fields instead of generic `control_values`.

## Description quality matters

Bad description:

```ts
radius: { type: 'number', description: 'Radius' }
```

Good description:

```ts
radius: {
  type: 'number',
  description: 'Blur radius in pixels. 0 = no blur. 5 = subtle. 25 = strong. 50 = extreme.',
  minimum: 0,
  maximum: 50,
  default: 5,
}
```

The brain uses descriptions to map vague user phrases ("blur it a lot") to concrete values. Anchor common verbal magnitudes to numeric values when possible.

## Required vs optional

Mark `required: ['text']` for fields the AI brain MUST provide. Use sparingly — most workflow controls have sensible defaults. Required is for fields where the node is meaningless without a value (a prompt with no text).

## Test by reading the registry context

The chat brain assembles its node-type prompt from `sharedRegistry`. To preview what the brain will see for your new node, search `lib/chat/prompt/registry-context.ts` — it's the function that turns `sharedRegistry` entries into the brain's context. Inspect what your new node looks like there. If it reads as ambiguous to a human, it'll read as ambiguous to the brain.
