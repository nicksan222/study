/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates local semantic retrieval through typed feature capabilities and native │
 * │ workflows.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves current publication identities and validates searchable entity projections.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Runtime registration remains explicit and feature services own all content visibility    │
 * │ rules.                                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Context } from 'effect';

import type { EmbeddingModel } from './types.ts';

/** Explicit composition input; obtaining this capability never installs a model. */
export class SearchConfiguration extends Context.Service<
  SearchConfiguration,
  {
    readonly model: EmbeddingModel;
    readonly schema?: Readonly<Record<string, unknown>>;
  }
>()('study/search/Configuration') {}
