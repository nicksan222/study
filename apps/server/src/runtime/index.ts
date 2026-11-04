/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes the application lifetime service and native Effect RPC HTTP server         │
 * │ transport to callers.                                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Re-exports App and serve as the single runtime import surface for the process host.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Host code imports this module to open the application and attach HTTP; resource          │
 * │ ownership stays in service.ts and server.ts.                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { App } from './service.ts';
export { serve } from './server.ts';

export { acquireDatabaseOwnership } from '#server/platform/database/ownership';
