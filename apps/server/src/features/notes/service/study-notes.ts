/** @file Prepares standalone study notes using retained notebook and material evidence. */
import { StudyError } from '@study/contracts';
import type {
  pageTransformContextSchema,
  ProjectId,
  studyNotesRequestSchema,
  transformKeySchema,
  transformPublicationSchema,
  transformSnapshotSchema
} from '@study/contracts';
import { publicationTransaction, transaction } from '@study/server';
import type { Transaction } from '@study/server';

import { Pages } from '#server/features/pages/index';
import { Sources } from '#server/features/sources/index';

import { studyContext } from './study-evidence.ts';

type StudyNotes = typeof studyNotesRequestSchema.Type;

type Context = typeof pageTransformContextSchema.Type;

type DocumentInput = Exclude<StudyNotes['inputs'][number], { kind: 'note' }>;

function exactDocument(tx: Transaction, input: DocumentInput, projectId: ProjectId) {
  if (input.kind === 'source') {
    if (!Sources.belongsToProjectInTransaction(tx, input.sourceId, projectId))
      throw new StudyError('invalid_input', 'Material is outside the requested subject');

    return { ...Sources.extractionInTransaction(tx, input), pageId: null };
  }

  const version = Pages.versionInTransaction(tx, input.versionId);
  const page = Pages.pageInTransaction(tx, { id: version.pageId });

  if (
    !page.projectIds.includes(projectId) ||
    page.archivedAt !== null ||
    version.status !== 'published'
  )
    throw new StudyError('invalid_input', 'Select an active page in the requested subject');

  return { ...version, name: page.title };
}

function fullDocument(tx: Transaction, input: DocumentInput, projectId: ProjectId) {
  const exact = exactDocument(tx, input, projectId);
  const excerpts = Pages.wholeDocumentExcerpts(exact.document);

  if (!excerpts.length) throw new StudyError('invalid_input', 'Study evidence has no text');

  return {
    input,
    scope: { kind: 'document' as const },
    name: exact.name,
    pageId: exact.pageId,
    snapshotId: exact.snapshotId,
    document: exact.document,
    excerpts
  };
}

export function studyNotesContext(
  tx: Transaction,
  request: typeof transformSnapshotSchema.Type
): Context {
  const settings = request.studyNotes;

  if (!settings) throw new StudyError('invalid_input', 'Study notes request expected');

  const inputs: Context['inputs'][number][] = [];
  const messages: Context['messages'][number][] = [];

  for (const input of settings.inputs) {
    if (input.kind === 'note')
      messages.push(...studyContext(tx, input, settings.projectId).messages);
    else inputs.push(fullDocument(tx, input, settings.projectId));
  }

  const size =
    messages.reduce((count, message) => count + message.text.length, 0) +
    inputs.reduce(
      (count, input) => count + input.excerpts.reduce((n, excerpt) => n + excerpt.text.length, 0),
      0
    );

  if (size === 0 || size > 200000)
    throw new StudyError('not_enough', 'Study evidence is empty or exceeds the generation limit');

  return {
    requestId: request.contextRequestId,
    noteId: null,
    intentKey: settings.key,
    instruction: request.instruction,
    preferences: { language: settings.language },
    selectionRevision: 0n,
    inputs,
    messages,
    excludedMessages: 0
  };
}

export const studyNotesOperations = {
  generateStudyNotes: (settings: StudyNotes) =>
    transaction((tx) => {
      const { created, request } = Pages.requestStudyNotesInTransaction(tx, settings);

      if (created) studyNotesContext(tx, request);

      return request;
    }),
  studyNotesContext: (input: typeof transformKeySchema.Type) =>
    transaction((tx) => studyNotesContext(tx, Pages.transformInTransaction(tx, input))),
  publishStudyNotes: (input: typeof transformPublicationSchema.Type) =>
    publicationTransaction((tx) => {
      const request = Pages.transformInTransaction(tx, input);
      const context = request.resultVersionId === null ? studyNotesContext(tx, request) : undefined;

      return Pages.publishTransformInTransaction(tx, context, input);
    })
};
