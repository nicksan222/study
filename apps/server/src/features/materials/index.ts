/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Re-exports the materials service as the feature’s public entry point.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports the materials service while keeping persistence and workflow modules internal. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Material persistence remains private to the feature; callers cross the service or        │
 * │ declared RPC boundary.                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Materials } from './service/index.ts';
