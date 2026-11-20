/** Runs the cloud provider tests with a private trust root and native Vitest reporting. */

import { testPolicy } from '@study/testing';
import { spawnScopedProcess } from '@study/testing/process';
import { temporaryDirectory } from '@study/testing/resources';

import { fs, run } from './filesystem.ts';

export async function runCloudIntegrationTests(signal: AbortSignal) {
  const root = Bun.fileURLToPath(new URL('../../../', import.meta.url));

  await using tls = await temporaryDirectory({ prefix: 'study-cloud-tls-' });

  await run(
    fs.remove(`${root}tooling/test-results/vitest/cloud-integrations.xml`, { force: true })
  );
  await using child = spawnScopedProcess(
    [
      'sh',
      'tooling/testing/integrations/entrypoint.sh',
      tls.path,
      process.execPath,
      '--bun',
      'vp',
      'test',
      'run',
      '--config',
      'tooling/testing/integrations/vite.config.ts'
    ],
    {
      cwd: root,
      env: { ...process.env, STUDY_CLOUD_INTEGRATION_ENVIRONMENT: 'true' },
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      signal,
      timeout: testPolicy.suiteTimeout
    }
  );

  const code = await child.exited;

  signal.throwIfAborted();

  return code;
}
