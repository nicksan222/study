/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Publishes imported notes and documents with atomic identity receipts.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reserves destinations and publishes original source content.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only public feature participants access note document and source persistence.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type {
  integrationImportSchema,
  integrationPlanSchema,
  integrationNoteSchema
} from '@study/contracts/integrations/schemas';
import { CryptoHasher } from 'bun';
import { Option } from 'effect';

import {
  IntegrationNotesStore,
  IntegrationContentStore
} from '#server/features/integrations/store/content';
import { IntegrationReceiptsStore } from '#server/features/integrations/store/receipts';
import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';

type State = typeof integrationImportSchema.Type;

type Note = typeof integrationNoteSchema.Type;

const hash = (value: string) => new CryptoHasher('sha256').update(value).digest('hex');

const identity = (state: State, key: string) =>
  hash(JSON.stringify([state.providerId, state.sourceKey, String(state.projectId), key]));

/** Hash original files once, including shared attachments, before opening the staging transaction. */
export function importFingerprints(plan: typeof integrationPlanSchema.Type) {
  const files = new Map(plan.files.map((file) => [file.path, hash(file.content)]));

  return Object.fromEntries(
    plan.notes.map((note) => [
      note.key,
      hash(
        JSON.stringify([
          note,
          [note.key, ...note.attachments].map((path) => [path, files.get(path)])
        ])
      )
    ])
  );
}

/** Link destination availability is part of fidelity, even when original bytes are unchanged. */
function resolvedFingerprint(state: State, note: Note, content: string) {
  const destinations = note.links.map((link) => {
    const target = state.items.find(
      (item) => item.key === link.target && item.status !== 'excluded'
    );

    return [link.target, target?.noteId?.toString() ?? null];
  });

  return hash(JSON.stringify([content, destinations]));
}

function reserveDestinations(tx: Transaction, state: State): State {
  const receipts = tx.store(IntegrationReceiptsStore);

  return {
    ...state,
    items: state.items.map((item) => {
      if (item.status !== 'pending') return item;

      const previous = Option.getOrNull(receipts.findIntegrationReceipt(identity(state, item.key)));

      if (previous) return { ...item, noteId: previous.noteId };

      const note = Notes.createNoteInTransaction(tx, {
        title: item.title,
        project: state.projectId ?? undefined
      });

      receipts.retain({
        identity: identity(state, item.key),
        fingerprint: '',
        importId: state.id,
        noteId: note.id,
        pageId: null
      });

      return { ...item, noteId: note.id };
    })
  };
}

/** Reserve all destinations before comparing link fidelity or publishing any note. */
export function reserveImport(tx: Transaction, input: State): State {
  const state = reserveDestinations(tx, input);
  const receipts = tx.store(IntegrationReceiptsStore);

  return {
    ...state,
    items: state.items.map((item) => {
      if (item.status !== 'pending') return item;

      const { note, fingerprint } = tx
        .store(IntegrationNotesStore)
        .integrationNote({ id: state.id, key: item.key });
      const previous = Option.getOrNull(receipts.findIntegrationReceipt(identity(state, item.key)));

      if (!previous) throw new StudyError('internal', 'Import reservation is unavailable');

      const expected = resolvedFingerprint(state, note, fingerprint);

      if (previous.importId === state.id && previous.noteId) {
        receipts.retain({ ...previous, fingerprint: expected });

        return item;
      }

      const unchanged =
        previous.fingerprint === expected && previous.noteId !== null && previous.pageId !== null;

      return { ...item, status: unchanged ? ('unchanged' as const) : ('conflict' as const) };
    })
  };
}

function linkedText(note: Note, state: State) {
  let text = note.text;

  for (const link of [...note.links].sort((a, b) => b.start - a.start)) {
    const target = state.items.find((item) => item.key === link.target);

    if (!target?.noteId || target.status === 'excluded') continue;

    const label = link.label.replaceAll('[', '\\[').replaceAll(']', '\\]');
    const replacement = `[${label}](/note/${target.noteId}${link.fragment ? `#${encodeURIComponent(link.fragment)}` : ''})`;

    text = text.slice(0, link.start) + replacement + text.slice(link.end);
  }

  return text;
}

/** Read only this note and its files; commit content, shared sources and receipt atomically. */
export function publishImportItem(tx: Transaction, state: State, key: string): State {
  const item = state.items.find((entry) => entry.key === key);

  if (!item || item.status !== 'pending') return state;

  if (!item.noteId) throw new StudyError('invalid_input', 'Import destination is unavailable');

  const content = tx.store(IntegrationContentStore).integrationContent({ id: state.id, key });
  const sources = content.files.map((file) => {
    const source = file.sourceId
      ? Sources.sourceInTransaction(tx, file.sourceId)
      : Sources.createImportedInTransaction(tx, {
          name: file.path.split('/').at(-1)!,
          bytes: Buffer.from(file.content, 'base64'),
          projectId: state.projectId
        });

    tx.store(IntegrationContentStore).retainSource({
      id: state.id,
      path: file.path,
      sourceId: source.id
    });

    return source;
  });

  Notes.postMessageInTransaction(tx, {
    noteId: item.noteId,
    text: '',
    sourceIds: sources.map((source) => source.id),
    requestReply: false
  });

  const document = Sources.decodeImportedMarkdown(
    new TextEncoder().encode(linkedText(content.note, state))
  );
  const authored = Pages.createInTransaction(tx, {
    createKey: `integration:${state.id}:${hash(key)}`,
    title: content.note.title,
    document,
    inputs: sources.map((source) => ({
      kind: 'source' as const,
      sourceId: source.id,
      revision: 1n,
      snapshotId: null
    })),
    citations: [],
    noteId: item.noteId,
    projectId: state.projectId ?? undefined
  });

  tx.store(IntegrationReceiptsStore).retain({
    identity: identity(state, key),
    fingerprint: resolvedFingerprint(state, content.note, content.fingerprint),
    importId: state.id,
    noteId: item.noteId,
    pageId: authored.id
  });

  return {
    ...state,
    items: state.items.map((entry) =>
      entry.key === key ? { ...entry, status: 'imported' } : entry
    )
  };
}
