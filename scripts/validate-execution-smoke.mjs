import { execSync } from 'node:child_process';
execSync('npx tsx scripts/validate-execution-smoke.ts', { stdio: 'inherit' });
