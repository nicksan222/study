/** @file Builds materials library queries and mutations with bound store resources. */

import * as input from '@study/contracts';
import {
  materialCitationSchema,
  materialDetailSchema,
  materialVersionDetailSchema
} from '@study/contracts';
import { Option, Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeMutation, storeQuery } from '#server/platform/definitions/define-store';

import { makeArchive } from './archive.ts';
import { makeAttach } from './attach.ts';
import { makeCreateVersion } from './create-version.ts';
import { makeCreate } from './create.ts';
import { makeDeleteDraft } from './delete-draft.ts';
import { makeDetach } from './detach.ts';
import { makeGet } from './get.ts';
import { makeList } from './list.ts';
import { makePublishVersion } from './publish-version.ts';
import { makeRename } from './rename.ts';
import { makeReorder } from './reorder.ts';
import { makeReplaceDraft } from './replace-draft.ts';
import { makeSetCitations } from './set-citations.ts';
import { makeUnarchive } from './unarchive.ts';

export function makeMaterialsStore(resources: StoreResources) {
  const { archive } = makeArchive(resources);

  const { attach } = makeAttach(resources);

  const { create } = makeCreate(resources);

  const { createVersion } = makeCreateVersion(resources);

  const { deleteDraft } = makeDeleteDraft(resources);

  const { detach } = makeDetach(resources);

  const { get } = makeGet(resources);

  const { list, count } = makeList(resources);

  const { publishVersion } = makePublishVersion(resources);

  const { rename, updateDescription } = makeRename(resources);

  const { reorder } = makeReorder(resources);

  const { replaceDraft } = makeReplaceDraft(resources);

  const { setCitations } = makeSetCitations(resources);

  const { unarchive } = makeUnarchive(resources);

  return {
    queries: {
      count: storeQuery({
        role: 'required',
        input: input.materialCountInputSchema,
        output: Schema.BigInt,
        run: count
      }),
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
        output: input.materialListPageSchema,
        run: list
      })
    },
    mutations: {
      create: storeMutation({
        changes: ['materials'],
        input: input.createInputSchema,
        output: materialDetailSchema,
        run: create
      }),
      createVersion: storeMutation({
        changes: ['materials'],
        input: input.createVersionInputSchema,
        output: materialVersionDetailSchema,
        run: createVersion
      }),
      archive: storeMutation({
        changes: ['materials'],
        input: input.archiveInputSchema,
        output: materialDetailSchema,
        run: archive
      }),
      unarchive: storeMutation({
        changes: ['materials'],
        input: input.unarchiveInputSchema,
        output: materialDetailSchema,
        run: unarchive
      }),
      updateDescription: storeMutation({
        changes: ['materials'],
        input: input.updateDescriptionInputSchema,
        output: materialDetailSchema,
        run: updateDescription
      }),
      rename: storeMutation({
        changes: ['materials'],
        input: input.renameInputSchema,
        output: materialDetailSchema,
        run: rename
      }),
      deleteDraft: storeMutation({
        changes: ['materials'],
        input: input.deleteDraftInputSchema,
        output: input.deleteDraftInputSchema,
        run: deleteDraft
      }),
      publishVersion: storeMutation({
        changes: ['materials'],
        input: input.publishVersionInputSchema,
        output: materialVersionDetailSchema,
        run: publishVersion
      }),
      replaceDraft: storeMutation({
        changes: ['materials'],
        input: input.replaceDraftInputSchema,
        output: materialVersionDetailSchema,
        run: replaceDraft
      }),
      setCitations: storeMutation({
        changes: ['materials'],
        input: input.setCitationsInputSchema,
        output: Schema.Array(materialCitationSchema),
        run: setCitations
      }),
      attach: storeMutation({
        changes: ['materials'],
        input: input.attachInputSchema,
        output: input.attachInputSchema,
        run: attach
      }),
      detach: storeMutation({
        changes: ['materials'],
        input: input.detachInputSchema,
        output: input.detachInputSchema,
        run: detach
      }),
      reorder: storeMutation({
        changes: ['materials'],
        input: input.reorderInputSchema,
        output: Schema.Struct({ materialIds: input.reorderInputSchema.fields.materialIds }),
        run: reorder
      })
    }
  };
}
