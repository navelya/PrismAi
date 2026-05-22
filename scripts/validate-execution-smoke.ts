import { validateExecution } from '../lib/workflow/validate-execution';
import { sharedRegistry } from '../lib/nodes/core/shared-registry';

function assert(cond: any, msg: string) {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('PASS:', msg);
}

const baseModels: any[] = [];

// 1) missing-required-input: AI generator with required image input, no edge
{
    const wf = {
        name: 'mri',
        nodes: [
            {
                id: 'gen1',
                type: 'ai_generator',
                position: { x: 0, y: 0 },
                data: { label: 'Gen', config: { model_id: 1 } },
            },
        ],
        edges: [],
    } as any;
    const models = [
        {
            id: 1,
            inputs_schema: {
                handles: [
                    { api_mapping_key: 'image', name: 'image', type: 'image', is_mandatory: true, is_visible: true, is_array: false },
                ],
            },
            outputs_schema: { handles: [{ api_mapping_key: 'output', name: 'output', type: 'image', is_visible: true, is_array: false }] },
        },
    ];
    const errs = validateExecution({
        workflow: wf, runMode: 'all', targetNodeId: null,
        completedNodeIds: new Set(), sharedRegistry, models: models as any,
    });
    assert(errs.length === 1 && errs[0].kind === 'missing-required-input', 'missing-required-input case');
}

// 2) no-upstream-data: solo run on Blur whose image comes from an uncached
// GENERATIVE ancestor. The backend pre-seeds generative ancestors from the DB
// (it does NOT re-run them — see /api/executions/start); with no cached result
// there is genuinely no upstream data, so this must fire. Note the upstream is
// generative on purpose: an *ephemeral* ancestor (prompt/blur/media_input) runs
// for free and must NOT trip this check (see case 6).
{
    const wf = {
        name: 'nud',
        nodes: [
            { id: 'g1', type: 'ai_generator', position: { x: 0, y: 0 }, data: { label: 'Gen', config: { model_id: 9 } } },
            { id: 'b1', type: 'blur', position: { x: 200, y: 0 }, data: { label: 'Blur' } },
        ],
        edges: [{ id: 'e1', source: 'g1', target: 'b1', sourceHandle: 'output', targetHandle: 'image' }],
    } as any;
    const models = [
        {
            id: 9,
            inputs_schema: { handles: [] },
            outputs_schema: { handles: [{ api_mapping_key: 'output', name: 'output', type: 'image', is_visible: true, is_array: false }] },
        },
    ];
    const errs = validateExecution({
        workflow: wf, runMode: 'solo', targetNodeId: 'b1',
        completedNodeIds: new Set(), sharedRegistry, models: models as any,
    });
    assert(errs.some((e) => e.kind === 'no-upstream-data'), 'no-upstream-data fires for uncached generative ancestor');
}

// 3) no-upstream-data does NOT fire for runMode=all (everything will run)
{
    const wf = {
        name: 'all',
        nodes: [
            { id: 'm1', type: 'media_input', position: { x: 0, y: 0 }, data: { label: 'Media' } },
            { id: 'b1', type: 'blur', position: { x: 200, y: 0 }, data: { label: 'Blur' } },
        ],
        edges: [{ id: 'e1', source: 'm1', target: 'b1', sourceHandle: 'images_out', targetHandle: 'image' }],
    } as any;
    const errs = validateExecution({
        workflow: wf, runMode: 'all', targetNodeId: null,
        completedNodeIds: new Set(), sharedRegistry, models: baseModels as any,
    });
    assert(errs.every((e) => e.kind !== 'no-upstream-data'), 'no-upstream-data not fired for runMode=all');
}

// 4) type-mismatch: text -> image
{
    const wf = {
        name: 'tm',
        nodes: [
            { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'Prompt', config: { text: 'hi' } } },
            { id: 'b1', type: 'blur', position: { x: 200, y: 0 }, data: { label: 'Blur' } },
        ],
        edges: [{ id: 'e1', source: 'p1', target: 'b1', sourceHandle: 'text_out', targetHandle: 'image' }],
    } as any;
    const errs = validateExecution({
        workflow: wf, runMode: 'all', targetNodeId: null,
        completedNodeIds: new Set(), sharedRegistry, models: baseModels as any,
    });
    assert(errs.some((e) => e.kind === 'type-mismatch'), 'type-mismatch case');
}

// 5) chain: running from a Prompt forward should mark its descendants as
// executing, so a downstream AI generator whose prompt input is wired but
// uncached should NOT produce no-upstream-data.
{
    const wf = {
        name: 'chain',
        nodes: [
            { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'Prompt', config: { text: 'hi' } } },
            {
                id: 'gen1',
                type: 'ai_generator',
                position: { x: 200, y: 0 },
                data: { label: 'Gen', config: { model_id: 2 } },
            },
        ],
        edges: [{ id: 'e1', source: 'p1', target: 'gen1', sourceHandle: 'text_out', targetHandle: 'prompt' }],
    } as any;
    const models = [
        {
            id: 2,
            inputs_schema: {
                handles: [
                    { api_mapping_key: 'prompt', name: 'prompt', type: 'text', is_mandatory: true, is_visible: true, is_array: false },
                ],
            },
            outputs_schema: { handles: [{ api_mapping_key: 'output', name: 'output', type: 'image', is_visible: true, is_array: false }] },
        },
    ];
    const errs = validateExecution({
        workflow: wf, runMode: 'chain', targetNodeId: 'p1',
        completedNodeIds: new Set(), sharedRegistry, models: models as any,
    });
    assert(errs.every((e) => e.kind !== 'no-upstream-data'), 'chain BFS includes descendants — no-upstream-data not fired');
}

// 6) solo run on an ai_generator whose prompt is wired from an uncached prompt
// node must NOT fire no-upstream-data. The prompt is an ephemeral ancestor that
// the backend auto-includes and runs for free (see /api/executions/start STEP 3),
// so flagging it would falsely block the most basic "text → image" run.
{
    const wf = {
        name: 'solo-ephemeral-ancestor',
        nodes: [
            { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'Prompt', config: { text: 'a cat' } } },
            { id: 'gen1', type: 'ai_generator', position: { x: 200, y: 0 }, data: { label: 'Gen', config: { model_id: 6 } } },
        ],
        edges: [{ id: 'e1', source: 'p1', target: 'gen1', sourceHandle: 'text_out', targetHandle: 'prompt' }],
    } as any;
    const models = [
        {
            id: 6,
            inputs_schema: {
                handles: [
                    { api_mapping_key: 'prompt', name: 'prompt', type: 'text', is_mandatory: true, is_visible: true, is_array: false },
                ],
            },
            outputs_schema: { handles: [{ api_mapping_key: 'output', name: 'output', type: 'image', is_visible: true, is_array: false }] },
        },
    ];
    const errs = validateExecution({
        workflow: wf, runMode: 'solo', targetNodeId: 'gen1',
        completedNodeIds: new Set(), sharedRegistry, models: models as any,
    });
    assert(errs.every((e) => e.kind !== 'no-upstream-data'), 'solo run auto-includes ephemeral ancestors — no-upstream-data not fired for wired prompt');
}

console.log('\nAll smoke cases passed.');
