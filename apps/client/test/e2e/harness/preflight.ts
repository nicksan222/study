import { testPolicy } from '@study/testing';
import { spawnScopedProcess } from '@study/testing/process';
import type { FullConfig } from 'playwright/test';
import type { JSONReport, JSONReportSuite } from 'playwright/types/testReporter';

import { safeName, workflowName } from './identity.ts';

type Journey = { title: string; parts: string[] };

async function collect(configFile: string): Promise<Map<string, Journey>> {
  await using child = spawnScopedProcess(
    [
      process.execPath,
      '--bun',
      Bun.fileURLToPath(new URL('../../../../../node_modules/playwright/cli.js', import.meta.url)),
      'test',
      '--config',
      configFile,
      '--list',
      '--reporter=json'
    ],
    {
      timeout: testPolicy.processStartupTimeout,
      env: { ...process.env, E2E_UPDATE: undefined },
      stdout: 'pipe',
      stderr: 'pipe'
    }
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);

  if (code) throw new Error(`Cannot collect browser journeys: ${stderr || stdout}`);

  const report: JSONReport = JSON.parse(stdout);
  const identities = new Map<string, Journey>();

  function visit(suite: JSONReportSuite, parents: string[]) {
    const titles = [...parents, suite.title];

    for (const spec of suite.specs) {
      if (/(?:^|\/)harness\//.test(spec.file)) continue;

      const identity = workflowName(spec.title);
      const parts = [...titles, spec.title];
      const title = parts.join(' ');
      const previous = identities.get(identity);

      if (previous)
        throw new Error(
          `Baseline identity collision "${identity}": ${previous.title} and ${title}`
        );

      identities.set(identity, { title, parts });
    }

    for (const child of suite.suites ?? []) visit(child, titles);
  }

  for (const suite of report.suites) visit(suite, []);

  return identities;
}

/** Validate the complete native catalog before any worker can write a baseline, even with --grep. */
export default async function setup(config: FullConfig): Promise<void> {
  assertSnapshotComparison(
    config.updateSnapshots,
    config.projects.some((project) => project.ignoreSnapshots)
  );

  if (!process.env.E2E_UPDATE) await collect(config.configFile!);
}

/** Resolve the exact authored title using native collection rather than parsing source text. */
export async function workflowSelection(configFile: string, scope: string | undefined) {
  if (!scope) return undefined;

  const identities = await collect(configFile);
  const workflow = safeName(scope.split('/')[0]!);
  const journey = identities.get(workflow);

  if (!journey) throw new Error(`Unknown E2E workflow: ${workflow}`);

  const pattern = journey.parts
    .map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('(?: @\\S+)* ');

  return new RegExp(`(?:^| )${pattern}(?: @\\S+)*$`);
}

/** UI mode can replace the run policy after global setup has already completed. */
export function assertSnapshotComparison(
  updateSnapshots: FullConfig['updateSnapshots'],
  ignoreSnapshots: boolean
): void {
  if (updateSnapshots !== 'none' || ignoreSnapshots)
    throw new Error(
      'Use web:e2e:update for scoped baseline updates; native snapshot overrides are forbidden'
    );
}
