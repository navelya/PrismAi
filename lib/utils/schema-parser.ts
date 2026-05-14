/**
 * Utility to parse Replicate OpenAPI schemas into Prism's internal format
 * Strictly adheres to immutable classification rules and dereferencing.
 */

export function formatDisplayName(name: string): string {
    return name
        .split(/[_-]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Property keys that, when seen on a numeric control, are auto-flagged as
 * cost multipliers. Mirrors scripts/verify-multiplier-autodetect.mjs.
 */
const MULTIPLIER_KEY_REGEX = /^(duration|num_frames|frames|length|seconds|num_seconds)$/i;

/**
 * Parses icon names: 
 * - image-upscale -> ImageUpscaleIcon
 * - Boxes -> Boxes (no touch if no dash)
 */
export function parseIconName(name: string): string {
    if (!name) return 'Boxes';
    if (!name.includes('Icon')) {
        return name
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('') + 'Icon';
    }
    return name;
}

/**
 * Recursively resolves $ref and allOf within a property to ensure flat evaluation.
 */
function resolveProperty(prop: any, components: any): any {
    if (!prop) return {};

    let resolved = { ...prop };

    // 1. Resolve $ref
    if (resolved.$ref) {
        const refName = resolved.$ref.split('/').pop();
        const refSchema = components?.schemas?.[refName] || {};
        resolved = { ...resolved, ...refSchema };
        delete resolved.$ref;
    }

    // 2. Resolve allOf (Merge components)
    if (resolved.allOf && Array.isArray(resolved.allOf)) {
        let merged = { ...resolved };
        resolved.allOf.forEach((sub: any) => {
            const resolvedSub = resolveProperty(sub, components);
            merged = { ...merged, ...resolvedSub };
        });
        delete merged.allOf;
        resolved = merged;
    }

    return resolved;
}

function getResolvedVariants(prop: any, components: any): any[] {
    const resolved = resolveProperty(prop, components);

    if (Array.isArray(resolved.oneOf)) {
        return resolved.oneOf.map((item: any) => resolveProperty(item, components));
    }
    if (Array.isArray(resolved.anyOf)) {
        return resolved.anyOf.map((item: any) => resolveProperty(item, components));
    }

    return [resolved];
}

function inferWireType(key: string, prop: any): 'image' | 'video' | 'audio' | '3d' | 'text' | 'json' {
    const search = [
        key,
        prop?.title,
        prop?.description,
        prop?.format,
        prop?.items?.format,
        prop?.contentMediaType,
        prop?.items?.contentMediaType,
        prop?.['x-cog-array-type'],
        prop?.['x-cog-output-type'],
        prop?.items?.['x-cog-array-type'],
        prop?.items?.['x-cog-output-type'],
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    const hasImageHint =
        search.includes('image') ||
        search.includes('photo') ||
        search.includes('picture') ||
        search.includes('png') ||
        search.includes('jpg') ||
        search.includes('jpeg') ||
        search.includes('webp');
    const hasVideoHint =
        search.includes('video') ||
        search.includes('mp4') ||
        search.includes('mov') ||
        search.includes('webm') ||
        search.includes('gif');
    const hasAudioHint =
        search.includes('audio') ||
        search.includes('sound') ||
        search.includes('music') ||
        search.includes('mp3') ||
        search.includes('wav') ||
        search.includes('ogg');
    const hasTextHint =
        search.includes('text') ||
        search.includes('prompt') ||
        search.includes('caption') ||
        search.includes('transcript');
    const has3dHint =
        search.includes('3d') ||
        search.includes('model') ||
        search.includes('mesh') ||
        search.includes('glb') ||
        search.includes('gltf') ||
        search.includes('obj') ||
        search.includes('fbx') ||
        search.includes('stl');
    const hasJsonHint =
        search.includes('json') ||
        search.includes('object') ||
        search.includes('schema') ||
        prop?.type === 'object' ||
        prop?.type === 'array';
    const isUri =
        (prop?.type === 'string' && prop?.format === 'uri') ||
        (prop?.type === 'array' && prop?.items?.format === 'uri');

    if (hasVideoHint) return 'video';
    if (hasAudioHint) return 'audio';
    if (has3dHint) return '3d';
    if (hasImageHint) return 'image';

    // Replicate files are commonly represented as string + uri.
    // Default to image when no concrete media hint exists.
    if (isUri) {
        return 'image';
    }

    if (prop?.type === 'string' || hasTextHint) return 'text';
    if (hasJsonHint) return 'json';
    return 'json';
}

export function parseReplicateSchema(schema: any) {
    const components = schema?.components || {};
    const inputSchemaObj = components.schemas?.Input || {};
    const inputProperties = inputSchemaObj.properties || {};
    const inputRequired = inputSchemaObj.required || [];
    const outputSchemaObj = components.schemas?.Output || {};

    const handles: any[] = [];
    const controls: any[] = [];

    // =========================================================================
    // 1. PROCESS INPUTS
    // =========================================================================
    Object.entries(inputProperties).forEach(([key, rawProp]: [string, any]) => {
        const prop = resolveProperty(rawProp, components);
        const isMandatory = inputRequired.includes(key);
        const isPrompt = key.toLowerCase().includes('prompt');

        // ---------------------------------------------------------------------
        // PRECEDENCE A: INPUT WIRES (HANDLES)
        // ---------------------------------------------------------------------

        // Rule A1: URI format
        const isUri = prop.format === 'uri';
        // Rule A2: Array of URIs
        const isArrayUri = prop.type === 'array' && prop.items?.format === 'uri';
        // Rule A3: Prompt keyword

        if (isUri || isArrayUri || isPrompt) {
            const handleType = isPrompt ? 'text' : inferWireType(key, prop);

            handles.push({
                name: prop.title || formatDisplayName(key),
                api_mapping_key: key,
                type: handleType,
                is_array: prop.type === 'array' || isArrayUri,
                is_mandatory: isMandatory,
                is_visible: true
            });
            return; // Strict Precedence: If it's a wire, it's not a control.
        }

        // ---------------------------------------------------------------------
        // PRECEDENCE B: CONTROLS (UI PROPERTIES)
        // ---------------------------------------------------------------------

        let component = 'text_input';
        let defaultValue = prop.default;

        // Rule B1: Array of non-URI strings
        if (prop.type === 'array' && prop.items?.type === 'string') {
            component = 'text_input';
            defaultValue = defaultValue ?? '';
        }
        // Rule B2: Enum (Select). Aspect-ratio enums get the dedicated visual
        // picker; Replicate uses string values like "16:9" and "match_input_image"
        // either way, so the wire payload is identical.
        else if (prop.enum) {
            component = /aspect[_\s-]?ratio|^aspect$/i.test(key) ? 'aspect_ratio' : 'select';
            defaultValue = defaultValue ?? prop.enum[0];
        }
        // Rule B3: Boolean
        else if (prop.type === 'boolean') {
            component = 'checkbox';
            defaultValue = defaultValue ?? false;
        }
        // Rule B4: Numbers & Integers
        else if (prop.type === 'number' || prop.type === 'integer') {
            if (prop.maximum !== undefined) {
                component = 'slider';
            } else {
                component = 'number_input';
            }
            defaultValue = defaultValue ?? prop.minimum ?? 0;
        }
        // Rule B5: Generic String
        else if (prop.type === 'string') {
            component = 'text_input';
            defaultValue = defaultValue ?? '';
        } else {
            // Ultimate fallback
            defaultValue = defaultValue ?? '';
        }

        const isMultiplierKey = MULTIPLIER_KEY_REGEX.test(key);
        const isNumeric = prop.type === 'number' || prop.type === 'integer';

        controls.push({
            api_mapping_key: key,
            type: prop.type === 'integer' ? 'number' : (prop.type || 'string'),
            component,
            default_value: defaultValue,
            is_visible: true,
            label: prop.title || formatDisplayName(key),
            options: prop.enum,
            min: prop.minimum,
            max: prop.maximum,
            step: prop.type === 'integer' ? 1 : 0.01,
            is_mandatory: isMandatory,
            ...(isMultiplierKey && isNumeric ? { is_cost_multiplier: true } : {}),
        });
    });

    // =========================================================================
    // 2. PROCESS OUTPUTS
    // =========================================================================
    const outputHandles: any[] = [];
    const addOrMergeOutputHandle = (next: any) => {
        const existing = outputHandles.find(h => h.api_mapping_key === next.api_mapping_key);
        if (!existing) {
            outputHandles.push(next);
            return;
        }

        existing.is_array = existing.is_array || next.is_array;
        if (existing.type !== next.type) existing.type = 'json';
        if (!existing.name && next.name) existing.name = next.name;
    };

    const outputVariants = getResolvedVariants(outputSchemaObj, components);

    outputVariants.forEach((variant) => {
        const resolvedVariant = resolveProperty(variant, components);
        const topLevelIsArray = resolvedVariant.type === 'array';
        const topLevelSchema = topLevelIsArray
            ? resolveProperty(resolvedVariant.items, components)
            : resolvedVariant;

        const leafVariants = getResolvedVariants(topLevelSchema, components);

        leafVariants.forEach((leafVariant) => {
            // Object outputs can expose named properties (e.g. text + file)
            if (leafVariant.type === 'object' && leafVariant.properties) {
                Object.entries(leafVariant.properties).forEach(([key, rawProp]: [string, any]) => {
                    const resolvedLeafProp = resolveProperty(rawProp, components);
                    const propIsArray = resolvedLeafProp.type === 'array';
                    const propValueSchema = propIsArray
                        ? resolveProperty(resolvedLeafProp.items, components)
                        : resolvedLeafProp;

                    addOrMergeOutputHandle({
                        name: resolvedLeafProp.title || formatDisplayName(key),
                        api_mapping_key: key,
                        type: inferWireType(key, propValueSchema),
                        is_array: topLevelIsArray || propIsArray,
                        is_visible: true
                    });
                });
                return;
            }

            addOrMergeOutputHandle({
                name: 'output',
                api_mapping_key: 'output',
                type: inferWireType('output', leafVariant),
                is_array: topLevelIsArray,
                is_visible: true
            });
        });
    });

    // Fallback: if schema exists but we couldn't infer details, still expose a generic output.
    if (
        outputHandles.length === 0 &&
        outputSchemaObj &&
        typeof outputSchemaObj === 'object' &&
        Object.keys(outputSchemaObj).length > 0
    ) {
        outputHandles.push({
            name: 'output',
            api_mapping_key: 'output',
            type: 'json',
            is_array: false,
            is_visible: true
        });
    }

    return {
        inputs: {
            handles,
            controls
        },
        outputs: {
            handles: outputHandles
        }
    };
}
