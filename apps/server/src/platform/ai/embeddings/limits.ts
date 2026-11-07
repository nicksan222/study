/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines shared limits for the local embedding worker protocol.                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps worker validation and caller admission bounds consistent.                        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ These constants describe private worker requests and never initiate model installation.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export const embeddingLimits = {
  chunkingInputLength: 2000000,
  embeddingInputLength: 32000,
  batchSize: 16,
  queuedRequests: 16,
  tokens: 512
} as const;
