import { projectIdSchema } from '@study/contracts/ids';
import {
  createProjectInputSchema as createInput,
  projectIdInputSchema as deleteInput,
  renameProjectInputSchema as renameInput,
  setExamInputSchema as examInput,
  projectPageInputSchema
} from '@study/contracts/projects/rpc';
import { projectSchema } from '@study/contracts/projects/schemas';
import { desc, eq, lt } from '@study/db';
import { projects } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

const row = (value: typeof projects.$inferSelect) => ({
  id: value.id,
  name: value.name,
  examOn: value.exam_on,
  createdAt: value.created_at,
  updatedAt: value.updated_at
});

function makeHelpers({ db }: StoreResources) {
  const find = (id: typeof projectIdSchema.Type) => {
    const value = db.orm.select().from(projects).where(eq(projects.id, id)).get();

    return value ? row(value) : null;
  };

  return { find };
}

const filter = projectPageInputSchema;

export const ProjectsStore = defineStore({
  name: 'study/ProjectsStore',
  entity: { singular: 'project', plural: 'projects' },
  make: ({ db, clock }) => {
    const { find } = makeHelpers({ db, clock });

    return {
      queries: {
        project: storeQuery({
          role: 'required',
          input: projectIdSchema,
          output: projectSchema,
          run: (id) => find(id)!
        }),
        findProject: storeQuery({
          role: 'optional',
          input: projectIdSchema,
          output: Schema.Option(projectSchema),
          run: (id) => Option.fromNullishOr(find(id))
        }),
        projects: storeQuery({
          role: 'collection',
          input: filter,
          output: Schema.Array(projectSchema),
          run: (input) =>
            db.orm
              .select()
              .from(projects)
              .where(input.before === undefined ? undefined : lt(projects.id, input.before))
              .orderBy(desc(projects.id))
              .limit(input.limit)
              .all()
              .map(row)
        })
      },
      mutations: {
        createProject: storeMutation({
          input: createInput,
          output: projectSchema,
          run: (input) => {
            const timestamp = unixSeconds(clock);
            const result = db.orm
              .insert(projects)
              .values({ name: input.name, created_at: timestamp, updated_at: timestamp })
              .run();

            return {
              id: Schema.decodeUnknownSync(projectIdSchema)(BigInt(result.lastInsertRowid)),
              name: input.name,
              examOn: null,
              createdAt: timestamp,
              updatedAt: timestamp
            };
          }
        }),
        renameProject: storeMutation({
          input: renameInput,
          output: Schema.Boolean,
          run: (input) =>
            db.orm
              .update(projects)
              .set({ name: input.name, updated_at: unixSeconds(clock) })
              .where(eq(projects.id, input.id))
              .run().changes !== 0n
        }),
        deleteProject: storeMutation({
          input: deleteInput,
          output: Schema.Boolean,
          run: (input) =>
            db.orm.delete(projects).where(eq(projects.id, input.id)).run().changes !== 0n
        }),
        setExam: storeMutation({
          input: examInput,
          output: Schema.Boolean,
          run: (input) =>
            db.orm
              .update(projects)
              .set({ exam_on: input.examOn, updated_at: unixSeconds(clock) })
              .where(eq(projects.id, input.id))
              .run().changes !== 0n
        })
      }
    };
  }
});
