/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exports the system service as the feature’s public entry point.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reexports System for feature and runtime consumers.                                    │
 * │ - Keeps private implementation modules behind the feature entry point.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers depend on this public service export; stores, workflows, and helpers remain      │
 * │ internal to system.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { System } from './service/index.ts';
