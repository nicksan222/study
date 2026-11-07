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

import { readFileSync } from 'node:fs';

/** Installation paths and scenarios share one manifest checked against provider adapters by Oxlint. */
export const integrationFixtures = JSON.parse(
  readFileSync(new URL('./providers.json', import.meta.url), 'utf8')
) as Record<string, { scenario: string; executable: string }>;
