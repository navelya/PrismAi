# Handle Types Reference

The `NodeDataType` enum in `lib/nodes/core/types.ts`:

```ts
export type NodeDataType =
  | 'image'
  | 'video'
  | 'audio'
  | '3d'
  | 'text'
  | 'json'
  | 'image_array'
  | 'any'
  | 'prompt';
```

These are also stored in the Supabase `data_types` table — the `id` column matches these strings. Don't invent new types without DB coordination; if you need a type that doesn't exist, pause and ask the user.

## Type-by-type guide

### `image`

A single image. Carried at runtime as either:
- A URL string (Supabase storage link, data URL, or external)
- An `ImageObject` `{ url, resolution, metadata }`

Handle examples:
```ts
{ id: 'image', label: 'Image', expectedType: 'image' }                    // input
{ id: 'image_out', label: '', dataType: 'image' }                         // output
```

The `inputs.image` value at runtime is a string URL (the orchestrator's `getPrimaryInputValue` extracts the URL from the upstream's `result_data`).

### `image_array`

Multiple images, e.g., from a `media_input` upload with several files, or from a generative model that produces multiple variations.

Handle example:
```ts
{ id: 'images_out', label: 'Images', dataType: 'image_array' }            // output
```

For inputs that should accept an array of images, also set `is_array: true`:
```ts
{ id: 'images', label: 'Images', expectedType: 'image_array', is_array: true }
```

### `video`, `audio`, `3d`

Same shape as `image` — URL pointing at the asset (mp4/webm/wav/glb/etc.). The Supabase storage handles arbitrary blobs; only the format inside changes.

`detectMediaTypeFromUrl()` in `lib/workflow/result-format.ts` distinguishes by file extension.

### `text`

Plain string. Handle example:
```ts
{ id: 'text_out', label: 'Prompt', dataType: 'text' }
```

The runtime delivers `inputs.text` as a string.

### `prompt`

Currently functionally similar to `text`, but reserved for the chat brain's prompt-handling logic. Use for a node whose semantic role is specifically "this is a prompt for an AI model" (vs. arbitrary text).

In practice, `text` is the safer default unless the use case specifically wants the prompt-routing behavior.

### `json`

Structured object/array. Used for data that doesn't fit any media category — e.g., an OCR result `{ text, bounding_boxes }`, a histogram, a transcript with timestamps, etc.

Use when no single primitive type fits and you don't want to lose structure.

### `any`

Type system escape hatch. Accepts whatever the upstream produces. Use sparingly — type compatibility checks in the canvas (when connecting handles) become permissive.

Currently used by `ai_generator`'s output and trigger handles, since the model output type isn't known at handle-declaration time (it's read from `ai_models.outputs_schema` at runtime).

## Handle declaration

In `definition.ts`, handles look like:

```ts
handles: {
  inputs: [
    { id: 'image', label: 'Image', expectedType: 'image' },
    { id: 'mask', label: 'Mask', expectedType: 'image', isMandatory: false },
  ],
  outputs: [
    { id: 'image_out', label: '', dataType: 'image' },
  ],
},
```

Field reference:

| Field | Type | When to use |
|---|---|---|
| `id` | `string` | The handle key. Edges target this via `targetHandle` for inputs, source it via `sourceHandle` for outputs. Use a short snake_case slug; `image`, `image_out`, `prompt`, `images`, etc. |
| `label` | `string` | Shown in the UI next to the handle. Empty string = no label (used when only one handle). |
| `expectedType` | `NodeDataType \| NodeDataType[]` | Inputs only. The connection-validator checks compatibility. Use an array for multi-type inputs (compositor accepts both `'image'` and `'text'` for layers). |
| `dataType` | `NodeDataType` | Outputs only. The single type the upstream produces. |
| `isMandatory` | `boolean` | Inputs only. If false, the node can run without this input wired. |
| `is_array` | `boolean` | Both. Marks this handle as accepting/producing an array of values. The orchestrator delivers an array for is_array inputs; otherwise it delivers the primary value (first item). |
| `color` | `string` (CSS color) | Optional. Override the default handle dot color. Used for visual distinction in dense graphs. |

## Naming conventions

- Singular for one value: `image`, `prompt`, `mask`.
- Plural with `_array` suffix for multi: `images`, `frames`.
- Output name: append `_out` to the type word, e.g. `image_out`, `text_out`. Empty `label` is fine for the only output.
- Trigger handles (used by ai_generator): `trigger` (input), `trigger_out` (output) with `type: 'trigger'`. These exist for execution chaining — most ephemeral nodes don't need them.
