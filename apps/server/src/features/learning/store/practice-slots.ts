/** @file Owns practice slots within this feature. */

import { practiceSlotSchema } from '@study/contracts';
import { Option, Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { practiceSlotLookupSchema } from './practice-schemas.ts';
import { makePractice } from './practice.ts';

export const PracticeSlotStore = defineStore({
  name: 'study/LearningPracticeSlotStore',
  entity: { singular: 'practiceSlot', plural: 'practiceSlots' },
  make: (resources) => {
    const { activeSlot } = makePractice(resources);

    return {
      queries: {
        findPracticeSlot: storeQuery({
          role: 'optional',
          input: practiceSlotLookupSchema,
          output: Schema.Option(practiceSlotSchema),
          run: (input) => Option.fromNullishOr(activeSlot(input.slotId))
        })
      },
      mutations: {}
    };
  }
});
