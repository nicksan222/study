import { test } from '@study/testing';
import { temporaryDirectory } from '@study/testing/resources';

/** Harness contract fixtures remain temporary even when they deliberately fail cleanup. */
export async function temporaryArtifacts(): Promise<string> {
  const directory = await temporaryDirectory({
    directory: Bun.fileURLToPath(new URL('../../../../../target/test-fixtures', import.meta.url)),
    prefix: 'e2e-'
  });

  test.onTestFinished(() => directory[Symbol.asyncDispose]());

  return directory.path;
}
