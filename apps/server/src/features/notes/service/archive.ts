/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Collects archived note items through bounded transactional store reads.            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves complete archive results while respecting store pagination limits.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The owning note transaction supplies persistence access and note identity.               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { NoteId } from '@study/contracts';
import type { ArchivedNoteItem } from '@study/contracts';
import type { Transaction } from '@study/server';

import { NoteArchiveStore } from '#server/features/notes/store/archive';

/** Iterate bounded archive reads within one SQLite snapshot; no archived item is hidden by a cap. */
export function allArchivedItems(tx: Transaction, noteId: NoteId) {
  const items: ArchivedNoteItem[] = [];
  const limit = 100;
  let offset = 0;

  for (;;) {
    const page = tx.store(NoteArchiveStore).archivedItems({ noteId, limit, offset });

    items.push(...page);

    if (page.length < limit) return items;

    offset += limit;
  }
}
