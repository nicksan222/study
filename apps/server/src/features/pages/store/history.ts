/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Previews and retires unprotected authored history with durable identity checks.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Previews and retires unprotected authored history with durable identity checks.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { PageId, PageVersionId } from '@study/contracts/ids';
import { desc, eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { CryptoHasher } from 'bun';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { invalid } from './errors.ts';
import { makePageReads } from './reads.ts';

export function makePageHistory(resources: StoreResources) {
  const { db, clock } = resources;
  const reads = makePageReads(resources);

  const orm = db.orm;
  const now = () => unixSeconds(clock);
  const { aggregate, liveVersion } = reads;

  function preview(
    pageId: PageId,
    keepLatest: number,
    deletion = false,
    versionId?: PageVersionId
  ) {
    aggregate(pageId);
    const all = orm
      .select()
      .from(s.page_versions)
      .where(eq(s.page_versions.page_id, pageId))
      .orderBy(desc(s.page_versions.number))
      .all();
    const published = all
      .filter((x) => x.status === 'published')
      .slice(0, keepLatest)
      .map((x) => x.id);
    const candidates = all.filter(
      (x) =>
        (versionId === undefined || x.id === versionId) &&
        (deletion || x.status === 'published') &&
        !published.includes(x.id) &&
        !orm.select().from(s.page_retirements).where(eq(s.page_retirements.version_id, x.id)).get()
    );
    const blockedVersionIds = candidates
      .filter((x) => {
        const dependency = orm
          .select()
          .from(s.page_inputs)
          .where(eq(s.page_inputs.page_version_id, x.id))
          .all()
          .some((i) => i.version_id === null || !all.some((v) => v.id === i.version_id));
        const proposal = orm
          .select()
          .from(s.page_proposals)
          .where(
            sql`${s.page_proposals.base_version_id}=${x.id} OR ${s.page_proposals.proposed_version_id}=${x.id}`
          )
          .get();
        const externalProposal =
          proposal !== undefined &&
          [proposal.base_version_id, proposal.proposed_version_id].some(
            (id) =>
              orm.select().from(s.page_versions).where(eq(s.page_versions.id, id)).get()
                ?.page_id !== pageId
          );
        const captured =
          orm
            .select()
            .from(s.note_context_pages)
            .where(eq(s.note_context_pages.version_id, x.id))
            .get() !== undefined;

        return (
          captured ||
          orm
            .select()
            .from(s.citations)
            .where(
              sql`${s.citations.authored_version_id}=${x.id} OR ${s.citations.document_id}=${x.content_snapshot_id}`
            )
            .get() !== undefined ||
          dependency ||
          orm
            .select()
            .from(s.material_evidence_inputs)
            .where(eq(s.material_evidence_inputs.page_version_id, x.id))
            .get() !== undefined ||
          orm
            .select()
            .from(s.learning_practice_inputs)
            .where(eq(s.learning_practice_inputs.page_version_id, x.id))
            .get() !== undefined ||
          (proposal !== undefined && (!deletion || externalProposal))
        );
      })
      .map((x) => x.id);
    const versionIds = candidates.map((x) => x.id);
    const memberships = {
      notes: orm
        .select()
        .from(s.note_pages)
        .where(eq(s.note_pages.page_id, pageId))
        .all()
        .map((x) => [String(x.note_id), String(x.position)]),
      projects: orm
        .select()
        .from(s.project_pages)
        .where(eq(s.project_pages.page_id, pageId))
        .all()
        .map((x) => String(x.project_id))
    };
    const token = new CryptoHasher('sha256')
      .update(
        JSON.stringify({
          memberships,
          pageId: String(pageId),
          keepLatest,
          deletion,
          ...(versionId === undefined ? {} : { versionId: String(versionId) }),
          versions: all.map((x) => [String(x.id), x.status]),
          blocked: blockedVersionIds.map(String),
          retired: all
            .filter((x) => !candidates.includes(x) && !published.includes(x.id))
            .map((x) => String(x.id))
        })
      )
      .digest('hex');

    return {
      pageId,
      token,
      versionIds,
      blockedVersionIds,
      semantics: 'retire_bodies_retain_identities' as const
    };
  }

  function retire(
    pageId: PageId,
    keepLatest: number,
    token: string,
    deletion = false,
    versionId?: PageVersionId
  ) {
    const result = preview(pageId, keepLatest, deletion, versionId);

    if (result.token !== token || result.blockedVersionIds.length)
      invalid('Retirement selection changed or has retained dependents');

    for (const id of result.versionIds) {
      const row = liveVersion(id);

      orm
        .insert(s.page_retirements)
        .values({ version_id: id, reason: deletion ? 'deletion' : 'history', created_at: now() })
        .run();
      orm
        .delete(s.page_citation_assessments)
        .where(eq(s.page_citation_assessments.version_id, id))
        .run();
      orm.delete(s.page_citations).where(eq(s.page_citations.version_id, id)).run();
      orm.delete(s.page_inputs).where(eq(s.page_inputs.version_id, id)).run();
      orm.delete(s.blocks).where(eq(s.blocks.document_id, row.content_snapshot_id)).run();
      orm
        .update(s.content_snapshots)
        .set({ meta: '{}' })
        .where(eq(s.content_snapshots.id, row.content_snapshot_id))
        .run();
    }

    if (deletion) {
      orm.delete(s.note_pages).where(eq(s.note_pages.page_id, pageId)).run();
      orm.delete(s.project_pages).where(eq(s.project_pages.page_id, pageId)).run();
      orm.insert(s.page_deletions).values({ page_id: pageId, created_at: now() }).run();
    }

    return result;
  }

  return { preview, retire };
}
