/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Re-exports the note service as the feature’s public entry point.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exposes the service layer while keeping stores and workflow machinery private.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Note persistence remains private to the feature; callers use the service or              │
 * │ typed RPC boundary.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Notes } from './service/index.ts';
