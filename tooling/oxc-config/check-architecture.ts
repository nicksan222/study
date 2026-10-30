import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { dependencyIdentity, workspaceArchitecture } from './workspace-architecture.ts';
import type { WorkspaceManifest } from './workspace-architecture.ts';

const root = new URL('../../', import.meta.url);

const manifests: Record<string, WorkspaceManifest> = {};

for (const directory of ['apps', 'packages']) {
  for (const entry of readdirSync(new URL(`${directory}/`, root), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const path = `${directory}/${entry.name}`;
    const manifest = new URL(`${path}/package.json`, root);

    if (existsSync(manifest)) manifests[path] = JSON.parse(readFileSync(manifest, 'utf8'));
  }
}

const issues = workspaceArchitecture(manifests);

const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));

issues.push(...dependencyIdentity(lock.packages, manifests['apps/server']!.dependencies!.effect!));

if (issues.length) {
  console.error(`Architecture violations in ${fileURLToPath(root)}:`);

  for (const issue of issues) console.error(`- ${issue}`);

  process.exitCode = 1;
}
