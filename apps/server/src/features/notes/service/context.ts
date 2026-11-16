/** @file Owns context within this feature. */

import type {
  ContentInput,
  captureNoteContextSchema,
  noteContextIntentSchema,
  updateNoteSelectionSchema
} from '@study/contracts';
import { StudyError, resolvedSelectionSchema, selectionReferenceKey } from '@study/contracts';
import { Option, Schema } from 'effect';

import { NoteContextStore } from '#server/features/notes/store/context';
import { NoteContextIntentStore } from '#server/features/notes/store/context-intents';
import { RetainedNoteContextStore } from '#server/features/notes/store/context-retention';
import { NoteStore } from '#server/features/notes/store/index';
import { NoteSelectionStore } from '#server/features/notes/store/selection';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { activeNoteTargets } from './active-inputs.ts';
import { resolveSelection } from './selection.ts';

function resolveTargets(tx: Transaction, targets: typeof updateNoteSelectionSchema.Type.targets) {
  if (new Set(targets.map((target) => selectionReferenceKey(target.input))).size !== targets.length)
    throw new StudyError('invalid_input', 'Duplicate selected version');

  const resolved = targets.map((target) => resolveSelection(tx, target));

  if (resolved.reduce((sum, item) => sum + item.excerpts.length, 0) > 200)
    throw new StudyError('not_enough', 'Active note context has too many passages');

  if (
    resolved.reduce(
      (sum, item) => sum + item.excerpts.reduce((n, excerpt) => n + excerpt.text.length, 0),
      0
    ) > 100000
  )
    throw new StudyError('not_enough', 'Active note context exceeds limit');

  return resolved;
}

export function captureContext(
  tx: Transaction,
  input: typeof noteContextIntentSchema.Type,
  requestId: string,
  deferPendingAttachments = false
) {
  const store = tx.store(NoteContextStore);

  const existing = tx.store(NoteContextIntentStore).findNoteContextIntent(input);

  if (Option.isSome(existing)) {
    for (const target of existing.value.inputs) assertCapturedTarget(tx, target);

    return existing.value;
  }

  const ids = [input.noteId, ...(input.additionalNoteIds ?? [])];

  if (
    new Set(ids).size !== ids.length ||
    (ids.length > 1 && (input.threadRoot !== undefined || input.throughMessageId !== undefined))
  )
    throw new StudyError('invalid_input', 'Combined capture requires distinct whole notes');

  const targets = ids.flatMap((noteId) =>
    activeNoteTargets(tx, noteId, { ...input, deferPendingAttachments })
  );
  const inputs = input.additionalNoteIds
    ? resolveCombinedTargets(tx, targets)
    : resolveTargets(tx, targets);

  return store.capture({ ...input, requestId, inputs });
}

/** Union exact selected passages without duplicating shared source versions. */
function resolveCombinedTargets(
  tx: Transaction,
  targets: typeof updateNoteSelectionSchema.Type.targets
) {
  const grouped = new Map<string, (typeof resolvedSelectionSchema.Type)[]>();

  for (const target of targets) {
    const resolved = resolveSelection(tx, target);
    const key = selectionReferenceKey(target.input);

    grouped.set(key, [...(grouped.get(key) ?? []), resolved]);
  }

  return resolveTargets(
    tx,
    [...grouped.values()].map((items) => {
      const whole = items.find((item) => item.scope.kind === 'document');

      if (whole) return whole;

      if (items.length === 1) return items[0]!;

      const first = items[0]!;

      if (items.every((item) => item.scope.kind === 'blocks')) {
        const blockIds = [
          ...new Set(
            items.flatMap((item) => (item.scope.kind === 'blocks' ? item.scope.blockIds : []))
          )
        ];

        return {
          input: first.input,
          scope: { kind: 'blocks' as const, blockIds }
        };
      }

      const ranges = [
        ...new Map(
          items
            .flatMap((item) =>
              item.excerpts.map((excerpt) => ({
                blockId: excerpt.blockId,
                start: excerpt.start,
                end: excerpt.end
              }))
            )
            .map((range) => [`${range.blockId}:${range.start}:${range.end}`, range])
        ).values()
      ];

      return {
        input: first.input,
        scope: { kind: 'ranges' as const, ranges }
      };
    })
  );
}

const resolvedCodec = Schema.fromJsonString(Schema.toCodecJson(resolvedSelectionSchema));

export function assertCapturedTarget(tx: Transaction, target: typeof resolvedSelectionSchema.Type) {
  const resolved = resolveSelection(tx, target);

  if (
    Schema.encodeSync(resolvedCodec)({ ...resolved, name: target.name }) !==
    Schema.encodeSync(resolvedCodec)(target)
  )
    throw new StudyError('not_found', 'Captured exact content is unavailable');
}

/** Availability checked immutable context, composed inside another feature transaction. */

export function inputIsCurrent(tx: Transaction, input: ContentInput) {
  if (input.kind === 'page') {
    const version = Pages.versionInTransaction(tx, input.versionId);

    return Pages.pageInTransaction(tx, { id: version.pageId }).headVersionId === version.id;
  }

  const current = Sources.currentExtractionInTransaction(tx, input.sourceId);

  return (
    current !== null &&
    current.revision === input.revision &&
    current.snapshotId === input.snapshotId
  );
}

export function readCapturedContext(tx: Transaction, requestId: string) {
  const snapshot = tx.store(NoteContextStore).noteContext({ requestId });

  tx.store(NoteStore).note(snapshot.noteId);

  for (const target of snapshot.inputs) assertCapturedTarget(tx, target);

  return snapshot;
}

export function* noteContextOperations() {
  const selections = yield* useStore(NoteSelectionStore);

  const retainedContexts = yield* useStore(RetainedNoteContextStore);

  return {
    noteSelection: selections.noteSelection,
    updateNoteSelection: (input: typeof updateNoteSelectionSchema.Type) =>
      transaction((tx) => {
        resolveTargets(tx, input.targets);

        return tx.store(NoteSelectionStore).updateSelection(input);
      }),
    captureNoteContext: (input: typeof captureNoteContextSchema.Type) =>
      transaction((tx) => captureContext(tx, input, crypto.randomUUID())),
    inspectNoteContext: retainedContexts.retainedNoteContext,
    noteContext: (input: { requestId: string }) =>
      transaction((tx) => {
        const snapshot = tx.store(NoteContextStore).noteContext(input);

        for (const target of snapshot.inputs) assertCapturedTarget(tx, target);

        return snapshot;
      })
  };
}
