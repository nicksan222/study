/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes the integrations service as the public feature boundary.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports the owning integrations application service.                                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Other features use this service without importing its private stores.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { Integrations } from './service/index.ts';
