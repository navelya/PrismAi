/* eslint-disable */
// Manual verification: does ELK produce the desired layout for the
// 3-scenes + Final-Cut topology after edge-remap?
//
// Bug being investigated: layoutTopLevel was dropping cross-hierarchy
// edges (a1→c1 where a1 is inside group g1). With no edges, ELK packs
// the groups + compositor as disconnected components in a horizontal
// row. The fix is to remap each edge endpoint to its top-level parent
// group, so ELK sees g1→c1, g2→c1, g3→c1.
//
// This script reproduces both the buggy (no edges) and the fixed
// (remapped edges) cases against real elkjs and prints positions so we
// can confirm the topology drives the layout before touching prod code.
//
// Run: node scripts/test-elk-topology.js

const ELK = require('elkjs/lib/elk.bundled.js');

const elk = new ELK();

const ELK_LAYERED_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.spacing.componentComponent': '80',
    'elk.separateConnectedComponents': 'true',
};

// Group sizes are what Pass 1 (interior layout) would compute for each
// scene: prompt (185×100) + 120 layer gap + ai_generator (210×380) +
// 24+24 side padding, 56+24 vertical padding.
const SCENE_W = 24 + 185 + 120 + 210 + 24;  // 563
const SCENE_H = 380 + 56 + 24;              // 460
const FINAL_W = 210;
const FINAL_H = 280;

async function run(label, graph) {
    const out = await elk.layout(graph);
    console.log(`\n=== ${label} ===`);
    for (const c of out.children ?? []) {
        console.log(`  ${c.id.padEnd(4)}  x=${String(Math.round(c.x)).padStart(5)}  y=${String(Math.round(c.y)).padStart(5)}  w=${c.width}  h=${c.height}`);
    }
}

async function main() {
    const children = [
        { id: 'g1', width: SCENE_W, height: SCENE_H },
        { id: 'g2', width: SCENE_W, height: SCENE_H },
        { id: 'g3', width: SCENE_W, height: SCENE_H },
        { id: 'c1', width: FINAL_W, height: FINAL_H },
    ];

    // Buggy case: no edges. Reproduces the current behavior.
    await run('Buggy (no edges)', {
        id: 'root',
        layoutOptions: ELK_LAYERED_OPTIONS,
        children,
        edges: [],
    });

    // Fixed case: edges remapped to parent groups.
    await run('Fixed (remapped edges g1→c1, g2→c1, g3→c1)', {
        id: 'root',
        layoutOptions: ELK_LAYERED_OPTIONS,
        children,
        edges: [
            { id: 'e1', sources: ['g1'], targets: ['c1'] },
            { id: 'e2', sources: ['g2'], targets: ['c1'] },
            { id: 'e3', sources: ['g3'], targets: ['c1'] },
        ],
    });

    // Also test the simple "image of dog" case for regression.
    await run('Simple chain (p1 → a1)', {
        id: 'root',
        layoutOptions: ELK_LAYERED_OPTIONS,
        children: [
            { id: 'p1', width: 185, height: 100 },
            { id: 'a1', width: 210, height: 380 },
        ],
        edges: [{ id: 'e1', sources: ['p1'], targets: ['a1'] }],
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
