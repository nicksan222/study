/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines schemas for material store inputs, outputs, and persisted value decoding.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Defines the typed persistence boundary for material store inputs and results.          │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { anchorSchema, documentSchema } from '@study/contracts/sources/schemas';
