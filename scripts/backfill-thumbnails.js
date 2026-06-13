/**
 * One-time backfill of baked asset thumbnails.
 *
 * Walks every completed image/video result in `node_results` and, for each
 * result URL that lives in the `chat-assets` bucket, ensures a sibling
 * `.thumb.webp` thumbnail exists — generating + uploading it when missing.
 * Mirrors the runtime path in lib/workflow/thumbnail.ts (image → Sharp resize,
 * video → ffmpeg frame 0 → Sharp), reimplemented here in plain JS because
 * scripts/ runs outside the Next build and can't import the TS module/alias.
 *
 * Idempotent + resumable: existing thumbnails are skipped (HEAD check), so a
 * second run only fills gaps. Safe to re-run after a crash.
 *
 * Usage: node scripts/backfill-thumbnails.js
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promises: fsp } = require('fs');

// Lightweight .env.local loader (this repo does not depend on dotenv).
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const BUCKET = 'chat-assets';
const OBJECT_PREFIX = `/storage/v1/object/public/${BUCKET}/`;
const THUMB_MAX_DIM = 512;
const THUMB_QUALITY = 70;
const PAGE_SIZE = 1000;
const CONCURRENCY = 3; // video downloads are large — keep memory bounded

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ── thumbnail generation (parity with lib/workflow/thumbnail.ts) ────────────
function encodeImageThumb(buffer) {
  return sharp(buffer)
    .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
}

async function encodeVideoPoster(buffer) {
  const ffmpeg = require('fluent-ffmpeg');
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  ffmpeg.setFfmpegPath(ffmpegInstaller.path);

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'thumb-bf-'));
  const inputPath = path.join(tmpDir, 'in');
  const framePath = path.join(tmpDir, 'frame.png');
  try {
    await fsp.writeFile(inputPath, buffer);
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(0)
        .outputOptions(['-frames:v', '1'])
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(framePath);
    });
    const frame = await fsp.readFile(framePath);
    return encodeImageThumb(frame);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── path helpers (parity with bakedThumbUrl / toThumbStoragePath) ───────────
function toThumbObjectPath(objectPath) {
  return objectPath.replace(/\.[^./]+$/, '') + '.thumb.webp';
}

/** Extract the chat-assets object path from a public URL, or null if not ours. */
function objectPathFromUrl(url) {
  const i = url.indexOf(OBJECT_PREFIX);
  if (i === -1) return null;
  const rest = url.slice(i + OBJECT_PREFIX.length);
  const q = rest.indexOf('?');
  return q === -1 ? rest : rest.slice(0, q);
}

async function thumbExists(thumbObjectPath) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(thumbObjectPath);
  try {
    const res = await fetch(data.publicUrl, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

const stats = { rows: 0, urls: 0, skipped: 0, created: 0, failed: 0 };

async function processUrl(url, resultType) {
  if (typeof url !== 'string' || !url.startsWith('http')) return;
  const objectPath = objectPathFromUrl(url);
  if (!objectPath) return; // not a chat-assets object (external / ephemeral / data:)
  stats.urls++;

  const thumbObjectPath = toThumbObjectPath(objectPath);
  if (await thumbExists(thumbObjectPath)) { stats.skipped++; return; }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const thumb = resultType === 'video'
      ? await encodeVideoPoster(buffer)
      : await encodeImageThumb(buffer);

    const { error } = await supabase.storage.from(BUCKET).upload(thumbObjectPath, thumb, {
      contentType: 'image/webp',
      cacheControl: '3600',
      upsert: true,
    });
    if (error) throw new Error(error.message);
    stats.created++;
    if (stats.created % 25 === 0) console.log(`  …${stats.created} thumbnails created`);
  } catch (err) {
    stats.failed++;
    console.warn(`  ! ${objectPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runPool(tasks) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const t = tasks[cursor++];
      await t();
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log('Backfilling baked thumbnails for image/video results…');
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('node_results')
      .select('id, result_type, result_data')
      .eq('status', 'completed')
      .in('result_type', ['image', 'video'])
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) { console.error('Query failed:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;

    const tasks = [];
    for (const row of data) {
      stats.rows++;
      const values = Array.isArray(row.result_data) ? row.result_data : [];
      for (const url of values) tasks.push(() => processUrl(url, row.result_type));
    }
    await runPool(tasks);

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(
    `Done. rows=${stats.rows} urls=${stats.urls} created=${stats.created} ` +
    `skipped=${stats.skipped} failed=${stats.failed}`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
