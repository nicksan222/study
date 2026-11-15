/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines shared installation paths for every supported integration provider.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps executable locations aligned with adapters and image installation.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The manifest is test infrastructure and never reads host applications.                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import fixtures from './providers.json' with { type: 'json' };

/** Installation paths share one manifest checked against provider adapters by Oxlint. */
export const integrationFixtures = fixtures as Record<string, { executable: string }>;
