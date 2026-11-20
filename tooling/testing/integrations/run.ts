/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Launches provider integration tests with native output and exit status.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Forwards interruption through scoped environment cleanup before exiting.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The environment module owns resources while Vitest owns test results.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { runCloudIntegrationTests } from './cloud.ts';
import { runIntegrationTests } from './environment.ts';

const controller = new AbortController();

const handlers = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => {
  const handler = () => controller.abort(new Error(`Integration tests interrupted by ${signal}`));

  process.on(signal, handler);

  return { signal, handler };
});

try {
  const desktop = await runIntegrationTests(undefined, controller.signal);
  const cloud = await runCloudIntegrationTests(controller.signal);

  process.exitCode = desktop || cloud;
} catch (error) {
  console.error(error);
  process.exitCode = controller.signal.aborted ? 130 : 1;
} finally {
  for (const { signal, handler } of handlers) process.off(signal, handler);
}
