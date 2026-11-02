/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Shares exact Document pin checks and obsolete body removal.                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps whole-Material and historical cleanup on the same owning writer.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers prove accepted scope and protect current processing roots before removal.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { DocumentId } from '@study/contracts/ids';
import { eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeDocumentRetirement({ db }: StoreResources) {
  function hasVersionPin(documentId: DocumentId) {
    return (
      db.orm
        .select({ id: s.material_source_snapshots.version_id })
        .from(s.material_source_snapshots)
        .where(eq(s.material_source_snapshots.document_id, documentId))
        .get() !== undefined ||
      db.orm
        .select({ id: s.material_document_versions.version_id })
        .from(s.material_document_versions)
        .where(eq(s.material_document_versions.document_id, documentId))
        .get() !== undefined
    );
  }

  function removeDocument(documentId: DocumentId) {
    db.orm.delete(s.blocks).where(eq(s.blocks.document_id, documentId)).run();
    db.orm.delete(s.documents).where(eq(s.documents.id, documentId)).run();
  }

  return { hasVersionPin, removeDocument };
}
