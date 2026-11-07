/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reuses exact named notebook sessions in an atomic transaction.                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses canonical feature services and schema-checked operations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Persistence policy remains in the owning feature service.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { createSessionInputSchema } from '@study/contracts/conversations/rpc';
import type { sessionSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';

import { SessionStore } from '#server/features/conversations/store/index';
import { NotebookStore } from '#server/features/conversations/store/notebooks';
import { transaction } from '#server/platform/definitions/define-store';

/** Exact names are scoped to their subject; retries retain the earliest matching session. */
export const ensureSession = (input: typeof createSessionInputSchema.Type) =>
  transaction((tx) => {
    const title = input.title.trim();

    if (!title || [...title].length > 200)
      throw new StudyError('invalid_input', 'invalid session title');

    const store = tx.store(SessionStore);
    let before: { updatedAt: bigint; id: SessionId } | undefined;
    let existing: ReturnType<typeof store.session> | undefined;

    for (;;) {
      const page = store.sessions({ limit: 100, project: input.project ?? null, before });

      for (const session of page) existing = earlierMatch(title, existing, session);

      const last = page.at(-1);

      if (page.length < 100 || !last) break;

      before = { updatedAt: last.updatedAt, id: last.id };
    }

    return existing ?? store.createSession({ ...input, title, titleSource: 'user' });
  });

/** Agent notebook tools cannot inspect or mutate private Assistant conversations. */
export const notebookSession = (id: SessionId) =>
  transaction((tx) => {
    if (!tx.store(NotebookStore).notebook(id))
      throw new StudyError('not_found', 'Notebook session not found');

    return tx.store(SessionStore).session(id);
  });

function earlierMatch(
  title: string,
  existing: typeof sessionSchema.Type | undefined,
  candidate: typeof sessionSchema.Type
) {
  if (candidate.archivedAt !== null || candidate.title !== title) return existing;

  return !existing || candidate.id < existing.id ? candidate : existing;
}
