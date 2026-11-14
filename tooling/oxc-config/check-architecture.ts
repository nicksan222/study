import { buildStoragePolicy } from './build-storage-policy.ts';
import { dependencyIdentity, workspaceArchitecture } from './workspace-architecture.ts';
import type { WorkspaceManifest } from './workspace-architecture.ts';

const root = new URL('../../', import.meta.url);

const manifests: Record<string, WorkspaceManifest> = {};

for (const directory of ['apps', 'packages']) {
  for await (const path of new Bun.Glob('*/package.json').scan({
    cwd: Bun.fileURLToPath(new URL(`${directory}/`, root))
  })) {
    manifests[`${directory}/${path.slice(0, -'/package.json'.length)}`] = await Bun.file(
      new URL(`${directory}/${path}`, root)
    ).json();
  }
}

const issues = workspaceArchitecture(manifests);

const manifest = await Bun.file(new URL('package.json', root)).json();

const cargo = Bun.TOML.parse(await Bun.file(new URL('.cargo/config.toml', root)).text()) as {
  build?: { 'target-dir'?: unknown };
};

issues.push(
  ...buildStoragePolicy({
    scripts: manifest.scripts,
    cargoTarget: cargo.build?.['target-dir'],
    dockerIgnore: await Bun.file(new URL('.devcontainer/Dockerfile.dockerignore', root)).text()
  })
);

const lock = Bun.JSON5.parse(await Bun.file(new URL('bun.lock', root)).text()) as {
  packages: Record<string, readonly unknown[]>;
};

issues.push(...dependencyIdentity(lock.packages, manifests['apps/server']!.dependencies!.effect!));

if (issues.length) {
  console.error(`Architecture violations in ${Bun.fileURLToPath(root)}:`);

  for (const issue of issues) console.error(`- ${issue}`);

  process.exitCode = 1;
}
