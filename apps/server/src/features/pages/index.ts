/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes the independent authored Page service to other features.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exposes the independent authored Page service to other features.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Exports mechanical types and operations; owning features retain lifecycle and            │
 * │ publication policy.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Pages } from './service/index.ts';
