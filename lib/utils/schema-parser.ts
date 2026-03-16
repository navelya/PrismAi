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
            let handleType = 'image'; // Default fallback

            if (isPrompt) {
                handleType = 'text';
            } else {
                const searchString = (key + ' ' + (prop.description || '')).toLowerCase();
                if (searchString.includes('video')) handleType = 'video';
                else if (searchString.includes('audio')) handleType = 'audio';
                else if (searchString.includes('image')) handleType = 'image';
            }

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
        // Rule B2: Enum (Select)
        else if (prop.enum) {
            component = 'select';
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
            is_mandatory: isMandatory
        });
    });

    // =========================================================================
    // 2. PROCESS OUTPUTS
    // =========================================================================
    const outputHandles: any[] = [];
    const resolvedOutput = resolveProperty(outputSchemaObj, components);

    // Strict Output Rule: Check for URI format
    const outputIsUri = resolvedOutput.format === 'uri';
    const outputIsArrayUri = resolvedOutput.type === 'array' && resolvedOutput.items?.format === 'uri';

    if (outputIsUri || outputIsArrayUri) {
        outputHandles.push({
            name: 'output',
            api_mapping_key: 'output',
            type: 'image', // Default for Replicate visuals
            is_array: outputIsArrayUri || resolvedOutput.type === 'array',
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
