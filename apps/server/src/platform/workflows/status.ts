/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Centralizes the durable terminal-state check shared by workflow storage and        │
 * │ execution control. Completed and cancelled executions cannot be claimed for further      │
 * │ work.                                                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports isTerminalExecution. Completed and cancelled executions cannot be claimed for  │
 * │   further work.                                                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Workflow storage and control use this predicate against the canonical execution status   │
 * │ schema; it does not mutate execution state.                                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { executionSchema } from '@study/contracts/workflows/schemas';

/** Durable completion and cancellation both fence future execution. */
export function isTerminalExecution(status: (typeof executionSchema.Type)['status']): boolean {
  return status === 'completed' || status === 'cancelled';
}
