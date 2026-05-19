import { NodeSharedDef } from '@/lib/nodes/core/types';
import { AiModel } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';

export interface ResolvedHandle {
    id: string;
    label: string;
    type: string | string[];
    isArray?: boolean;
}

/**
 * Resolve the runtime output kind ('image' | 'video') for a blur node by
 * inspecting whatever media is currently flowing into its `image` input.
 *
 * Why this exists: blur's static output dataType is the broad union
 * ['image','video'] — that's the right wiring contract when nothing is
 * connected. But once a video is wired in, blur emits a video, and trying
 * to wire its output into an image-only consumer would produce a runtime
 * mismatch. This resolver lets the connection validator narrow blur's
 * output type to match the live input so the wire-drop UI rejects
 * incompatible targets.
 *
 * Walks: edge → upstream node → live nodeOutputs (preferred) or saved data
 * fallback → first URL → detectMediaTypeFromUrl. Returns null when no input
 * is wired, or when the kind can't be determined (treat as broad).
 *
 * Recursion-safe via depth limit — defends against cyclic graphs.
 */
function resolveBlurOutputKind(nodeId: string, depth: number = 0): 'image' | 'video' | null {
    if (depth > 8) return null;
    const wf = useAppStore.getState().currentWorkflow;
    if (!wf) return null;

    const inputEdge = wf.edges.find((e) => e.target === nodeId && (e.targetHandle === 'image' || !e.targetHandle));
    if (!inputEdge) return null;

    const upstream = wf.nodes.find((n) => n.id === inputEdge.source);
    if (!upstream) return null;

    // If the upstream is itself a blur, recurse so chained blur nodes carry
    // the narrowed type forward.
    if (upstream.type === 'blur') {
        return resolveBlurOutputKind(upstream.id, depth + 1);
    }

    const liveOutput = useAppStore.getState().nodeOutputs[upstream.id];
    const dataOutput = (upstream.data as any)?.output;
    const cfgImages = (upstream.data as any)?.config?.images;
    const cfgLast = (upstream.data as any)?.config?.last_output;
    const candidate = liveOutput ?? dataOutput ?? cfgImages ?? cfgLast;

    // Envelope shape: {type: 'image'|'video', data: [...]}. Trust the type
    // field over URL detection — it's authoritative for live-stream sources
    // (Compositor's live video output has no URL until the server renders).
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        const t = (candidate as any).type;
        if (t === 'video' || t === 'image') return t;
    }

    const url = extractFirstUrl(candidate);
    if (!url) return null;

    if (url.startsWith('data:video/')) return 'video';
    if (url.startsWith('data:image/')) return 'image';
    const detected = detectMediaTypeFromUrl(url);
    if (detected === 'image' || detected === 'video') return detected;
    return null;
}

function extractFirstUrl(value: any): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value.startsWith('http') || value.startsWith('data:') ? value : null;
    if (Array.isArray(value)) {
        for (const item of value) {
            const u = extractFirstUrl(item);
            if (u) return u;
        }
        return null;
    }
    if (typeof value === 'object') {
        if (typeof value.url === 'string') return value.url;
        if (typeof value.previewUrl === 'string') return value.previewUrl;
        if (value.data !== undefined) return extractFirstUrl(value.data);
        if (value.output !== undefined) return extractFirstUrl(value.output);
    }
    return null;
}

/**
 * Resolve the runtime output kind for a compositor node by inspecting its
 * wired layer inputs. Compositor has a single polymorphic output handle whose
 * static dataType is ['image','video']; the narrowing rule is:
 *   - Any video layer → 'video' (temporal render emits mp4).
 *   - Otherwise any image layer → 'image' (still composite emits raster).
 *   - No wired media (only text, or nothing) → null = broad union applies.
 *
 * Layer edges all target `layers` (or no targetHandle), so we walk every
 * incoming edge that hits that handle.
 */
function resolveCompositorOutputKind(nodeId: string): 'image' | 'video' | null {
    const wf = useAppStore.getState().currentWorkflow;
    if (!wf) return null;

    const layerEdges = wf.edges.filter(
        (e) => e.target === nodeId && (e.targetHandle === 'layers' || !e.targetHandle),
    );
    if (layerEdges.length === 0) return null;

    let sawImage = false;
    for (const edge of layerEdges) {
        const upstream = wf.nodes.find((n) => n.id === edge.source);
        if (!upstream) continue;

        const liveOutput = useAppStore.getState().nodeOutputs[upstream.id];
        const dataOutput = (upstream.data as any)?.output;
        const cfgImages = (upstream.data as any)?.config?.images;
        const cfgLast = (upstream.data as any)?.config?.last_output;
        const candidate = liveOutput ?? dataOutput ?? cfgImages ?? cfgLast;

        // Envelope shape: {type, data}. Trust the type field over URL
        // detection — pull-model graph envelopes are authoritatively video
        // but have no URL until the server renders.
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            const t = (candidate as any).type;
            if (t === 'video') return 'video';
            if (t === 'image') { sawImage = true; continue; }
        }

        const url = extractFirstUrl(candidate);
        if (!url) continue;

        if (url.startsWith('data:video/')) return 'video';
        if (url.startsWith('data:image/')) { sawImage = true; continue; }
        const detected = detectMediaTypeFromUrl(url);
        if (detected === 'video') return 'video';
        if (detected === 'image') sawImage = true;
    }
    return sawImage ? 'image' : null;
}

/**
 * For nodes whose output dataType is dynamic, return the narrowed runtime
 * type — or null to fall back to the static registry dataType. Centralizes
 * the per-node-type carve-outs so the handle-compat helpers stay generic.
 */
function resolveDynamicOutputType(
    node: { type: string; id?: string } | undefined,
    handleId: string | null,
): string | null {
    if (!node || !node.id) return null;
    if (node.type === 'blur') {
        const kind = resolveBlurOutputKind(node.id);
        return kind; // 'image' | 'video' | null
    }
    if (node.type === 'compositor') {
        return resolveCompositorOutputKind(node.id); // 'image' | 'video' | null
    }
    return null;
}

export interface PendingConnection {
    /** Node where the wire originated. */
    nodeId: string;
    /** Handle id on the originating node, or null if none. */
    handleId: string | null;
    /**
     * 'source' = wire dragged from an OUTPUT handle (looking for an INPUT on the new node).
     * 'target' = wire dragged from an INPUT handle (looking for an OUTPUT on the new node).
     */
    handleType: 'source' | 'target';
    /**
     * Data type id (or list of acceptable ids) of the originating handle, taken
     * from the data_types table via the node's schema. Inputs may accept an
     * array of types (e.g. compositor accepts ['image','text']).
     */
    dataType: string | string[];
    isArray?: boolean;
}

interface MenuItemLike {
    id: string;
    item_type: 'header' | 'submenu' | 'node_type' | 'ai_model' | 'static_node' | 'provider';
    action_value: string | null;
    title: string;
}

/**
 * Resolve the input/output handles available on the node a menu item would create.
 *  - static_node → sharedRegistry definition
 *  - ai_model → that model's inputs_schema/outputs_schema rows
 *  - node_type → union of all models tagged with this node_type_id
 */
export function resolveHandlesForMenuItem(
    item: MenuItemLike,
    models: AiModel[],
    sharedRegistry: Record<string, NodeSharedDef<any>>
): { inputs: ResolvedHandle[]; outputs: ResolvedHandle[] } {
    if (item.item_type === 'static_node' && item.action_value) {
        const def = sharedRegistry[item.action_value];
        if (!def) return { inputs: [], outputs: [] };
        return {
            inputs: (def.handles?.inputs || []).map((h: any) => ({
                id: h.id,
                label: h.label,
                type: h.expectedType,
                isArray: h.is_array,
            })),
            outputs: (def.handles?.outputs || []).map((h: any) => ({
                id: h.id,
                label: h.label,
                type: h.dataType,
                isArray: h.is_array,
            })),
        };
    }

    if (item.item_type === 'ai_model' && item.action_value) {
        const modelId = parseInt(item.action_value, 10);
        const model = models.find((m) => m.id === modelId);
        if (!model) return { inputs: [], outputs: [] };
        return {
            inputs: (model.inputs_schema?.handles || [])
                .filter((h) => h.is_visible !== false)
                .map((h) => ({
                    id: h.api_mapping_key || h.name,
                    label: h.name,
                    type: h.type,
                    isArray: h.is_array,
                })),
            outputs: (model.outputs_schema?.handles || [])
                .filter((h) => h.is_visible !== false)
                .map((h) => ({
                    id: h.api_mapping_key || h.name || 'output',
                    label: h.name,
                    type: h.type,
                    isArray: h.is_array,
                })),
        };
    }

    if (item.item_type === 'node_type' && item.action_value) {
        const matchingModels = models.filter((m) => m.node_type_id === item.action_value);
        const inputs: ResolvedHandle[] = [];
        const outputs: ResolvedHandle[] = [];
        const seenInputs = new Set<string>();
        const seenOutputs = new Set<string>();
        matchingModels.forEach((model) => {
            (model.inputs_schema?.handles || [])
                .filter((h) => h.is_visible !== false)
                .forEach((h) => {
                    const key = `${h.api_mapping_key || h.name}|${h.type}`;
                    if (seenInputs.has(key)) return;
                    seenInputs.add(key);
                    inputs.push({
                        id: h.api_mapping_key || h.name,
                        label: h.name,
                        type: h.type,
                        isArray: h.is_array,
                    });
                });
            (model.outputs_schema?.handles || [])
                .filter((h) => h.is_visible !== false)
                .forEach((h) => {
                    const key = `${h.api_mapping_key || h.name || 'output'}|${h.type}`;
                    if (seenOutputs.has(key)) return;
                    seenOutputs.add(key);
                    outputs.push({
                        id: h.api_mapping_key || h.name || 'output',
                        label: h.name,
                        type: h.type,
                        isArray: h.is_array,
                    });
                });
        });
        return { inputs, outputs };
    }

    return { inputs: [], outputs: [] };
}

/**
 * Two handles connect if they share a data-type id, or either side is 'any'.
 * Either side may also be an array of accepted ids (input handles can declare
 * a union, e.g. compositor accepts ['image','text']).
 *
 * Array-typed handles (e.g. `image_array`) are treated as compatible with
 * their base type (`image`) in either direction: an array source feeds a
 * single-image consumer (which picks via `selectedIndex`) and a single-image
 * source feeds an array consumer (a length-1 array). Without this fold the
 * wire-drop menu would filter out almost every node when dragging from a
 * Media Input output.
 */
export function typesAreCompatible(
    sourceType: string | string[],
    targetType: string | string[]
): boolean {
    if (!sourceType || !targetType) return false;
    const sources = Array.isArray(sourceType) ? sourceType : [sourceType];
    const targets = Array.isArray(targetType) ? targetType : [targetType];
    if (sources.includes('any') || targets.includes('any')) return true;

    const stripArray = (t: string) => t.replace(/_array$/, '');
    const sourceBases = sources.map(stripArray);
    const targetBases = targets.map(stripArray);
    return sourceBases.some((s) => targetBases.includes(s));
}

/**
 * True if adding `source → target` to the current edge set would close a
 * directed cycle. Forward DFS from `target` — if we reach `source`, the new
 * edge would loop back. O(V + E); fine for typical workflow sizes.
 *
 * Self-loops are reported as a cycle for convenience; callers can also rely
 * on their own `source === target` early-out if they want a separate code
 * path for that case.
 */
export function wouldCreateCycle(
    sourceId: string,
    targetId: string,
    edges: { source: string; target: string }[],
): boolean {
    if (sourceId === targetId) return true;
    const adj = new Map<string, string[]>();
    for (const e of edges) {
        if (!adj.has(e.source)) adj.set(e.source, []);
        adj.get(e.source)!.push(e.target);
    }
    const stack = [targetId];
    const seen = new Set<string>();
    while (stack.length) {
        const n = stack.pop()!;
        if (n === sourceId) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        const next = adj.get(n);
        if (next) stack.push(...next);
    }
    return false;
}

/**
 * Pick the first handle on the candidate node that the pending wire can connect to.
 * - 'source' wire (originated at an output) → look for a compatible input.
 * - 'target' wire (originated at an input)  → look for a compatible output.
 * Returns null if none of the node's handles are compatible.
 */
export function findCompatibleHandle(
    item: MenuItemLike,
    pending: PendingConnection,
    models: AiModel[],
    sharedRegistry: Record<string, NodeSharedDef<any>>
): ResolvedHandle | null {
    const { inputs, outputs } = resolveHandlesForMenuItem(item, models, sharedRegistry);
    const candidates = pending.handleType === 'source' ? inputs : outputs;
    return candidates.find((h) => typesAreCompatible(pending.dataType, h.type)) || null;
}

/**
 * Find a handle on an already-instantiated node that the pending wire can connect
 * to. Same compatibility rule as findCompatibleHandle, but applied to a concrete
 * node (so for ai_generator we use the resolved model's schema, not a union).
 */
export function findHandleForNode(
    node: { type: string; data?: { config?: any } } | undefined,
    pending: PendingConnection,
    models: AiModel[],
    sharedRegistry: Record<string, NodeSharedDef<any>>
): ResolvedHandle | null {
    if (!node) return null;

    if (node.type === 'ai_generator') {
        const modelId = node.data?.config?.model_id;
        const model = modelId ? models.find((m) => m.id === modelId) : null;
        if (!model) return null;
        const rawHandles =
            pending.handleType === 'source'
                ? model.inputs_schema?.handles || []
                : model.outputs_schema?.handles || [];
        const visible = rawHandles.filter((h) => h.is_visible !== false);
        const match = visible.find((h) => typesAreCompatible(pending.dataType, h.type));
        if (!match) return null;
        return {
            id: match.api_mapping_key || match.name || (pending.handleType === 'source' ? '' : 'output'),
            label: match.name,
            type: match.type,
            isArray: match.is_array,
        };
    }

    const def = sharedRegistry[node.type];
    if (!def) return null;
    const rawHandles =
        pending.handleType === 'source' ? def.handles?.inputs || [] : def.handles?.outputs || [];
    const dynamicOutputType =
        pending.handleType === 'target' ? resolveDynamicOutputType(node as any, null) : null;
    const match = (rawHandles as any[]).find((h) => {
        const t = pending.handleType === 'source'
            ? h.expectedType
            : (dynamicOutputType ?? h.dataType);
        return typesAreCompatible(pending.dataType, t);
    });
    if (!match) return null;
    return {
        id: match.id,
        label: match.label,
        type: pending.handleType === 'source'
            ? match.expectedType
            : (dynamicOutputType ?? match.dataType),
        isArray: match.is_array,
    };
}

/**
 * Resolve the data type of a specific handle on an existing node in the workflow.
 * Used to figure out what the wire being dragged is carrying.
 */
export function getNodeHandleType(
    node: { type: string; data?: { config?: any } } | undefined,
    handleId: string | null,
    handleType: 'source' | 'target',
    models: AiModel[],
    sharedRegistry: Record<string, NodeSharedDef<any>>
): { type: string | string[]; isArray?: boolean } | null {
    if (!node) return null;

    if (node.type === 'ai_generator') {
        const modelId = node.data?.config?.model_id;
        const model = modelId ? models.find((m) => m.id === modelId) : null;
        if (model) {
            const handles =
                handleType === 'source'
                    ? model.outputs_schema?.handles || []
                    : model.inputs_schema?.handles || [];
            const h = handles.find(
                (h) => (h.api_mapping_key || h.name || (handleType === 'source' ? 'output' : '')) === handleId
            );
            if (h) return { type: h.type, isArray: h.is_array };
            // ai_generator with handleId === 'output' but no explicit handle → fall through to default
        }
    }

    const def = sharedRegistry[node.type];
    if (!def) return null;
    const handles = handleType === 'source' ? def.handles?.outputs : def.handles?.inputs;
    const h = (handles as any[])?.find((x) => x.id === handleId) || (handles as any[])?.[0];
    if (!h) return null;
    if (handleType === 'source') {
        const dynamicType = resolveDynamicOutputType(node as any, handleId);
        return {
            type: dynamicType ?? h.dataType,
            isArray: h.is_array,
        };
    }
    return {
        type: h.expectedType,
        isArray: h.is_array,
    };
}

/**
 * Like `findHandleForNode`, but returns ALL handles on the node compatible
 * with the pending wire (not just the first match). Used to drive the
 * "reveal labels for compatible handles" UX while a wire is being dragged.
 */
export function findAllCompatibleHandlesForNode(
    node: { type: string; data?: { config?: any } } | undefined,
    pending: PendingConnection,
    models: AiModel[],
    sharedRegistry: Record<string, NodeSharedDef<any>>
): ResolvedHandle[] {
    if (!node) return [];

    if (node.type === 'ai_generator') {
        const modelId = node.data?.config?.model_id;
        const model = modelId ? models.find((m) => m.id === modelId) : null;
        if (!model) return [];
        const rawHandles =
            pending.handleType === 'source'
                ? model.inputs_schema?.handles || []
                : model.outputs_schema?.handles || [];
        return rawHandles
            .filter((h) => h.is_visible !== false)
            .filter((h) => typesAreCompatible(pending.dataType, h.type))
            .map((h) => ({
                id: h.api_mapping_key || h.name || (pending.handleType === 'source' ? '' : 'output'),
                label: h.name,
                type: h.type,
                isArray: h.is_array,
            }));
    }

    const def = sharedRegistry[node.type];
    if (!def) return [];
    const rawHandles =
        pending.handleType === 'source' ? def.handles?.inputs || [] : def.handles?.outputs || [];
    const dynamicOutputType =
        pending.handleType === 'target' ? resolveDynamicOutputType(node as any, null) : null;
    return (rawHandles as any[])
        .filter((h) => {
            const t = pending.handleType === 'source'
                ? h.expectedType
                : (dynamicOutputType ?? h.dataType);
            return typesAreCompatible(pending.dataType, t);
        })
        .map((h) => ({
            id: h.id,
            label: h.label,
            type: pending.handleType === 'source'
                ? h.expectedType
                : (dynamicOutputType ?? h.dataType),
            isArray: h.is_array,
        }));
}
