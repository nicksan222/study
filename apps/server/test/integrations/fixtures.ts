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

import fixtures from './providers.json' with { type: 'json' };

/** Installation paths and scenarios share one manifest checked against provider adapters by Oxlint. */
export const integrationFixtures = fixtures as Record<
  string,
  { scenario: string; executable: string }
>;
