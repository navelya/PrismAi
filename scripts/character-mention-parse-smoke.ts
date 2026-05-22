/**
 * Verifies extractMentionedCharacters: inline @Name parsing, order-by-
 * appearance, dedup, prefix-collision safety, and email/word-boundary safety.
 * Run: npx tsx scripts/character-mention-parse-smoke.ts
 */
import { extractMentionedCharacters } from '../components/chat/CharacterMentionPicker';

function assert(cond: any, msg: string) {
    if (!cond) { console.error('FAIL:', msg); process.exit(1); }
    console.log('PASS:', msg);
}

const mk = (id: string, name: string): any => ({ id, name, reference_images: [], thumbnail_url: null, description: null, weight: 70, created_at: '', updated_at: '', last_used_at: null });

const alice = mk('a', 'Alice');
const ali = mk('b', 'Ali');
const bob = mk('c', 'Bob');
const aliceSmith = mk('d', 'Alice Smith');
const all = [alice, ali, bob, aliceSmith];

// order by appearance
{
    const r = extractMentionedCharacters('first @Bob then @Alice fight', all).map((c) => c.id);
    assert(JSON.stringify(r) === JSON.stringify(['c', 'a']), `order by appearance (got ${JSON.stringify(r)})`);
}
// dedup
{
    const r = extractMentionedCharacters('@Alice and @Alice again', all).map((c) => c.id);
    assert(JSON.stringify(r) === JSON.stringify(['a']), `dedup (got ${JSON.stringify(r)})`);
}
// prefix collision: "@Alice" must match Alice, not Ali
{
    const r = extractMentionedCharacters('@Alice waves', all).map((c) => c.id);
    assert(r.includes('a') && !r.includes('b'), `@Alice does not match Ali (got ${JSON.stringify(r)})`);
}
// multi-word name
{
    const r = extractMentionedCharacters('look at @Alice Smith here', all).map((c) => c.id);
    assert(r.includes('d'), `multi-word name matched (got ${JSON.stringify(r)})`);
}
// email is not a mention
{
    const r = extractMentionedCharacters('mail me at x@alice.com', all).map((c) => c.id);
    assert(r.length === 0, `email is not a mention (got ${JSON.stringify(r)})`);
}
// @ at start of string
{
    const r = extractMentionedCharacters('@Ali go', all).map((c) => c.id);
    assert(JSON.stringify(r) === JSON.stringify(['b']), `@ at start matches Ali (got ${JSON.stringify(r)})`);
}

console.log('\nAll mention-parse checks passed.');
