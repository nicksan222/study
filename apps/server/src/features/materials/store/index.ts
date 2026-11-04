/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes typed material stores, queries, and mutations used by the service layer.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Combines private material persistence modules into service-facing stores.              │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError, errorKindSchema } from '@study/contracts/errors';
import { sourceIndexedSchema, materialGenerationRequestedSchema } from '@study/contracts/events';
import { sourceIdSchema, projectIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { resolvedContentInputSchema } from '@study/contracts/inputs';
import * as input from '@study/contracts/materials/rpc';
import {
  materialGenerationSchema,
  materialGenerationSnapshotSchema,
  materialGenerationInputSchema,
  materialGenerationPublicationSchema,
  materialDetailSchema,
  materialVersionDetailSchema,
  materialCitationSchema
} from '@study/contracts/materials/schemas';
import { sourceExportSchema } from '@study/contracts/sources/rpc';
import { and, asc, eq, gt } from '@study/db';
import * as tables from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeQuery, storeMutation } from '#server/platform/definitions/define-store';

import { makeArchiveAction } from './archive-action.ts';
import { makeAttachAction } from './attach-action.ts';
import { makeCitations } from './citations.ts';
import { makeCreateAction } from './create-action.ts';
import { makeCreateVersionAction } from './create-version-action.ts';
import { makeDeleteDraftAction } from './delete-draft-action.ts';
import { makeDetachAction } from './detach-action.ts';
import { makeGeneration } from './generation.ts';
import { makeGetAction } from './get-action.ts';
import { makeGetVersionAction } from './get-version-action.ts';
import { makeListAction } from './list-action.ts';
import { makeListVersionsAction } from './list-versions-action.ts';
import { makePublishVersionAction } from './publish-version-action.ts';
import { makeReads } from './reads.ts';
import { makeRenameAction } from './rename-action.ts';
import { makeReorderAction } from './reorder-action.ts';
import { makeReplaceDraftAction } from './replace-draft-action.ts';
import { makeSetCitationsAction } from './set-citations-action.ts';
import { makeUnarchiveAction } from './unarchive-action.ts';

export const MaterialsStore = defineStore({
  name: 'study/MaterialsStore',
  entity: { singular: 'material', plural: 'materials' },
  make: (resources) => {
    const { archive } = makeArchiveAction(resources);

    const { attach } = makeAttachAction(resources);

    const { create } = makeCreateAction(resources);

    const { createVersion } = makeCreateVersionAction(resources);

    const { deleteDraft } = makeDeleteDraftAction(resources);

    const { detach } = makeDetachAction(resources);

    const { get } = makeGetAction(resources);

    const { list } = makeListAction(resources);

    const { publishVersion } = makePublishVersionAction(resources);

    const { rename, updateDescription } = makeRenameAction(resources);

    const { reorder } = makeReorderAction(resources);

    const { replaceDraft } = makeReplaceDraftAction(resources);

    const { setCitations } = makeSetCitationsAction(resources);

    const { unarchive } = makeUnarchiveAction(resources);

    return {
      queries: {
        material: storeQuery({
          role: 'required',
          input: input.materialInputSchema,
          output: materialDetailSchema,
          run: (value) => get(value)!
        }),
        findMaterial: storeQuery({
          role: 'optional',
          input: input.materialInputSchema,
          output: Schema.Option(materialDetailSchema),
          run: (value) => Option.fromNullishOr(get(value))
        }),
        materials: storeQuery({
          role: 'collection',
          input: input.materialsInputSchema,
          output: input.materialPageSchema,
          run: list
        })
      },
      mutations: {
        create: storeMutation({
          input: input.createInputSchema,
          output: materialDetailSchema,
          run: create
        }),
        createVersion: storeMutation({
          input: input.createVersionInputSchema,
          output: materialVersionDetailSchema,
          run: createVersion
        }),
        archive: storeMutation({
          input: input.archiveInputSchema,
          output: materialDetailSchema,
          run: archive
        }),
        unarchive: storeMutation({
          input: input.unarchiveInputSchema,
          output: materialDetailSchema,
          run: unarchive
        }),
        updateDescription: storeMutation({
          input: input.updateDescriptionInputSchema,
          output: materialDetailSchema,
          run: updateDescription
        }),
        rename: storeMutation({
          input: input.renameInputSchema,
          output: materialDetailSchema,
          run: rename
        }),
        deleteDraft: storeMutation({
          input: input.deleteDraftInputSchema,
          output: input.deleteDraftInputSchema,
          run: deleteDraft
        }),
        publishVersion: storeMutation({
          input: input.publishVersionInputSchema,
          output: materialVersionDetailSchema,
          run: publishVersion
        }),
        replaceDraft: storeMutation({
          input: input.replaceDraftInputSchema,
          output: materialVersionDetailSchema,
          run: replaceDraft
        }),
        setCitations: storeMutation({
          input: input.setCitationsInputSchema,
          output: Schema.Array(materialCitationSchema),
          run: setCitations
        }),
        attach: storeMutation({
          input: input.attachInputSchema,
          output: input.attachInputSchema,
          run: attach
        }),
        detach: storeMutation({
          input: input.detachInputSchema,
          output: input.detachInputSchema,
          run: detach
        }),
        reorder: storeMutation({
          input: input.reorderInputSchema,
          output: Schema.Struct({ materialIds: input.reorderInputSchema.fields.materialIds }),
          run: reorder
        })
      }
    };
  }
});

export const MaterialVersionsStore = defineStore({
  name: 'study/MaterialVersionsStore',
  entity: { singular: 'materialVersion', plural: 'materialVersions' },
  make: (resources) => {
    const { getVersion } = makeGetVersionAction(resources);

    const { listVersions } = makeListVersionsAction(resources);

    return {
      queries: {
        materialVersion: storeQuery({
          role: 'required',
          input: input.materialVersionInputSchema,
          output: materialVersionDetailSchema,
          run: (value) => getVersion(value)!
        }),
        findMaterialVersion: storeQuery({
          role: 'optional',
          input: input.materialVersionInputSchema,
          output: Schema.Option(materialVersionDetailSchema),
          run: (value) => Option.fromNullishOr(getVersion(value))
        }),
        materialVersions: storeQuery({
          role: 'collection',
          input: input.materialVersionsInputSchema,
          output: input.versionPageSchema,
          run: listVersions
        })
      },
      mutations: {}
    };
  }
});

export const MaterialCitationsStore = defineStore({
  name: 'study/MaterialCitationsStore',
  entity: { singular: 'citation', plural: 'citations' },
  make: (resources) => {
    const { db } = resources;
    const { readCitationDetails } = makeCitations(resources);

    const { versionRow } = makeReads(resources);

    return {
      queries: {
        citations: storeQuery({
          role: 'collection',
          input: input.citationsInputSchema,
          output: input.citationPageSchema,
          run: (value) => {
            versionRow(value.id);

            const rows = db.orm
              .select()
              .from(tables.material_evidence_citations)
              .where(
                and(
                  eq(tables.material_evidence_citations.version_id, value.id),
                  value.cursor === undefined
                    ? undefined
                    : gt(tables.material_evidence_citations.marker, value.cursor)
                )
              )
              .orderBy(asc(tables.material_evidence_citations.marker))
              .limit(value.limit + 1)
              .all();

            const items = rows.slice(0, value.limit).map(readCitationDetails);

            return { items, nextCursor: rows.length > value.limit ? items.at(-1)!.marker : null };
          }
        })
      },
      mutations: {}
    };
  }
});

export const MaterialGenerationStore = defineStore({
  name: 'study/MaterialGenerationStore',
  entity: { singular: 'materialGeneration', plural: 'materialGenerations' },
  make: (resources) => {
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
          input: Schema.Struct({ requestId: Schema.String }),
          output: materialGenerationSnapshotSchema,
          run: cancelGeneration
        }),
        prepareRetry: storeMutation({
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
          input: Schema.Struct({
            scopeId: Schema.String.check(Schema.isMinLength(1)),
            projectId: projectIdSchema
          }),
          output: Schema.Void,
          run: (value) => setGenerationScope(value, true)
        }),
        closeScope: storeMutation({
          input: Schema.Struct({
            scopeId: Schema.String.check(Schema.isMinLength(1)),
            projectId: projectIdSchema
          }),
          output: Schema.Void,
          run: (value) => setGenerationScope(value, false)
        }),
        requestOnce: storeMutation({
          input: Schema.Struct({
            requestId: Schema.String.check(Schema.isMinLength(1)),
            request: materialGenerationInputSchema
          }),
          output: Schema.Struct({ request: materialGenerationSchema, created: Schema.Boolean }),
          run: requestGenerationOnce
        }),
        publishGeneration: storeMutation({
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
});
