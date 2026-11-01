/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds the canonical health response from the worker lifecycle state.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature services own application rules and coordinate typed store operations.          │
 * │ - Validates or coordinates feature-level operations.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses owned stores and platform transactions rather than querying SQLite directly.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export const healthData = (workersRunning: boolean) => ({
  protocolVersion: 1,
  workersRunning,
  testMode: false
});
