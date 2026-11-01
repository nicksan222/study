/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exports the workflow execution service as the feature’s public entry point.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reexports Workflows for feature and runtime consumers.                                 │
 * │ - Keeps private implementation modules behind the feature entry point.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers depend on this public service export; stores, workflows, and helpers remain      │
 * │ internal to workflows.                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Workflows } from './service/index.ts';
