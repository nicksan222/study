/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes bounded source planning and durable context preparation to features.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Publishes reusable plan schemas, typed views and processing callbacks.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature modules retain ownership of model prompts and final publication authority.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export { planSourcePassages, splitTextRanges, sourcePassagePlanSchema } from './planner.ts';
export type { SourceInput, SourcePlanLimits, SourceSelection } from './planner.ts';
export type { ContextReductionLimits, ReductionContext } from './runner.ts';

export { defineContextPreparation } from './agent.ts';

export type { ContextPreparation } from './agent.ts';
