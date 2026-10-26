import { resolve } from 'node:path';
import { once } from 'node:events';
import { spawnOwned, stopOwned } from '../development/process.mjs';
const [kind = 'apps/landing/public/demo.gif', ...filter] = process.argv.slice(2);
const env = { ...process.env, STUDY_E2E_PORT: process.env.STUDY_E2E_PORT ?? '1424', STUDY_E2E_ARTIFACTS: resolve('target/captures'), STUDY_CAPTURE: kind === 'docs' ? 'docs' : 'demo', STUDY_CAPTURE_FILTER: filter.join(' '), STUDY_DEMO_OUTPUT: kind === 'docs' ? '' : kind };
const child = spawnOwned(process.execPath, ['tooling/e2e/run.mjs', '--pass-with-no-tests', '--grep', kind === 'docs' ? '@capture' : '@demo'], { env, stdio: 'inherit' });
const stop = () => { void stopOwned(child, 'SIGINT'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try { const [code] = await once(child, 'exit'); process.exitCode = code ?? 1; }
finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await stopOwned(child); }
