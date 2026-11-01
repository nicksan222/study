/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides the shared typed failure helper for rejecting invalid domain input with   │
 * │ StudyError.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports invalid, which throws StudyError with kind invalid_input for a domain          │
 * │   validation failure.                                                                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services call invalid while validating inputs; error normalization and public    │
 * │ RPC serialization occur at outer server boundaries.                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';

export function invalid(message: string): never {
  throw new StudyError('invalid_input', message);
}
