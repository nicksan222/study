import { packageExportIssues } from './plugin/package-export-policy.ts';

export interface WorkspaceManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  exports?: unknown;
}

/** Effect schemas and Drizzle objects must share one installed runtime identity. */
export function dependencyIdentity(
  packages: Record<string, readonly unknown[]>,
  effectVersion: string
): string[] {
  const issues: string[] = [];

  for (const name of ['effect', 'drizzle-orm']) {
    const copies = Object.entries(packages).filter(
      ([path]) => path === name || path.endsWith(`/${name}`)
    );

    if (copies.length !== 1)
      issues.push(`bun.lock: resolve exactly one ${name} installation, found ${copies.length}.`);

    if (name === 'effect' && copies.some(([, entry]) => entry[0] !== `${name}@${effectVersion}`))
      issues.push(`bun.lock: every Effect installation must match ${effectVersion}.`);
  }

  return issues;
}

function aiDependencyIssue(path: string, name: string): string | undefined {
  if (name === 'ai' || name.startsWith('@ai-sdk/'))
    return `${path}: ${name} is retired; use native Effect AI.`;

  if (name.startsWith('@effect/ai-') && path !== 'apps/server')
    return `${path}: ${name} belongs exclusively to apps/server.`;
}

function dependencyIssues(
  path: string,
  section: string,
  dependencies: Record<string, string>,
  version: string | undefined
): string[] {
  const issues: string[] = [];

  for (const [name, requirement] of Object.entries(dependencies)) {
    if (/^drizzle-(?:orm|kit)(?:\/|$)/.test(name) && path !== 'packages/db')
      issues.push(`${path}: ${name} belongs exclusively to @study/db.`);

    const aiIssue = aiDependencyIssue(path, name);

    if (aiIssue) issues.push(aiIssue);

    if (
      path === 'packages/contracts' &&
      section !== 'devDependencies' &&
      !['effect', '@effect/atom-react', 'react'].includes(name)
    )
      issues.push(`${path}: contracts permit Effect and optional official React bindings only.`);

    issues.push(...effectRequirementIssues(path, name, requirement, version));
  }

  return issues;
}

function effectRequirementIssues(
  path: string,
  name: string,
  requirement: string,
  version: string | undefined
): string[] {
  const issues: string[] = [];

  if (name === 'effect') {
    if (!/^4\.\d+\.\d+$/.test(requirement))
      issues.push(`${path}: pin an exact stable Effect v4 version.`);
    else if (version && requirement !== version)
      issues.push(`${path}: Effect ${requirement} differs from the server's ${version}.`);
  }

  return issues;
}

/** Manifest-level ownership complements source import rules, including unused dependencies. */
export function workspaceArchitecture(manifests: Record<string, WorkspaceManifest>): string[] {
  const issues: string[] = [];
  const contracts = manifests['packages/contracts'];

  if (!contracts) issues.push('packages/contracts must own the public application contracts.');

  const version = manifests['apps/server']?.dependencies?.effect;

  for (const [path, manifest] of Object.entries(manifests)) {
    issues.push(...packageExportIssues(path, manifest.exports));

    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies'
    ] as const) {
      issues.push(...dependencyIssues(path, section, manifest[section] ?? {}, version));
    }
  }

  return issues.sort();
}
