/** @file Owns practice controls within this feature. */

import { practiceInputSchema } from '@study/contracts';
import { defineStore, storeQuery } from '@study/server';
import { Option, Schema } from 'effect';

import { controlSchema } from './practice-schemas.ts';
import { makePractice } from './practice.ts';

export const PracticeControlStore = defineStore({
  name: 'study/LearningPracticeControlStore',
  entity: { singular: 'practiceControl', plural: 'practiceControls' },
  make: (resources) => {
    const { control } = makePractice(resources);

    return {
      queries: {
        findPracticeControl: storeQuery({
          role: 'optional',
          input: practiceInputSchema,
          output: Schema.Option(controlSchema),
          run: (input) => {
            const row = control(input.projectId);

            return row
              ? Option.some({ projectId: row.project_id, epoch: row.epoch, enabled: row.enabled })
              : Option.none();
          }
        })
      },
      mutations: {}
    };
  }
});
