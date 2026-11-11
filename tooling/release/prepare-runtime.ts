/** Stages the private server, its production dependencies, migrations and native Bun runtime. */
import { BunFileSystem, BunPath } from '@effect/platform-bun';
import { Effect, FileSystem, Path } from 'effect';

const { join, resolve } = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

const fs = await Effect.runPromise(Effect.provide(FileSystem.FileSystem, BunFileSystem.layer));

const root = Bun.fileURLToPath(new URL('../../', import.meta.url));

const output = resolve(root, 'target/desktop-runtime');

const server = join(output, 'server');

if (!process.versions.bun) throw new Error('Run through bun run desktop:runtime');

await Effect.runPromise(fs.remove(output, { recursive: true, force: true }));
await Effect.runPromise(fs.makeDirectory(server, { recursive: true }));

for (const file of ['package.json', 'bun.lock'])
  await Effect.runPromise(fs.copyFile(join(root, file), join(server, file)));

// Keep workspace resolution and the lockfile intact while installing only server dependencies.
for (const parent of ['apps', 'packages', 'tooling']) {
  const folders =
    parent === 'tooling' ? [''] : await Effect.runPromise(fs.readDirectory(join(root, parent)));

  for (const folder of folders) {
    if (
      parent !== 'tooling' &&
      (await Effect.runPromise(fs.lstat(join(root, parent, folder)))).type !== 'Directory'
    )
      continue;

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
  await Effect.runPromise(fs.copy(join(root, folder), join(server, folder)));

const install = Bun.spawnSync(
  [
    process.execPath,
    'install',
    '--production',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--filter',
    '@study/server',
    ...(process.platform === 'linux' ? ['--libc', 'glibc'] : [])
  ],
  { cwd: server, stdio: ['inherit', 'inherit', 'inherit'] }
);

if (install.exitCode !== 0) throw new Error(`Runtime installation failed: ${install.exitCode}`);

// Tauri does not retain workspace symlinks. Bun can load their TypeScript sources
// from real package directories, so materialize each installed workspace before bundling.
const workspaces = join(server, 'node_modules/@study');

for (const entry of await Effect.runPromise(fs.readDirectory(workspaces))) {
  const link = join(workspaces, entry);

  if ((await Effect.runPromise(fs.lstat(link))).type !== 'SymbolicLink') continue;

  const source = await Effect.runPromise(fs.realPath(link));

  await Effect.runPromise(fs.remove(link, { recursive: true, force: true }));
  await Effect.runPromise(fs.copy(source, link));
}

await Bun.write(join(server, 'main.js'), "await import('./apps/server/src/runtime/main.ts');\n");

const bun = join(output, process.platform === 'win32' ? 'bun.exe' : 'bun');

await Effect.runPromise(fs.copyFile(process.execPath, bun));
await Effect.runPromise(fs.chmod(bun, 0o755));

async function copyManifest(relative: string) {
  try {
    await Effect.runPromise(fs.makeDirectory(join(server, relative), { recursive: true }));
    await Effect.runPromise(
      fs.copyFile(join(root, relative, 'package.json'), join(server, relative, 'package.json'))
    );
  } catch (error) {
    if (await Bun.file(join(root, relative, 'package.json')).exists()) throw error;
  }
}

if (process.platform === 'darwin') {
  const brew = Bun.spawnSync(['brew', '--prefix', 'sqlite']);

  if (brew.exitCode !== 0) throw new Error('Cannot find Homebrew SQLite');

  const prefix = brew.stdout.toString().trim();

  await Effect.runPromise(
    fs.copyFile(join(prefix, 'lib/libsqlite3.dylib'), join(output, 'libsqlite3.dylib'))
  );
}
