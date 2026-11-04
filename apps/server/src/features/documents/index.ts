/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes the independent authored Document service to other features.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exposes the independent authored Document service to other features.                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Exports mechanical types and operations; owning features retain lifecycle and            │
 * │ publication policy.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Documents } from './service/index.ts';
