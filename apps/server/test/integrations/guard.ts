/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Restricts real provider processes to their disposable integration environment.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Resolves installed executables from the shared provider installation manifest.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Host vaults and profiles are never passed to provider software.                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { integrationFixtures } from './fixtures.ts';

/** Real provider software may only run in a disposable integration container. */
export async function requireIntegrationContainer(provider: string) {
  if (
    !process.versions.bun ||
    process.platform !== 'linux' ||
    process.env.STUDY_INTEGRATION_ENVIRONMENT !== 'true' ||
    !integrationFixtures[provider] ||
    !(await Bun.file(integrationFixtures[provider]!.executable).exists())
  )
    throw new Error('Run provider tests with bun run integrations:e2e');

  return integrationFixtures[provider]!.executable;
}
