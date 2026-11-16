const libraryExportFacets: Readonly<Record<string, readonly string[]>> = {
  contracts: ['react'],
  db: ['testing', 'schema-builder'],
  icons: [],
  integrations: [],
  localization: [],
  testing: ['vitest', 'react/setup'],
  theme: [],
  // Embedded app surfaces share component CSS without the full application shell reset.
  ui: ['theme.css', 'styles.css', 'presentation.css']
};

const applicationExportFacets: Readonly<Record<string, readonly string[]>> = {
  server: ['client', 'runtime', 'runtime/ownership', 'runtime/database', 'testing'],
  client: ['feature-previews', 'feature-previews/catalog'],
  tooling: ['development/rpc-proxy']
};

export function isApprovedPackageSpecifier(source: string): boolean {
  if (!source.startsWith('@study/')) return true;

  const path = source.slice('@study/'.length);
  const separator = path.indexOf('/');
  const name = separator < 0 ? path : path.slice(0, separator);
  const facet = separator < 0 ? undefined : path.slice(separator + 1);
  const libraryFacets = libraryExportFacets[name];

  if (libraryFacets) return facet === undefined || libraryFacets.includes(facet);

  const applicationFacets = applicationExportFacets[name];

  if (!applicationFacets) return true;

  return facet !== undefined && applicationFacets.includes(facet);
}

function explicitSourceTarget(prefix: string, value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith(prefix) &&
    !value.includes('*') &&
    !value.split('/').includes('..')
  );
}

type PackageScope = {
  readonly name: string;
  readonly library: boolean;
  readonly sourcePrefix: string;
};

function packageScope(path: string, exportsValue: unknown): PackageScope | undefined {
  const library = path.startsWith('packages/');
  const application = path === 'apps/server' || path === 'apps/client' || path === 'tooling';

  if ((!library && !application) || (application && exportsValue === undefined)) return undefined;

  return {
    name: path.split('/').at(-1)!,
    library,
    sourcePrefix: path === 'tooling' ? './scripts/' : './src/'
  };
}

function exportMap(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exportKeys(library: boolean, facets: readonly string[]): Set<string> {
  const keys = new Set(facets.map((facet) => `./${facet}`));

  if (library) keys.add('.');

  return keys;
}

function exportEntryIssues(
  path: string,
  key: string,
  target: unknown,
  allowed: ReadonlySet<string>,
  sourcePrefix: string
): string[] {
  if (!allowed.has(key))
    return [`${path}: ${key} is not an approved package export; use the package root.`];

  if (!explicitSourceTarget(sourcePrefix, target))
    return [`${path}: ${key} must target an explicit source file inside its workspace.`];

  return [];
}

/** Keep package export maps consistent with the shared root-first import policy. */
export function packageExportIssues(path: string, exportsValue: unknown): string[] {
  const scope = packageScope(path, exportsValue);

  if (!scope) return [];

  const facets = scope.library
    ? libraryExportFacets[scope.name]
    : applicationExportFacets[scope.name];

  if (!facets) return [`${path}: define its public exports in the central package export policy.`];

  const exports = exportMap(exportsValue);
  const issues =
    scope.library && !('.' in exports)
      ? [`${path}: expose ordinary public APIs through the package root export.`]
      : [];
  const allowed = exportKeys(scope.library, facets);

  for (const [key, target] of Object.entries(exports))
    issues.push(
      ...exportEntryIssues(
        path,
        key,
        target,
        allowed,
        path === 'apps/server' && key === './testing' ? './test/testing/' : scope.sourcePrefix
      )
    );

  return issues;
}
