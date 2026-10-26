import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freePort, spawnOwned, stopOwned, waitReady } from './process.mjs';

const root = new URL('../..', import.meta.url);
export function frontendArguments(input) {
  let production = false;
  let port = 5173;
  let portGiven = false;
  for (let index = 0; index < input.length; index++) {
    if (input[index] === '--production' && !production) production = true;
    else if (input[index] === '--port' && !portGiven) { portGiven = true; port = Number(input[++index]); }
    else throw new Error('Usage: frontend.mjs [--port PORT] [--production]');
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid frontend port');
  return { port, production };
}

/** Persistent web and native runs share the same reset-data exclusion; fixtures never lock it. */
export function bridgeCommand(args, fixtureOnly) {
  if (fixtureOnly) return ['cargo', args];
  return ['python3', ['tooling/development/with-data-lock.py', fileURLToPath(new URL('../../target/desktop/data.lock', import.meta.url)), 'cargo', ...args]];
}

/** Own the bridge and the production UI; E2E gets a stable production build, dev gets HMR. */
export async function frontend({ port, production }) {
  const bridgePort = await freePort();
  const env = { ...process.env, XDG_DATA_HOME: fileURLToPath(new URL('../../target/dev-data', import.meta.url)), STUDY_WEB_BRIDGE_URL: `http://127.0.0.1:${bridgePort}` };
  const bridgeArgs = ['run', '--locked', '-p', 'study-web-bridge', '--', '--port', String(bridgePort), '--origin', `http://127.0.0.1:${port}`, ...(process.env.STUDY_FIXTURE_ONLY === '1' ? ['--fixture-only'] : [])];
  const bridge = spawnOwned(...bridgeCommand(bridgeArgs, process.env.STUDY_FIXTURE_ONLY === '1'), { cwd: root, env, stdio: 'inherit' });
  let vite, build, output;
  let stopping = false;
  const shutdown = () => { stopping = true; void stopOwned(build); void stopOwned(vite); void stopOwned(bridge); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  bridge.once('exit', shutdown);
  try {
    await waitReady(bridge, `${env.STUDY_WEB_BRIDGE_URL}/__study/health`, 600_000);
    if (stopping) return 1;
    const require = createRequire(import.meta.url);
    const cli = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
    if (production) {
      const arena = fileURLToPath(new URL('../../target/e2e', import.meta.url));
      await mkdir(arena, { recursive: true });
      output = await mkdtemp(join(arena, 'frontend-'));
      build = spawnOwned(process.execPath, [cli, 'build', '--config', 'vite.config.ts', '--outDir', output], { cwd: root, env, stdio: 'inherit' });
      const [code] = await once(build, 'exit');
      if (code !== 0 || stopping) throw new Error('Production frontend build failed');
    }
    vite = spawnOwned(process.execPath, [cli, ...(production ? ['preview', '--outDir', output] : []), '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, env, stdio: 'inherit' });
    const [code] = await once(vite, 'exit');
    return stopping ? 1 : (code ?? 1);
  } finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    bridge.off('exit', shutdown);
    await stopOwned(build);
    await stopOwned(vite);
    await stopOwned(bridge);
    if (output) await rm(output, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await frontend(frontendArguments(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
