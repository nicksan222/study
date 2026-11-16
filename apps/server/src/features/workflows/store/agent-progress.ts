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

import {
  agentProgressInputSchema,
  agentProgressPageSchema,
  agentProgressLimit
} from '@study/contracts';
import { defineStore, storeQuery, agentProgressSnapshot } from '@study/server';
import { Schema } from 'effect';

export const AgentProgressStore = defineStore({
  name: 'study/AgentProgressStore',
  entity: { singular: 'agentRunProgress', plural: 'agentProgress' },
  make: ({ db }) => ({
    queries: {
      agentProgress: storeQuery({
        role: 'collection',
        input: Schema.Struct({
          scope: agentProgressInputSchema,
          limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: agentProgressLimit }))
        }),
        output: agentProgressPageSchema,
        run: (input) => agentProgressSnapshot({ db }, input.scope, input.limit)
      })
    },
    mutations: {}
  })
});
