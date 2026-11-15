/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supplies real scoped live-query services to native RPC test handler layers.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves runtime service requirements in standalone RPC fixtures.                     │
 * │ - Shares one real revision reconciler across composed handler groups.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Fixtures provide their own Database layer; no reactive behavior is mocked.               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { liveQueriesLayer } from '#server/platform/database/live-queries';

export const testLiveQueries = liveQueriesLayer();
