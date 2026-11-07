/** Stages the private server, its production dependencies, migrations and native Bun runtime. */
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

const output = resolve(root, 'target/desktop-runtime');

const server = join(output, 'server');

if (!process.versions.bun) throw new Error('Run through bun run desktop:runtime');

await rm(output, { recursive: true, force: true });
await mkdir(server, { recursive: true });

for (const file of ['package.json', 'bun.lock'])
  await copyFile(join(root, file), join(server, file));

// Keep workspace resolution and the lockfile intact while installing only server dependencies.
for (const parent of ['apps', 'packages', 'tooling']) {
  const folders =
    parent === 'tooling'
      ? ['']
      : (await readdir(join(root, parent), { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);

  for (const folder of folders) {
    await copyManifest(join(parent, folder));
  }
}

for (const folder of [
  'apps/server/src',
  'packages/contracts/src',
  'packages/db/src',
  'packages/db/drizzle',
  'packages/integrations/src',
  'packages/localization/src',
  'packages/theme/src'
])
  await cp(join(root, folder), join(server, folder), { recursive: true });

execFileSync(
  process.execPath,
  ['install', '--production', '--frozen-lockfile', '--ignore-scripts', '--filter', '@study/server'],
  {
    cwd: server,
    stdio: 'inherit'
  }
);

// Tauri does not retain workspace symlinks. Bun can load their TypeScript sources
// from real package directories, so materialize each installed workspace before bundling.
const workspaces = join(server, 'node_modules/@study');

for (const entry of await readdir(workspaces, { withFileTypes: true })) {
  if (!entry.isSymbolicLink()) continue;

  const link = join(workspaces, entry.name);
  const source = await realpath(link);

  await rm(link, { recursive: true, force: true });
  await cp(source, link, { recursive: true });
}

await writeFile(join(server, 'main.js'), "await import('./apps/server/src/runtime/main.ts');\n");

const bun = join(output, process.platform === 'win32' ? 'bun.exe' : 'bun');

await copyFile(process.execPath, bun);
await chmod(bun, 0o755);

async function copyManifest(relative: string) {
  try {
    await mkdir(join(server, relative), { recursive: true });
    await copyFile(join(root, relative, 'package.json'), join(server, relative, 'package.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

if (process.platform === 'darwin') {
  const prefix = execFileSync('brew', ['--prefix', 'sqlite'], { encoding: 'utf8' }).trim();

  await copyFile(join(prefix, 'lib/libsqlite3.dylib'), join(output, 'libsqlite3.dylib'));
}
