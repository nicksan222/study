/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads bounded durable agent progress snapshots through the workflow feature store. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates progress scope and collection limits before reading persisted previews.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses platform workflow persistence; services expose typed streaming RPC snapshots.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { agentProgressInputSchema, agentProgressPageSchema } from '@study/contracts/ai/progress';
import { Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import { agentProgressSnapshot } from '#server/platform/workflows/agent-progress';

export const AgentProgressStore = defineStore({
  name: 'study/AgentProgressStore',
  entity: { singular: 'agentRunProgress', plural: 'agentProgress' },
  make: ({ db }) => ({
    queries: {
      agentProgress: storeQuery({
        role: 'collection',
        input: Schema.Struct({
          scope: agentProgressInputSchema,
          limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
        }),
        output: agentProgressPageSchema,
        run: (input) => agentProgressSnapshot({ db }, input.scope, input.limit)
      })
    },
    mutations: {}
  })
});
