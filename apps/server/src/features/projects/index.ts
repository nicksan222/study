/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exports the project service as the feature’s public entry point.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reexports Projects for feature and runtime consumers.                                  │
 * │ - Keeps private implementation modules behind the feature entry point.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers depend on this public service export; stores, workflows, and helpers remain      │
 * │ internal to projects.                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Projects } from './service/index.ts';
