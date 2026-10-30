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
  packages: Record<string, { version?: string }>,
  effectVersion: string
): string[] {
  const issues: string[] = [];

  for (const name of ['effect', 'drizzle-orm']) {
    const copies = Object.entries(packages).filter(
      ([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`
    );

    if (copies.length !== 1)
      issues.push(
        `package-lock.json: resolve exactly one ${name} installation, found ${copies.length}.`
      );

    if (name === 'effect' && copies.some(([, entry]) => entry.version !== effectVersion))
      issues.push(`package-lock.json: every Effect installation must match ${effectVersion}.`);
  }

  return issues;
}

function retiredDependencyIssues(path: string, name: string): string[] {
  const issues: string[] = [];

  if (name.startsWith('@trpc/') || name === 'superjson')
    issues.push(`${path}: remove retired transport dependency ${name}.`);

  if (name === '@study/ai') issues.push(`${path}: remove the retired @study/ai dependency.`);

  if (/^drizzle-(?:orm|kit)(?:\/|$)/.test(name) && path !== 'packages/db')
    issues.push(`${path}: ${name} belongs exclusively to @study/db.`);

  return issues;
}

function dependencyIssues(
  path: string,
  section: string,
  dependencies: Record<string, string>,
  version: string | undefined
): string[] {
  const issues: string[] = [];

  for (const [name, requirement] of Object.entries(dependencies)) {
    issues.push(...retiredDependencyIssues(path, name));

    if ((name === 'ai' || name.startsWith('@ai-sdk/')) && path !== 'apps/server')
      issues.push(`${path}: ${name} belongs exclusively to apps/server.`);

    if (path === 'packages/contracts' && section !== 'devDependencies' && name !== 'effect')
      issues.push(`${path}: public contracts may depend only on Effect.`);

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
    if (path === 'packages/ai' || manifest.name === '@study/ai')
      issues.push(`${path}: retire @study/ai; AI belongs in apps/server.`);

    for (const section of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies'
    ] as const) {
      issues.push(...dependencyIssues(path, section, manifest[section] ?? {}, version));
    }
  }

  if (contracts) {
    function explicitExports(value: unknown): boolean {
      if (typeof value === 'string')
        return (
          value.startsWith('./src/') && !value.includes('*') && !value.split('/').includes('..')
        );

      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

      return (
        Object.entries(value).length > 0 &&
        Object.entries(value).every(
          ([key, target]) => !key.includes('*') && explicitExports(target)
        )
      );
    }

    if (!explicitExports(contracts.exports))
      issues.push(
        'packages/contracts: expose explicit browser-safe source entrypoints, without wildcard exports.'
      );
  }

  return issues.sort();
}
