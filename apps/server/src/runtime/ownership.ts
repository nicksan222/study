/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes database ownership for process hosts and offline maintenance tools.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Re-export the shared exclusive database ownership acquisition function.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Delegates locking to the platform and does not acquire application services.             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { acquireDatabaseOwnership } from '#server/platform/database/ownership';
