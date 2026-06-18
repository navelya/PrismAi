// scripts/apply-migration.js
// Applies a SQL migration file against the live Supabase DB via a direct
// Postgres connection (SUPABASE_DB_URL). Executes the entire file as a single
// query — wrap your migration in BEGIN;/COMMIT; for transactional safety.
//
// Usage: node scripts/apply-migration.js <path/to/migration.sql>

const fs = require('fs');
const path = require('path');

// Lightweight .env.local loader (this repo does not depend on dotenv).
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { Client } = require('pg');

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node scripts/apply-migration.js <path/to/migration.sql>');
  process.exit(1);
}

const sqlPath = path.resolve(sqlFile);
if (!fs.existsSync(sqlPath)) {
  console.error(`File not found: ${sqlPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  try {
    await client.connect();
    console.log(`Applying ${sqlFile} …`);
    await client.query(sql);
    console.log('Migration applied successfully.');
  } catch (err) {
    console.error('Migration FAILED:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
