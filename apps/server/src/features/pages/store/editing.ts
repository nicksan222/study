/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists independent authored Pages with immutable versions and guarded heads.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists independent authored Pages with immutable versions and guarded heads.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createHash } from 'node:crypto';

import type { PageId } from '@study/contracts/ids';
import * as e from '@study/contracts/pages/editing';
import type * as r from '@study/contracts/pages/rpc';
import * as c from '@study/contracts/pages/schemas';
import type { Page, PageVersion } from '@study/contracts/pages/types';
import { documentDifferences } from '@study/contracts/sources/document';
import { blockIdSchema } from '@study/contracts/sources/schemas';
import { and, desc, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { intentHash } from '#server/features/pages/decoders/intent';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { invalid, required } from './errors.ts';
import { makePageEvidence } from './provenance.ts';
import { makePageReads } from './reads.ts';
import { makePageRevisions } from './revisions.ts';

type GeneratedMetadata = Pick<
  typeof e.createGeneratedSchema.Type,
  'operation' | 'instruction' | 'language'
>;

function creationMetadata(
  generated?: GeneratedMetadata
): Pick<PageVersion, 'operation' | 'creator' | 'instruction' | 'language'> {
  if (generated) return { ...generated, creator: 'agent' };

  return { operation: 'original', creator: 'user', instruction: null, language: null };
}

export function makePageEditing(resources: StoreResources) {
  const { db, clock } = resources;
  const reads = makePageReads(resources);
  const revisions = makePageRevisions(resources);
  const evidence = makePageEvidence(resources);

  const orm = db.orm;
  const now = () => unixSeconds(clock);
  const { aggregate, version, head, page, content } = reads;
  const { insertVersion, publish } = revisions;
  const { assertInput, assertCitations, assertBlockOwnership } = evidence;

  function attach(v: typeof r.linkSchema.Type) {
    aggregate(v.pageId);
    const last = orm
      .select()
      .from(s.note_pages)
      .where(eq(s.note_pages.note_id, v.noteId))
      .orderBy(desc(s.note_pages.position))
      .get();

    orm
      .insert(s.note_pages)
      .values({
        note_id: v.noteId,
        page_id: v.pageId,
        position: (last?.position ?? -1n) + 1n
      })
      .onConflictDoNothing()
      .run();

    for (const project of orm
      .select()
      .from(s.project_notes)
      .where(eq(s.project_notes.note_id, v.noteId))
      .all())
      orm
        .insert(s.project_pages)
        .values({ project_id: project.project_id, page_id: v.pageId })
        .onConflictDoNothing()
        .run();
  }

  function create(v: typeof e.createSchema.Type, generated?: GeneratedMetadata): Page {
    const hash = JSON.stringify(intentHash(e.createSchema, v));
    const replay = orm.select().from(s.pages).where(eq(s.pages.create_key, v.createKey)).get();

    if (replay) {
      if (generated) invalid('Generated creation key already belongs to an existing document');

      if (replay.creation_intent !== hash) invalid('Creation key already has another intent');

      return page(replay.id);
    }

    v.inputs.forEach((i) => assertInput(i));
    assertCitations(v.citations);
    assertBlockOwnership(v.document);
    const time = now();
    const a = orm
      .insert(s.pages)
      .values({
        title: v.title,
        create_key: v.createKey,
        creation_intent: hash,
        created_at: time,
        updated_at: time
      })
      .returning()
      .get();
    const metadata = creationMetadata(generated);
    const row = insertVersion(
      a.id,
      v.document,
      [],
      v.inputs,
      v.citations,
      metadata.operation,
      metadata.creator,
      metadata.instruction,
      metadata.language
    );

    publish(row.id);

    if (v.projectId !== undefined)
      orm.insert(s.project_pages).values({ project_id: v.projectId, page_id: a.id }).run();

    if (v.noteId !== undefined) attach({ pageId: a.id, noteId: v.noteId });

    return page(a.id);
  }

  function createResult(v: typeof e.createSchema.Type) {
    const replayed =
      orm
        .select({ id: s.pages.id })
        .from(s.pages)
        .where(eq(s.pages.create_key, v.createKey))
        .get() !== undefined;

    return { page: create(v), replayed };
  }

  function replayEdit(pageId: PageId, key: string, operation: 'save' | 'restore', intent: string) {
    aggregate(pageId);
    const receipt = orm
      .select()
      .from(s.page_edit_receipts)
      .where(and(eq(s.page_edit_receipts.page_id, pageId), eq(s.page_edit_receipts.key, key)))
      .get();

    if (!receipt) return;

    if (receipt.operation !== operation || receipt.intent !== intent)
      invalid('Edit key already has another intent');

    return {
      outcome: receipt.outcome,
      replayed: true,
      expectedVersionId: receipt.expected_version_id,
      currentVersionId: receipt.current_version_id,
      submittedVersionId: receipt.submitted_version_id
    };
  }

  function edit(
    v: typeof e.saveSchema.Type,
    operation: 'save' | 'restore',
    intent: string,
    sourceId = v.expectedVersionId
  ) {
    const replay = replayEdit(v.pageId, v.key, operation, intent);

    if (replay) return replay;

    const expected = version(v.expectedVersionId),
      source = version(sourceId),
      current = required(head(v.pageId));

    if (
      expected.pageId !== v.pageId ||
      source.pageId !== v.pageId ||
      expected.status !== 'published' ||
      source.status !== 'published'
    )
      invalid('Edit requires published history of the target document');

    assertBlockOwnership(v.document, v.pageId);
    const row = insertVersion(
      v.pageId,
      v.document,
      [expected.id, source.id],
      source.inputs,
      source.citations,
      operation === 'restore' ? 'restore' : 'edit',
      'user',
      null,
      source.language
    );
    const outcome = current.id === expected.id ? ('saved' as const) : ('conflict' as const);

    if (outcome === 'saved') publish(row.id);

    orm
      .insert(s.page_edit_receipts)
      .values({
        page_id: v.pageId,
        key: v.key,
        operation,
        intent,
        expected_version_id: expected.id,
        current_version_id: current.id,
        submitted_version_id: row.id,
        outcome
      })
      .run();

    return {
      outcome,
      replayed: false,
      expectedVersionId: expected.id,
      currentVersionId: current.id,
      submittedVersionId: row.id
    };
  }

  function save(v: typeof e.saveSchema.Type) {
    return edit(v, 'save', JSON.stringify(intentHash(e.saveSchema, v)));
  }

  function restore(v: typeof e.restoreSchema.Type) {
    const hash = JSON.stringify(intentHash(e.restoreSchema, v));
    const replay = replayEdit(v.pageId, v.key, 'restore', hash);

    if (replay) return replay;

    return edit(
      { ...v, document: version(v.restoreVersionId).document },
      'restore',
      hash,
      v.restoreVersionId
    );
  }

  function compare(v: typeof e.compareSchema.Type) {
    const before = version(v.beforeVersionId),
      proposed = version(v.proposedVersionId),
      current = version(v.currentVersionId);

    if (new Set([before.pageId, proposed.pageId, current.pageId]).size !== 1)
      invalid('Comparison requires one document');

    return {
      ...v,
      before,
      proposed,
      current,
      proposedChanges: documentDifferences(before.document, proposed.document),
      currentChanges: documentDifferences(before.document, current.document),
      evidence: 'structural_only' as const
    };
  }

  function copySource(v: typeof r.sourceCopySchema.Type) {
    required(
      orm
        .select()
        .from(s.source_extraction_revisions)
        .where(
          and(
            eq(s.source_extraction_revisions.source_id, v.sourceId),
            eq(s.source_extraction_revisions.revision, v.revision),
            eq(s.source_extraction_revisions.snapshot_id, v.snapshotId)
          )
        )
        .get()
    );
    // Stable copied block identities make idempotent retries deterministic without a second body copy.
    const body = content(v.snapshotId);
    const copied = {
      ...body,
      blocks: body.blocks.map((b) => ({
        ...b,
        id: Schema.decodeUnknownSync(blockIdSchema)(
          createHash('sha256')
            .update(v.createKey + ':' + b.id)
            .digest('hex')
        )
      }))
    };

    return createResult({
      createKey: v.createKey,
      title: v.title,
      document: copied,
      inputs: [
        { kind: 'source', sourceId: v.sourceId, revision: v.revision, snapshotId: v.snapshotId }
      ],
      citations: [],
      projectId: v.projectId,
      noteId: v.noteId
    });
  }

  function archive(v: typeof r.archiveSchema.Type) {
    aggregate(v.id);
    orm
      .update(s.pages)
      .set({ archived_at: v.archived ? now() : null, updated_at: now() })
      .where(eq(s.pages.id, v.id))
      .run();

    return page(v.id);
  }

  function projectMembership(v: typeof r.projectLinkSchema.Type) {
    aggregate(v.pageId);
    required(orm.select().from(s.projects).where(eq(s.projects.id, v.projectId)).get());

    return { project_id: v.projectId, page_id: v.pageId };
  }

  function exportVersion(v: typeof r.versionKeySchema.Type) {
    const result = version(v.id);

    return {
      version: result,
      format: 'canonical_json' as const,
      content: Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(c.versionSchema)))(result)
    };
  }

  return {
    attach,
    attachProject: (v: typeof r.projectLinkSchema.Type) => {
      const membership = projectMembership(v);

      orm.insert(s.project_pages).values(membership).onConflictDoNothing().run();
    },
    detachProject: (v: typeof r.projectLinkSchema.Type) => {
      const membership = projectMembership(v);

      orm
        .delete(s.project_pages)
        .where(
          and(
            eq(s.project_pages.project_id, membership.project_id),
            eq(s.project_pages.page_id, membership.page_id)
          )
        )
        .run();
    },
    create,
    createResult,
    replayEdit,
    save,
    restore,
    compare,
    copySource,
    archive,
    updateMetadata: (v: typeof r.metadataSchema.Type) => {
      const current = aggregate(v.id);

      if (current.title !== v.expectedTitle || current.description !== v.expectedDescription)
        invalid('Page metadata changed before save');

      orm
        .update(s.pages)
        .set({
          title: v.title,
          description: v.description,
          updated_at: now()
        })
        .where(eq(s.pages.id, v.id))
        .run();

      return page(v.id);
    },
    exportVersion,
    detach: (v: typeof r.linkSchema.Type) => {
      aggregate(v.pageId);
      orm
        .delete(s.note_pages)
        .where(and(eq(s.note_pages.note_id, v.noteId), eq(s.note_pages.page_id, v.pageId)))
        .run();
    }
  };
}
