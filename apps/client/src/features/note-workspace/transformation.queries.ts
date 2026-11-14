import { StudyError } from '@study/contracts/errors';
import type { NoteId } from '@study/contracts/ids';
import { Atom } from 'effect/reactivity';

import { captureContext, transformPage } from './note-workspace.queries';
import type { TransformInput } from './note-workspace.queries';

export type Attempt = {
  key: string;
  additionalNoteIds?: readonly NoteId[];
  revision: bigint;
  title: string;
  instruction: string;
  operations: TransformInput['operations'];
  language: 'english' | 'italian';
};

export type TransformDraft = {
  title: string;
  instruction: string;
  titleRevision?: number;
  instructionRevision?: number;
  operations: TransformInput['operations'];
  attempt?: Attempt;
  pending?: boolean;
  unavailable?: boolean;
  requestId?: string;
  contextId?: string;
  retryId?: string;
  runs?: { id: string; contextId: string }[];
};

const drafts = Atom.family((_scope: string) =>
  Atom.make<TransformDraft>({ title: '', instruction: '', operations: ['clarity'] }).pipe(
    Atom.keepAlive
  )
);

export function transformDraft(id: NoteId, additionalNoteIds: readonly NoteId[] = []) {
  return drafts([String(id), ...[...new Set(additionalNoteIds)].map(String).toSorted()].join(':'));
}

export const transformRetry = Atom.family((_requestId: string) =>
  Atom.make<{ key: string; acknowledged: boolean } | null>(null).pipe(Atom.keepAlive)
);

export async function runTransformAttempt(
  id: NoteId,
  attempt: Attempt,
  captured: (contextId: string) => void,
  received: (result: Awaited<ReturnType<typeof transformPage>>, contextId: string) => void
) {
  const context = await captureContext({
    noteId: id,
    additionalNoteIds: attempt.additionalNoteIds?.length ? attempt.additionalNoteIds : undefined,
    intentKey: attempt.key,
    instruction: attempt.instruction,
    preferences: { language: attempt.language }
  });

  if (context.selectionRevision !== attempt.revision)
    throw new StudyError('invalid_input', 'Selection changed before capture');

  captured(context.requestId);
  const result = await transformPage({
    contextRequestId: context.requestId,
    operations: attempt.operations,
    title: attempt.title
  });

  received(result, context.requestId);

  return result;
}
