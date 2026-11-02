/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exports the recording service as the feature’s public entry point.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reexports Recordings for feature and runtime consumers.                                │
 * │ - Keeps private implementation modules behind the feature entry point.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers depend on this public service export; stores, workflows, and helpers remain      │
 * │ internal to recordings.                                                                  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { inspectMaterialDeletion, scrubMaterialDeletion } from './material-deletion.ts';
export { Recordings } from './service/index.ts';
