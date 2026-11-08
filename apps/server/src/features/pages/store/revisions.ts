/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Persists canonical authored version bodies, lineage and exact evidence roots.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Persists canonical authored version bodies, lineage and exact evidence roots.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { PageId, PageVersionId } from '@study/contracts/ids';
import * as c from '@study/contracts/pages/schemas';
import type { ExactPageInput, PageVersion } from '@study/contracts/pages/types';
import { encodeBlockContent } from '@study/contracts/sources/document';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { and, desc, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { invalid } from './errors.ts';
import { makePageEvidence } from './provenance.ts';
import { makePageReads } from './reads.ts';

export function makePageRevisions(resources: StoreResources) {
  const { db, clock } = resources;
  const reads = makePageReads(resources);
  const evidence = makePageEvidence(resources);

  const orm = db.orm;
  const now = () => unixSeconds(clock);
  const { aggregate, liveVersion } = reads;
  const { insertEvidence } = evidence;

  function insertVersion(
    pageId: PageId,
    body: typeof documentSchema.Type,
    parents: readonly PageVersionId[],
    inputs: readonly ExactPageInput[],
    citations: readonly (typeof c.citationSchema.Type)[],
    operation: PageVersion['operation'] = 'original',
    creator: PageVersion['creator'] = 'user',
    instruction: string | null = null,
    language: string | null = null
  ) {
    aggregate(pageId);
    Schema.decodeUnknownSync(c.authoredContentSchema)(body);

    for (const block of body.blocks) {
      if (block.content.type !== 'image') continue;

      const image = orm
        .select()
        .from(s.source_snapshots)
        .where(
          and(
            eq(s.source_snapshots.source_id, block.content.sourceId),
            eq(s.source_snapshots.revision, BigInt(block.content.revision))
          )
        )
        .get();

      if (!image || image.kind !== 'image' || !image.mime.toLowerCase().startsWith('image/'))
        invalid('Managed image revision is unavailable');
    }

    const time = now();
    const snapshot = orm
      .insert(s.content_snapshots)
      .values({
        extractor_version: BigInt(body.meta.extractorVersion),
        meta: JSON.stringify(body.meta),
        created_at: time
      })
      .returning()
      .get();

    body.blocks.forEach((b, i) => {
      orm
        .insert(s.blocks)
        .values({
          document_id: snapshot.id,
          ordinal: BigInt(i),
          kind: b.kind,
          editing_id: b.id,
          content: encodeBlockContent(b.content),
          text: b.text,
          anchor: JSON.stringify(b.anchor)
        })
        .run();
    });
    const last = orm
      .select()
      .from(s.page_versions)
      .where(eq(s.page_versions.page_id, pageId))
      .orderBy(desc(s.page_versions.number))
      .get();
    const row = orm
      .insert(s.page_versions)
      .values({
        page_id: pageId,
        number: (last?.number ?? 0n) + 1n,
        content_snapshot_id: snapshot.id,
        operation,
        creator,
        instruction,
        language,
        created_at: time
      })
      .returning()
      .get();

    for (const id of new Set(parents))
      orm
        .insert(s.page_version_parents)
        .values({ version_id: row.id, parent_version_id: id, page_id: pageId })
        .run();

    insertEvidence(row.id, inputs, citations, true);

    return row;
  }

  function publish(id: PageVersionId) {
    const v = liveVersion(id);

    orm
      .update(s.page_versions)
      .set({ status: 'published', published_at: now() })
      .where(eq(s.page_versions.id, id))
      .run();
    orm.update(s.pages).set({ updated_at: now() }).where(eq(s.pages.id, v.page_id)).run();
  }

  return { insertVersion, publish };
}
