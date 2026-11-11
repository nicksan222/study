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

/** Real provider software may only run in a disposable integration container. */
export async function requireIntegrationContainer(provider: string) {
  if (
    !process.versions.bun ||
    process.platform !== 'linux' ||
    process.env.STUDY_INTEGRATION_PROVIDER !== provider ||
    !process.env.STUDY_INTEGRATION_EXECUTABLE ||
    !(await Bun.file('/.dockerenv').exists())
  )
    throw new Error('Real integration scenarios require the shared Testcontainers runner');

  return process.env.STUDY_INTEGRATION_EXECUTABLE;
}
