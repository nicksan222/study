/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Publishes imported sessions and documents with atomic identity receipts.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reserves destinations and publishes original source content.                           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only public feature participants access conversation document and source persistence.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type {
  integrationImportSchema,
  integrationPlanSchema,
  integrationSessionSchema
} from '@study/contracts/integrations/schemas';
import { Option } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import {
  IntegrationNotesStore,
  IntegrationContentStore
} from '#server/features/integrations/store/content';
import { IntegrationReceiptsStore } from '#server/features/integrations/store/receipts';
import { Sources } from '#server/features/sources/index';
import type { Transaction } from '#server/platform/definitions/define-store';

type State = typeof integrationImportSchema.Type;

type Note = typeof integrationSessionSchema.Type;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const identity = (state: State, key: string) =>
  hash(JSON.stringify([state.providerId, state.sourceKey, String(state.projectId), key]));

/** Hash original files once, including shared attachments, before opening the staging transaction. */
export function importFingerprints(plan: typeof integrationPlanSchema.Type) {
  const files = new Map(plan.files.map((file) => [file.path, hash(file.content)]));

  return Object.fromEntries(
    plan.sessions.map((note) => [
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

    return [link.target, target?.sessionId?.toString() ?? null];
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

      if (previous) return { ...item, sessionId: previous.sessionId };

      const session = Conversations.createSessionInTransaction(tx, {
        title: item.title,
        project: state.projectId ?? undefined
      });

      receipts.retain({
        identity: identity(state, item.key),
        fingerprint: '',
        importId: state.id,
        sessionId: session.id,
        documentId: null
      });

      return { ...item, sessionId: session.id };
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

      if (previous.importId === state.id && previous.sessionId) {
        receipts.retain({ ...previous, fingerprint: expected });

        return item;
      }

      const unchanged =
        previous.fingerprint === expected &&
        previous.sessionId !== null &&
        previous.documentId !== null;

      return { ...item, status: unchanged ? ('unchanged' as const) : ('conflict' as const) };
    })
  };
}

function linkedText(note: Note, state: State) {
  let text = note.text;

  for (const link of [...note.links].sort((a, b) => b.start - a.start)) {
    const target = state.items.find((item) => item.key === link.target);

    if (!target?.sessionId || target.status === 'excluded') continue;

    const label = link.label.replaceAll('[', '\\[').replaceAll(']', '\\]');
    const replacement = `[${label}](/session/${target.sessionId}${link.fragment ? `#${encodeURIComponent(link.fragment)}` : ''})`;

    text = text.slice(0, link.start) + replacement + text.slice(link.end);
  }

  return text;
}

/** Read only this note and its files; commit content, shared sources and receipt atomically. */
export function publishImportItem(tx: Transaction, state: State, key: string): State {
  const item = state.items.find((entry) => entry.key === key);

  if (!item || item.status !== 'pending') return state;

  if (!item.sessionId) throw new StudyError('invalid_input', 'Import destination is unavailable');

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

  Conversations.postMessageInTransaction(tx, {
    sessionId: item.sessionId,
    text: '',
    sourceIds: sources.map((source) => source.id),
    requestReply: false
  });

  const document = Sources.decodeImportedMarkdown(
    new TextEncoder().encode(linkedText(content.note, state))
  );
  const authored = Documents.createInTransaction(tx, {
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
    sessionId: item.sessionId,
    projectId: state.projectId ?? undefined
  });

  tx.store(IntegrationReceiptsStore).retain({
    identity: identity(state, key),
    fingerprint: resolvedFingerprint(state, content.note, content.fingerprint),
    importId: state.id,
    sessionId: item.sessionId,
    documentId: authored.id
  });

  return {
    ...state,
    items: state.items.map((entry) =>
      entry.key === key ? { ...entry, status: 'imported' } : entry
    )
  };
}
