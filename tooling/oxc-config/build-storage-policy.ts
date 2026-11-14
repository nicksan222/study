interface StorageConfiguration {
  scripts: Record<string, string>;
  cargoTarget: unknown;
  dockerIgnore: string;
}

/** Build entry points must retain one native output tree and bounded, disposable caches. */
export function buildStoragePolicy(config: StorageConfiguration): string[] {
  const issues: string[] = [];

  if (config.cargoTarget !== 'target/devcontainer')
    issues.push('.cargo/config.toml: build.target-dir must be target/devcontainer.');

  for (const [name, command] of Object.entries(config.scripts))
    if (/\bbun\s+(?:--bun\s+)?turbo\b/.test(command))
      issues.push(`package.json: ${name} bypasses the bounded Turbo entry point.`);

  for (const name of ['build', 'test', 'typecheck', 'check', 'check:changed'])
    if (!config.scripts[name]?.includes('tooling/scripts/development/turbo.ts run '))
      issues.push(`package.json: ${name} must use the bounded Turbo entry point.`);

  issues.push(...dockerContextIssues(config.dockerIgnore));

  return issues;
}

function dockerContextIssues(source: string): string[] {
  const allowed = new Set([
    '**',
    '!mise.toml',
    '!rust-toolchain.toml',
    '!tooling/',
    '!tooling/scripts/',
    '!tooling/scripts/setup/',
    '!tooling/scripts/setup/apt-packages.txt',
    '!tooling/scripts/setup/system.sh',
    '!tooling/scripts/devcontainer/',
    '!tooling/scripts/devcontainer/install-patchelf.sh'
  ]);
  const rules = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  if (rules[0] !== '**' || rules.some((line) => !allowed.has(line)))
    return ['.devcontainer/Dockerfile.dockerignore: admit only the explicit tool setup inputs.'];

  if ([...allowed].some((line) => !rules.includes(line)))
    return ['.devcontainer/Dockerfile.dockerignore: keep all required tool setup inputs.'];

  return [];
}
