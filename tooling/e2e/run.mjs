import { once } from 'node:events';
import { createRequire } from 'node:module';
import { spawnOwned, stopOwned } from '../development/process.mjs';
const require = createRequire(import.meta.url);
const child = spawnOwned(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', 'tooling/e2e/playwright.config.ts', ...process.argv.slice(2)], { stdio: 'inherit' });
const stop = () => { void stopOwned(child, 'SIGINT'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try { const [code] = await once(child, 'exit'); process.exitCode = code ?? 1; }
finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await stopOwned(child); }
