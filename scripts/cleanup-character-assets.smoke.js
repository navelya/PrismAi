/**
 * Smoke test for the character-asset cleanup predicate.
 * Run: node scripts/cleanup-character-assets.smoke.js
 */
const assert = require('assert');
const { urlIsCharacterAsset, rowHasCharacterAsset } = require('./cleanup-character-assets');

// URL predicate: character images upload under `{userId}/characters/...`
assert.strictEqual(
  urlIsCharacterAsset('https://x.supabase.co/storage/v1/object/public/chat-assets/uid/characters/123-0-ab.png'),
  true,
);
assert.strictEqual(
  urlIsCharacterAsset('https://x.supabase.co/storage/v1/object/public/outputs/uid/gen/123.png'),
  false,
);
assert.strictEqual(urlIsCharacterAsset(42), false);
assert.strictEqual(urlIsCharacterAsset(null), false);

// Row predicate: only image rows with at least one character-path URL.
assert.strictEqual(
  rowHasCharacterAsset({ result_type: 'image', result_data: ['https://h/chat-assets/u/characters/a.png'] }),
  true,
);
assert.strictEqual(
  rowHasCharacterAsset({ result_type: 'image', result_data: ['https://h/outputs/u/a.png'] }),
  false,
);
assert.strictEqual(
  rowHasCharacterAsset({ result_type: 'video', result_data: ['https://h/chat-assets/u/characters/a.mp4'] }),
  false,
);
assert.strictEqual(rowHasCharacterAsset({ result_type: 'image', result_data: null }), false);

console.log('OK: cleanup-character-assets predicates');
