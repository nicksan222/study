/** Stages the private server, its production dependencies, migrations and native Node runtime. */
import { execFileSync } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

const output = resolve(root, 'target/desktop-runtime');

const server = join(output, 'server');

const npm = process.env.npm_execpath;

const workspaceImports: Record<string, string> = {};

if (!npm) throw new Error('Run through npm run desktop:runtime');

await rm(output, { recursive: true, force: true });
await mkdir(server, { recursive: true });

for (const file of ['package.json', 'package-lock.json'])
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
  'packages/localization/src',
  'packages/theme/src'
])
  await cp(join(root, folder), join(server, folder), { recursive: true });

execFileSync(
  process.execPath,
  [
    npm,
    'ci',
    '--omit=dev',
    '--ignore-scripts',
    '--workspace',
    '@study/server',
    '--include-workspace-root=false',
    '--no-audit',
    '--no-fund'
  ],
  {
    cwd: server,
    stdio: 'inherit'
  }
);

// Tauri does not copy npm's workspace symlinks. Resolve canonical exports outside
// node_modules, where Node can strip the workspace's TypeScript sources.
await rm(join(server, 'node_modules/@study'), { recursive: true, force: true });
await writeFile(
  join(server, 'main.js'),
  `import { registerHooks } from 'node:module';
const workspaces = new Map(Object.entries(${JSON.stringify(workspaceImports)}));
registerHooks({ resolve(specifier, context, nextResolve) {
  const source = workspaces.get(specifier);
  return nextResolve(source ? new URL(source, import.meta.url).href : specifier, context);
} });
await import('./apps/server/src/runtime/main.ts');
`
);

const node = join(output, process.platform === 'win32' ? 'node.exe' : 'node');

await copyFile(process.execPath, node);
await chmod(node, 0o755);

async function copyManifest(relative: string) {
  try {
    await mkdir(join(server, relative), { recursive: true });
    await copyFile(join(root, relative, 'package.json'), join(server, relative, 'package.json'));
    const manifest: { name: string; exports?: Record<string, string> } = JSON.parse(
      await readFile(join(root, relative, 'package.json'), 'utf8')
    );

    recordExports(manifest, relative);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function recordExports(
  manifest: { name: string; exports?: Record<string, string> },
  relative: string
) {
  for (const [name, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target !== 'string')
      throw new Error(`Unsupported workspace export: ${manifest.name}`);

    workspaceImports[name === '.' ? manifest.name : manifest.name + name.slice(1)] =
      `./${relative.replaceAll('\\', '/')}/${target}`;
  }
}
