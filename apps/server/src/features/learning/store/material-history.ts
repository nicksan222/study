/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retires practice slots and answers tied to exact historical Material versions.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Includes pending input dependencies and completed version-specific attempts.           │
 * │ - Keeps unrelated schedules and stable card identities outside version cleanup.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Learning owns practice persistence; native retirement handles correlated private         │
 * │ payloads.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { materialVersionIdSchema } from '@study/contracts/ids';
import { Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { impactToken } from '#server/platform/definitions/impact-token';

import { makeMaterialRetirement } from './material-retirement.ts';

export const LearningMaterialHistoryStore = defineStore({
  name: 'study/LearningMaterialHistoryStore',
  entity: { singular: 'learningMaterialHistory', plural: 'learningMaterialHistories' },
  make: (resources) => {
    const { inspect, cancelSlots, scrubVersions } = makeMaterialRetirement(resources);

    return {
      queries: {
        learningMaterialHistory: storeQuery({
          role: 'required',
          input: Schema.Array(materialVersionIdSchema),
          output: Schema.Struct({ token: Schema.String, requestIds: Schema.Array(Schema.String) }),
          run: (ids) => {
            const value = inspect(ids);

            return {
              token: impactToken(value),
              requestIds: value.requestIds
            };
          }
        })
      },
      mutations: {
        prepare: storeMutation({
          input: Schema.Array(materialVersionIdSchema),
          output: Schema.Array(Schema.String),
          run: cancelSlots
        }),
        scrub: storeMutation({
          input: Schema.Array(materialVersionIdSchema),
          output: Schema.Void,
          run: scrubVersions
        })
      }
    };
  }
});
