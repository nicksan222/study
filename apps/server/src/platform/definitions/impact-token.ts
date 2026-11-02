/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Fingerprints logical impact rows without losing bigint identity.                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Shares deterministic bigint-aware serialization for explicit impact tokens.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This utility hashes supplied rows and grants no persistence or cleanup authority.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

/** Fingerprints logical impact rows without losing bigint identity precision. */
export function impactToken(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? String(item) : item)))
    .digest('hex');
}
