/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exports the source service as the feature’s public entry point.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reexports Sources for feature and runtime consumers.                                   │
 * │ - Keeps private implementation modules behind the feature entry point.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers depend on this public service export; stores, workflows, and helpers remain      │
 * │ internal to sources.                                                                     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Sources } from './service/index.ts';
