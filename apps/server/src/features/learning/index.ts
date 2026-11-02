/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Re-exports the learning service as the feature’s public entry point.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports the learning service boundary while leaving stores and workflows internal.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Learning stores remain private to the service; workflow and RPC callers use typed        │
 * │ feature operations.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Learning } from './service/index.ts';
