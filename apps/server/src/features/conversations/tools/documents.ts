/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes authored document tools and their agent usage guides.                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses canonical feature services and schema-checked operations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Persistence policy remains in the owning feature service.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as e from '@study/contracts/documents/editing';
import * as r from '@study/contracts/documents/rpc';
import * as s from '@study/contracts/documents/schemas';
import { Effect, Schema } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { defineTool } from '#server/platform/definitions/define-agent';

export const documentTools = {
  list_documents: defineTool({
    description: 'List authored documents with subject, session and archive filters.',
    wiki: {
      when: 'Find documents and their exact IDs.',
      examples: ['Find my biology notes.'],
      limits:
        'At most 100 per page. Pass nextCursor as cursor until null. Sources and chat messages are separate content.'
    },
    input: r.listSchema,
    output: s.documentPageSchema,
    mutates: false,
    execute: (input: typeof r.listSchema.Type) =>
      Effect.flatMap(Documents, (service) => service.documents(input)).pipe(
        Effect.provide(Documents.layer)
      )
  }),
  read_document: defineTool({
    description: 'Read document metadata and the current anchored body.',
    wiki: {
      when: 'Inspect content and current version before editing.',
      examples: ['Read my photosynthesis document.'],
      limits:
        'Use a listed document ID. Head version may be null; preserve anchors and citations when editing.'
    },
    input: r.documentKeySchema,
    output: s.detailSchema,
    mutates: false,
    execute: (input: typeof r.documentKeySchema.Type) =>
      Effect.flatMap(Documents, (service) => service.document(input)).pipe(
        Effect.provide(Documents.layer)
      )
  }),
  create_document: defineTool({
    description: 'Create an authored document with a reusable creation key.',
    wiki: {
      when: 'The user asks to write and save a document.',
      examples: ['Create a study guide about cell division.'],
      limits:
        'Use a stable createKey for retries of one intent, and a new key for a different intent. Supply canonical anchored blocks and truthful exact inputs/citations, using empty evidence arrays for original prose. Optional projectId and sessionId link existing entities.'
    },
    input: e.createSchema,
    output: s.detailSchema,
    mutates: true,
    execute: (input: typeof e.createSchema.Type) =>
      Effect.gen(function* () {
        if (input.sessionId !== undefined)
          yield* (yield* Conversations).notebookSession(input.sessionId);

        return yield* (yield* Documents).create(input);
      }).pipe(Effect.provide(Documents.layer), Effect.provide(Conversations.layer))
  }),
  save_document: defineTool({
    description: 'Save a new authored body against the version last read.',
    wiki: {
      when: 'Edit the body of an existing document.',
      examples: ['Add a worked example to my notes.'],
      limits:
        'Read the document first and send its head version as expectedVersionId. Preserve block IDs for retained content. Reuse key only for retries of this exact edit. A conflict retains the submitted version but does not replace the current head; inspect both versions before reconciling.'
    },
    input: e.saveSchema,
    output: e.editOutcomeSchema,
    mutates: true,
    execute: (input: typeof e.saveSchema.Type) =>
      Effect.flatMap(Documents, (service) => service.save(input)).pipe(
        Effect.provide(Documents.layer)
      )
  }),
  update_document_metadata: defineTool({
    description: 'Update document title and description with optimistic checks.',
    wiki: {
      when: 'Rename a document or change its description.',
      examples: ['Rename my notes to Cellular Biology.'],
      limits:
        'Read current title/description first and supply expectedTitle/expectedDescription. Preserve any field the user did not request changing. A conflict requires rereading.'
    },
    input: r.metadataSchema,
    output: s.detailSchema,
    mutates: true,
    execute: (input: typeof r.metadataSchema.Type) =>
      Effect.flatMap(Documents, (service) => service.updateMetadata(input)).pipe(
        Effect.provide(Documents.layer)
      )
  }),
  archive_document: defineTool({
    description: 'Archive or unarchive a document.',
    wiki: {
      when: 'Change whether a document appears among active documents.',
      examples: ['Archive my old revision notes.'],
      limits:
        'Resolve the exact document first. Archiving preserves body and history; archived documents can be listed with archived=true.'
    },
    input: r.archiveSchema,
    output: s.detailSchema,
    mutates: true,
    execute: (input: typeof r.archiveSchema.Type) =>
      Effect.flatMap(Documents, (service) => service.archive(input)).pipe(
        Effect.provide(Documents.layer)
      )
  }),
  list_document_versions: defineTool({
    description: 'List immutable document versions.',
    wiki: {
      when: 'Inspect history before comparing or restoring an edit.',
      examples: ['Show earlier versions of my notes.'],
      limits: 'At most 100 per page; pass nextCursor as cursor. Retired bodies may be unavailable.'
    },
    input: r.versionsSchema,
    output: s.versionPageSchema,
    mutates: false,
    execute: (input: typeof r.versionsSchema.Type) =>
      Effect.flatMap(Documents, (service) => service.versions(input)).pipe(
        Effect.provide(Documents.layer)
      )
  }),
  read_document_version: defineTool({
    description: 'Read a specific immutable document version.',
    wiki: {
      when: 'Inspect the complete body and evidence of an earlier version.',
      examples: ['Read the version before my last edit.'],
      limits: 'Use exact version IDs from document history. Does not change the current version.'
    },
    input: r.versionKeySchema,
    output: s.versionSchema,
    mutates: false,
    execute: (input: typeof r.versionKeySchema.Type) =>
      Effect.flatMap(Documents, (service) => service.version(input)).pipe(
        Effect.provide(Documents.layer)
      )
  }),
  restore_document_version: defineTool({
    description: 'Restore an earlier document body as a new version.',
    wiki: {
      when: 'The user requests undoing a document edit.',
      examples: ['Restore my notes to the previous version.'],
      limits:
        'Read the current head and version history first. Requires expectedVersionId and a stable key. Handle conflicts explicitly; restoration retains history.'
    },
    input: e.restoreSchema,
    output: e.editOutcomeSchema,
    mutates: true,
    execute: (input: typeof e.restoreSchema.Type) =>
      Effect.flatMap(Documents, (service) => service.restore(input)).pipe(
        Effect.provide(Documents.layer)
      )
  }),
  link_document_subject: defineTool({
    description: 'Link an existing document to a subject.',
    wiki: {
      when: 'The user requests changing a document’s subject membership.',
      examples: ['Link my biology notes to this subject.'],
      limits:
        'Resolve both exact IDs first. Membership changes preserve the document body. Repeating the same change is safe.'
    },
    input: r.projectLinkSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof r.projectLinkSchema.Type) =>
      Effect.flatMap(Documents, (service) => service.attachProject(input)).pipe(
        Effect.as(true),
        Effect.provide(Documents.layer)
      )
  }),
  unlink_document_subject: defineTool({
    description: 'Unlink an existing document from a subject.',
    wiki: {
      when: 'The user requests changing a document’s subject membership.',
      examples: ['Unlink my biology notes from this subject.'],
      limits:
        'Resolve both exact IDs first. Membership changes preserve the document body. Repeating the same change is safe.'
    },
    input: r.projectLinkSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof r.projectLinkSchema.Type) =>
      Effect.flatMap(Documents, (service) => service.detachProject(input)).pipe(
        Effect.as(true),
        Effect.provide(Documents.layer)
      )
  }),
  link_document_session: defineTool({
    description: 'Link an existing document to a session.',
    wiki: {
      when: 'The user requests changing a document’s session membership.',
      examples: ['Link my biology notes to this session.'],
      limits:
        'Resolve both exact IDs first. Membership changes preserve the document body. Repeating the same change is safe.'
    },
    input: r.linkSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof r.linkSchema.Type) =>
      Effect.gen(function* () {
        yield* (yield* Conversations).notebookSession(input.sessionId);

        return yield* (yield* Documents).attach(input);
      }).pipe(Effect.as(true), Effect.provide(Documents.layer), Effect.provide(Conversations.layer))
  }),
  unlink_document_session: defineTool({
    description: 'Unlink an existing document from a session.',
    wiki: {
      when: 'The user requests changing a document’s session membership.',
      examples: ['Unlink my biology notes from this session.'],
      limits:
        'Resolve both exact IDs first. Membership changes preserve the document body. Repeating the same change is safe.'
    },
    input: r.linkSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof r.linkSchema.Type) =>
      Effect.gen(function* () {
        yield* (yield* Conversations).notebookSession(input.sessionId);

        return yield* (yield* Documents).detach(input);
      }).pipe(Effect.as(true), Effect.provide(Documents.layer), Effect.provide(Conversations.layer))
  })
} as const;
