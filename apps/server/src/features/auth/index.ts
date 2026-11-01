/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Re-exports the authentication service as the feature’s public entry point.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps authentication implementation modules behind one stable feature export.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The auth service owns account policy; this layer stores only private credentials and     │
 * │ generation fences.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Auth } from './service/index.ts';
