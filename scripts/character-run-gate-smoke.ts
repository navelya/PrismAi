/**
 * Repro for: pressing Run on an ai_generator fed by a `character` node is a
 * silent no-op. Root cause: `deriveEnvelopeFromConfig` (the source-node
 * seeder used by reseedSourceNodeOutputs) doesn't recognize `character`, so
 * the character node never enters completedNodeIds and validateExecution
 * fires `no-upstream-data` on the character→generator edge — which
 * commitExecution treats as a blocking error (silently, in solo mode).
 *
 * Run: npx tsx scripts/character-run-gate-smoke.ts
 */
import { validateExecution } from '../lib/workflow/validate-execution';
import { sharedRegistry } from '../lib/nodes/core/shared-registry';
import { deriveEnvelopeFromConfig } from '../lib/hooks/use-resolved-node-value';

function assert(cond: any, msg: string) {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('PASS:', msg);
}

// 1) deriveEnvelopeFromConfig must treat a character like a source node
//    (its reference images live in config, no execution needed).
{
    const env = deriveEnvelopeFromConfig('character', {
        characterId: 'c1',
        name: 'Alice',
        referenceImages: ['https://example.com/alice.jpg'],
    });
    assert(env != null, 'deriveEnvelopeFromConfig returns an envelope for character');
    assert(env && env.type === 'image', 'character envelope is type image');
    assert(
        env && Array.isArray(env.data) && env.data.length === 1 && env.data[0]?.url === 'https://example.com/alice.jpg',
        'character envelope carries the reference image url',
    );
}

// 2) End-to-end: solo run on a generator fed by prompt + character. Seed
//    source nodes exactly like reseedSourceNodeOutputs does (via
//    deriveEnvelopeFromConfig). The character edge must NOT fire
//    no-upstream-data once the character is recognized as a source node.
{
    const wf = {
        name: 'char-gen',
        nodes: [
            { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'Prompt', config: { text: 'a crowd' } } },
            { id: 'c1', type: 'character', position: { x: 0, y: 200 }, data: { label: 'Alice', config: { characterId: 'x', name: 'Alice', referenceImages: ['https://example.com/alice.jpg'] } } },
            { id: 'g1', type: 'ai_generator', position: { x: 300, y: 100 }, data: { label: 'Flux', config: { model_id: 7 } } },
        ],
        edges: [
            { id: 'e1', source: 'p1', target: 'g1', sourceHandle: 'prompt_out', targetHandle: 'prompt' },
            { id: 'e2', source: 'c1', target: 'g1', sourceHandle: 'character_out', targetHandle: 'image' },
        ],
    } as any;

    const models = [
        {
            id: 7,
            inputs_schema: {
                handles: [
                    { api_mapping_key: 'prompt', name: 'prompt', type: 'text', is_mandatory: false, is_visible: true, is_array: false },
                    { api_mapping_key: 'image', name: 'image', type: 'image', is_mandatory: false, is_visible: true, is_array: false },
                ],
            },
            outputs_schema: { handles: [{ api_mapping_key: 'output', name: 'output', type: 'image', is_visible: true, is_array: false }] },
        },
    ];

    // Mirror reseedSourceNodeOutputs + commitExecution's completedNodeIds build.
    const completedNodeIds = new Set<string>();
    for (const n of wf.nodes) {
        if (deriveEnvelopeFromConfig(n.type, n.data?.config) != null) completedNodeIds.add(n.id);
    }

    const errs = validateExecution({
        workflow: wf,
        runMode: 'solo',
        targetNodeId: 'g1',
        completedNodeIds,
        sharedRegistry,
        models: models as any,
    });

    const noUpstream = errs.filter((e) => e.kind === 'no-upstream-data');
    assert(
        noUpstream.length === 0,
        `solo run on generator fed by character emits no no-upstream-data (got: ${JSON.stringify(noUpstream)})`,
    );
}

console.log('\nAll character run-gate checks passed.');
