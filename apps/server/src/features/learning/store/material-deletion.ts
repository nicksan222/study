/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Learning retires only slots and grading attempts owned by accepted Material scope. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { materialIdSchema } from '@study/contracts/ids';
import { inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeMaterialRetirement } from './material-retirement.ts';

function makeVersionIds({ db }: StoreResources) {
  return (ids: readonly (typeof materialIdSchema.Type)[]) =>
    db.orm
      .select()
      .from(s.material_versions)
      .where(inArray(s.material_versions.material_id, [...ids]))
      .all()
      .map((v) => v.id);
}

export const LearningMaterialDeletionStore = defineStore({
  name: 'study/LearningMaterialDeletionStore',
  entity: { singular: 'learningMaterialDeletion', plural: 'learningMaterialDeletions' },
  make: (resources) => {
    const { db } = resources;
    const versionIds = makeVersionIds(resources);
    const retirement = makeMaterialRetirement(resources);

    return {
      queries: {},
      mutations: {
        prepare: storeMutation({
          input: Schema.Array(materialIdSchema),
          output: Schema.Array(Schema.String),
          run: (ids) => {
            const versions = versionIds(ids);

            return retirement.cancelSlots(versions);
          }
        }),
        scrub: storeMutation({
          input: Schema.Array(materialIdSchema),
          output: Schema.Void,
          run: (ids) => {
            const versions = versionIds(ids);

            retirement.scrubVersions(versions);

            const cards = db.orm
              .select()
              .from(s.material_card_identities)
              .where(inArray(s.material_card_identities.material_id, [...ids]))
              .all();

            db.orm
              .delete(s.material_card_schedules)
              .where(
                inArray(
                  s.material_card_schedules.card_id,
                  cards.map((c) => c.id)
                )
              )
              .run();
          }
        })
      }
    };
  }
});
