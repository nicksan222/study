/** @file Builds materials generation queries and mutations with bound store resources. */

import * as input from '@study/contracts';
import {
  errorKindSchema,
  materialGenerationHistorySchema,
  materialGenerationHistoryReferencesSchema,
  materialGenerationInputSchema,
  materialGenerationPublicationSchema,
  materialGenerationRequestedSchema,
  materialGenerationSchema,
  materialGenerationSnapshotSchema,
  projectIdSchema,
  resolvedContentInputSchema
} from '@study/contracts';
import { storeMutation, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeGenerationHistory } from './generation-history.ts';
import { makeGeneration } from './generation-operations.ts';

export function makeMaterialGenerationStore(resources: StoreResources) {
  const {
    cancelGeneration,
    generationContext,
    prepareGenerationRetry,
    prepareGenerationFailure,
    publishGeneration,
    requestGeneration,
    requestGenerationOnce,
    setGenerationScope
  } = makeGeneration(resources);

  return {
    queries: {
      generationHistory: storeQuery({
        role: 'required',
        input: Schema.Struct({
          request: materialGenerationSnapshotSchema,
          snapshot: Schema.optional(materialGenerationHistoryReferencesSchema)
        }),
        output: materialGenerationHistorySchema,
        run: ({ request, snapshot }) => makeGenerationHistory(resources)(request, snapshot)
      }),
      materialGeneration: storeQuery({
        role: 'required',
        input: Schema.Struct({
          requestId: Schema.String,
          eventId: Schema.optional(Schema.String),
          verifyOnly: Schema.optional(Schema.Boolean)
        }),
        output: materialGenerationSnapshotSchema,
        run: (value) => generationContext(value.requestId, value.eventId, value.verifyOnly)!
      })
    },
    mutations: {
      cancelGeneration: storeMutation({
        changes: ['materials'],
        input: Schema.Struct({ requestId: Schema.String }),
        output: materialGenerationSnapshotSchema,
        run: cancelGeneration
      }),
      prepareRetry: storeMutation({
        changes: ['materials'],
        input: Schema.Struct({
          requestId: Schema.String.check(Schema.isMinLength(1)),
          retryId: Schema.String.check(Schema.isMinLength(1))
        }),
        output: Schema.Struct({
          request: materialGenerationSnapshotSchema,
          created: Schema.Boolean
        }),
        run: prepareGenerationRetry
      }),
      prepareFailure: storeMutation({
        changes: ['materials'],
        input: Schema.Struct({
          requestId: Schema.String,
          generationEventId: Schema.String,
          errorKind: errorKindSchema
        }),
        output: Schema.Struct({
          request: materialGenerationSnapshotSchema,
          event: materialGenerationRequestedSchema,
          failureId: Schema.String,
          created: Schema.Boolean
        }),
        run: prepareGenerationFailure
      }),
      openScope: storeMutation({
        changes: ['materials'],
        input: Schema.Struct({
          scopeId: Schema.String.check(Schema.isMinLength(1)),
          projectId: projectIdSchema
        }),
        output: Schema.Void,
        run: (value) => setGenerationScope(value, true)
      }),
      closeScope: storeMutation({
        changes: ['materials'],
        input: Schema.Struct({
          scopeId: Schema.String.check(Schema.isMinLength(1)),
          projectId: projectIdSchema
        }),
        output: Schema.Void,
        run: (value) => setGenerationScope(value, false)
      }),
      requestOnce: storeMutation({
        changes: ['materials'],
        input: Schema.Struct({
          requestId: Schema.String.check(Schema.isMinLength(1)),
          request: materialGenerationInputSchema
        }),
        output: Schema.Struct({ request: materialGenerationSchema, created: Schema.Boolean }),
        run: requestGenerationOnce
      }),
      publishGeneration: storeMutation({
        changes: ['materials'],
        input: Schema.Struct({
          ...materialGenerationPublicationSchema.fields,
          inputSnapshots: Schema.Array(resolvedContentInputSchema)
        }),
        output: Schema.Struct({
          versionId: input.materialVersionInputSchema.fields.id,
          event: Schema.NullOr(materialGenerationRequestedSchema),
          materialId: Schema.optional(input.materialInputSchema.fields.id)
        }),
        run: publishGeneration
      }),
      request: storeMutation({
        changes: ['materials'],
        input: Schema.Struct({
          requestId: Schema.String,
          request: materialGenerationInputSchema
        }),
        output: materialGenerationSchema,
        run: requestGeneration
      })
    }
  };
}

export function makeMaterialActiveGenerationsStore(resources: StoreResources) {
  return {
    queries: {
      activeGenerations: storeQuery({
        role: 'required',
        input: Schema.Struct({ projectId: Schema.optional(projectIdSchema) }),
        output: Schema.Array(materialGenerationSnapshotSchema),
        run: makeGeneration(resources).activeGenerations
      })
    },
    mutations: {}
  };
}
