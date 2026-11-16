/** @file Owns editing within this feature. */

import type * as e from '@study/contracts';
import type * as r from '@study/contracts';
import type { NoteId } from '@study/contracts';

import { PagesStore } from '#server/features/pages/store/index';
import { Sources } from '#server/features/sources/index';
import { transaction } from '#server/platform/definitions/define-store';

import { created, edited } from './publication.ts';

export function pageEditingOperations() {
  return {
    updateMetadata: (v: typeof r.metadataSchema.Type) =>
      transaction((tx) => tx.store(PagesStore).updateMetadata(v)),
    create: (v: typeof e.createSchema.Type) =>
      transaction((tx) => created(tx, tx.store(PagesStore).create(v))),
    saveInNote: (noteId: NoteId, v: typeof e.saveSchema.Type) =>
      transaction((tx) => {
        tx.store(PagesStore).page({ noteId, id: v.pageId });

        return edited(tx, tx.store(PagesStore).save(v));
      }),
    save: (v: typeof e.saveSchema.Type) =>
      transaction((tx) => edited(tx, tx.store(PagesStore).save(v))),
    restore: (v: typeof e.restoreSchema.Type) =>
      transaction((tx) => edited(tx, tx.store(PagesStore).restore(v))),
    copySource: (v: typeof r.sourceCopySchema.Type) =>
      transaction((tx) => {
        Sources.extractionInTransaction(tx, v);

        return created(tx, tx.store(PagesStore).copySource(v));
      }),
    archive: (v: typeof r.archiveSchema.Type) =>
      transaction((tx) => tx.store(PagesStore).archive(v)),
    attachProject: (v: typeof r.projectLinkSchema.Type) =>
      transaction((tx) => tx.store(PagesStore).attachProject(v)),
    detachProject: (v: typeof r.projectLinkSchema.Type) =>
      transaction((tx) => tx.store(PagesStore).detachProject(v)),
    attach: (v: typeof r.linkSchema.Type) => transaction((tx) => tx.store(PagesStore).attach(v)),
    detach: (v: typeof r.linkSchema.Type) => transaction((tx) => tx.store(PagesStore).detach(v))
  };
}
