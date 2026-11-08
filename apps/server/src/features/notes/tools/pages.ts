/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes authored page tools and their agent usage guides.                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses canonical feature services and schema-checked operations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Persistence policy remains in the owning feature service.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as e from '@study/contracts/pages/editing';
import * as r from '@study/contracts/pages/rpc';
import * as s from '@study/contracts/pages/schemas';
import { Effect, Schema } from 'effect';

import { Notes } from '#server/features/notes/index';
import { Pages } from '#server/features/pages/index';
import { defineTool } from '#server/platform/definitions/define-agent';

export const pageTools = {
  list_pages: defineTool({
    description: 'List authored pages with subject, note and archive filters.',
    wiki: {
      when: 'Find pages and their exact IDs.',
      examples: ['Find my biology notes.'],
      limits:
        'At most 100 per page. Pass nextCursor as cursor until null. Sources and chat messages are separate content.'
    },
    input: r.listSchema,
    output: s.pageListSchema,
    mutates: false,
    execute: (input: typeof r.listSchema.Type) =>
      Pages.use((service) => service.pages(input)).pipe(Effect.provide(Pages.layer))
  }),
  read_page: defineTool({
    description: 'Read page metadata and the current anchored body.',
    wiki: {
      when: 'Inspect content and current version before editing.',
      examples: ['Read my photosynthesis page.'],
      limits:
        'Use a listed page ID. Head version may be null; preserve anchors and citations when editing.'
    },
    input: r.pageKeySchema,
    output: s.detailSchema,
    mutates: false,
    execute: (input: typeof r.pageKeySchema.Type) =>
      Pages.use((service) => service.page(input)).pipe(Effect.provide(Pages.layer))
  }),
  create_page: defineTool({
    description: 'Create an authored page with a reusable creation key.',
    wiki: {
      when: 'The user asks to write and save a page.',
      examples: ['Create a study guide about cell division.'],
      limits:
        'Use a stable createKey for retries of one intent, and a new key for a different intent. Supply canonical anchored blocks and truthful exact inputs/citations, using empty evidence arrays for original prose. Optional projectId and noteId link existing entities.'
    },
    input: e.createSchema,
    output: s.detailSchema,
    mutates: true,
    execute: (input: typeof e.createSchema.Type) =>
      Effect.gen(function* () {
        if (input.noteId !== undefined) yield* (yield* Notes).notebookNote(input.noteId);

        return yield* (yield* Pages).create(input);
      }).pipe(Effect.provide(Pages.layer), Effect.provide(Notes.layer))
  }),
  save_page: defineTool({
    description: 'Save a new authored body against the version last read.',
    wiki: {
      when: 'Edit the body of an existing page.',
      examples: ['Add a worked example to my notes.'],
      limits:
        'Read the page first and send its head version as expectedVersionId. Preserve block IDs for retained content. Reuse key only for retries of this exact edit. A conflict retains the submitted version but does not replace the current head; inspect both versions before reconciling.'
    },
    input: e.saveSchema,
    output: e.editOutcomeSchema,
    mutates: true,
    execute: (input: typeof e.saveSchema.Type) =>
      Pages.use((service) => service.save(input)).pipe(Effect.provide(Pages.layer))
  }),
  update_page_metadata: defineTool({
    description: 'Update page title and description with optimistic checks.',
    wiki: {
      when: 'Rename a page or change its description.',
      examples: ['Rename my notes to Cellular Biology.'],
      limits:
        'Read current title/description first and supply expectedTitle/expectedDescription. Preserve any field the user did not request changing. A conflict requires rereading.'
    },
    input: r.metadataSchema,
    output: s.detailSchema,
    mutates: true,
    execute: (input: typeof r.metadataSchema.Type) =>
      Pages.use((service) => service.updateMetadata(input)).pipe(Effect.provide(Pages.layer))
  }),
  archive_page: defineTool({
    description: 'Archive or unarchive a page.',
    wiki: {
      when: 'Change whether a page appears among active pages.',
      examples: ['Archive my old revision notes.'],
      limits:
        'Resolve the exact page first. Archiving preserves body and history; archived pages can be listed with archived=true.'
    },
    input: r.archiveSchema,
    output: s.detailSchema,
    mutates: true,
    execute: (input: typeof r.archiveSchema.Type) =>
      Pages.use((service) => service.archive(input)).pipe(Effect.provide(Pages.layer))
  }),
  list_page_versions: defineTool({
    description: 'List immutable page versions.',
    wiki: {
      when: 'Inspect history before comparing or restoring an edit.',
      examples: ['Show earlier versions of my notes.'],
      limits: 'At most 100 per page; pass nextCursor as cursor. Retired bodies may be unavailable.'
    },
    input: r.versionsSchema,
    output: s.versionPageSchema,
    mutates: false,
    execute: (input: typeof r.versionsSchema.Type) =>
      Pages.use((service) => service.versions(input)).pipe(Effect.provide(Pages.layer))
  }),
  read_page_version: defineTool({
    description: 'Read a specific immutable page version.',
    wiki: {
      when: 'Inspect the complete body and evidence of an earlier version.',
      examples: ['Read the version before my last edit.'],
      limits: 'Use exact version IDs from page history. Does not change the current version.'
    },
    input: r.versionKeySchema,
    output: s.versionSchema,
    mutates: false,
    execute: (input: typeof r.versionKeySchema.Type) =>
      Pages.use((service) => service.version(input)).pipe(Effect.provide(Pages.layer))
  }),
  restore_page_version: defineTool({
    description: 'Restore an earlier page body as a new version.',
    wiki: {
      when: 'The user requests undoing a page edit.',
      examples: ['Restore my notes to the previous version.'],
      limits:
        'Read the current head and version history first. Requires expectedVersionId and a stable key. Handle conflicts explicitly; restoration retains history.'
    },
    input: e.restoreSchema,
    output: e.editOutcomeSchema,
    mutates: true,
    execute: (input: typeof e.restoreSchema.Type) =>
      Pages.use((service) => service.restore(input)).pipe(Effect.provide(Pages.layer))
  }),
  link_page_subject: defineTool({
    description: 'Link an existing page to a subject.',
    wiki: {
      when: 'The user requests changing a page’s subject membership.',
      examples: ['Link my biology notes to this subject.'],
      limits:
        'Resolve both exact IDs first. Membership changes preserve the page body. Repeating the same change is safe.'
    },
    input: r.projectLinkSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof r.projectLinkSchema.Type) =>
      Pages.use((service) => service.attachProject(input)).pipe(
        Effect.as(true),
        Effect.provide(Pages.layer)
      )
  }),
  unlink_page_subject: defineTool({
    description: 'Unlink an existing page from a subject.',
    wiki: {
      when: 'The user requests changing a page’s subject membership.',
      examples: ['Unlink my biology notes from this subject.'],
      limits:
        'Resolve both exact IDs first. Membership changes preserve the page body. Repeating the same change is safe.'
    },
    input: r.projectLinkSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof r.projectLinkSchema.Type) =>
      Pages.use((service) => service.detachProject(input)).pipe(
        Effect.as(true),
        Effect.provide(Pages.layer)
      )
  }),
  link_page_note: defineTool({
    description: 'Link an existing page to a note.',
    wiki: {
      when: 'The user requests changing a page’s note membership.',
      examples: ['Link my biology notes to this note.'],
      limits:
        'Resolve both exact IDs first. Membership changes preserve the page body. Repeating the same change is safe.'
    },
    input: r.linkSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof r.linkSchema.Type) =>
      Effect.gen(function* () {
        yield* (yield* Notes).notebookNote(input.noteId);

        return yield* (yield* Pages).attach(input);
      }).pipe(Effect.as(true), Effect.provide(Pages.layer), Effect.provide(Notes.layer))
  }),
  unlink_page_note: defineTool({
    description: 'Unlink an existing page from a note.',
    wiki: {
      when: 'The user requests changing a page’s note membership.',
      examples: ['Unlink my biology notes from this note.'],
      limits:
        'Resolve both exact IDs first. Membership changes preserve the page body. Repeating the same change is safe.'
    },
    input: r.linkSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input: typeof r.linkSchema.Type) =>
      Effect.gen(function* () {
        yield* (yield* Notes).notebookNote(input.noteId);

        return yield* (yield* Pages).detach(input);
      }).pipe(Effect.as(true), Effect.provide(Pages.layer), Effect.provide(Notes.layer))
  })
} as const;
