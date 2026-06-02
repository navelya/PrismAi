import assert from 'node:assert';
import { storageKeyFromPublicUrl } from '../lib/storage/public-url';

const BASE = 'https://abc.supabase.co/storage/v1/object/public/chat-assets/';

// Strips bucket prefix and cache-buster -> bucket-relative key
assert.strictEqual(
  storageKeyFromPublicUrl(`${BASE}user1/sess1/results/nodeA/result_123_0.png?t=999`),
  'user1/sess1/results/nodeA/result_123_0.png',
);

// No cache-buster
assert.strictEqual(
  storageKeyFromPublicUrl(`${BASE}user1/sess1/results/nodeA/result_123_0.png`),
  'user1/sess1/results/nodeA/result_123_0.png',
);

// Percent-encoded segment is decoded
assert.strictEqual(
  storageKeyFromPublicUrl(`${BASE}user1/sess1/results/node%20B/r.png`),
  'user1/sess1/results/node B/r.png',
);

// URL not in the chat-assets bucket (e.g. still replicate-hosted) -> null
assert.strictEqual(
  storageKeyFromPublicUrl('https://replicate.delivery/pbxt/abc/out.png'),
  null,
);

// Marker present but no object key after it -> null (not empty string)
assert.strictEqual(
  storageKeyFromPublicUrl('https://abc.supabase.co/storage/v1/object/public/chat-assets/'),
  null,
);

console.log('OK: storageKeyFromPublicUrl');
