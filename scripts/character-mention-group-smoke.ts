/**
 * Verifies buildMentionResults: own-first ordering, shared grouping, dedup of a
 * character that is both owned and shared, and query filtering across groups.
 * Run: npx tsx scripts/character-mention-group-smoke.ts
 */
import { buildMentionResults } from '../components/chat/CharacterMentionPicker';

function assert(cond: any, msg: string) {
    if (!cond) { console.error('FAIL:', msg); process.exit(1); }
    console.log('PASS:', msg);
}

const mk = (id: string, name: string): any => ({
    id, name, reference_images: [], thumbnail_url: null, description: null,
    weight: 70, created_at: '', updated_at: '', last_used_at: null,
    is_draft: false, is_shared: false,
});

const mine = [mk('m1', 'Alice'), mk('m2', 'Bob')];
const shared = [mk('s1', 'Zara'), mk('s2', 'Quinn')];

// own first, then shared; counts reflect the split
{
    const r = buildMentionResults(mine, shared, '');
    assert(r.ownCount === 2 && r.sharedCount === 2, `counts split (own ${r.ownCount}, shared ${r.sharedCount})`);
    assert(JSON.stringify(r.items.map((c) => c.id)) === JSON.stringify(['m1', 'm2', 's1', 's2']),
        `own-first flat order (got ${JSON.stringify(r.items.map((c) => c.id))})`);
}

// dedup: a character present in BOTH own and shared appears only in own
{
    const dup = mk('m1', 'Alice'); // same id as mine[0]
    const r = buildMentionResults(mine, [dup, ...shared], '');
    const ids = r.items.map((c) => c.id);
    assert(ids.filter((x) => x === 'm1').length === 1, `no duplicate of owned id (got ${JSON.stringify(ids)})`);
    assert(r.sharedCount === 2, `dup excluded from shared count (got ${r.sharedCount})`);
}

// query filters both groups
{
    const r = buildMentionResults(mine, shared, 'a'); // matches Alice (own), Zara (shared)
    const ids = r.items.map((c) => c.id);
    assert(ids.includes('m1') && ids.includes('s1') && !ids.includes('m2') && !ids.includes('s2'),
        `query filters both groups (got ${JSON.stringify(ids)})`);
}

console.log('\nAll mention-group checks passed.');
