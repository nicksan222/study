/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exports the settings service as the feature’s public entry point.                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reexports Settings for feature and runtime consumers.                                  │
 * │ - Keeps private implementation modules behind the feature entry point.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers depend on this public service export; stores, workflows, and helpers remain      │
 * │ internal to settings.                                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Settings } from './service/index.ts';
