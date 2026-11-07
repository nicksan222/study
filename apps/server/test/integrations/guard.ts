/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines shared integration test infrastructure for disposable environments.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps provider tests within the shared container lifecycle.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real provider processes use isolated files and never host vaults or profiles.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { existsSync } from 'node:fs';

/** Real provider software may only run in a disposable integration container. */
export function requireIntegrationContainer(provider: string) {
  if (
    process.platform !== 'linux' ||
    process.env.STUDY_INTEGRATION_PROVIDER !== provider ||
    !process.env.STUDY_INTEGRATION_EXECUTABLE ||
    !existsSync('/.dockerenv')
  )
    throw new Error('Real integration scenarios require the shared Testcontainers runner');

  return process.env.STUDY_INTEGRATION_EXECUTABLE;
}
