import { createHash } from 'node:crypto';

import type { StudyDocumentId } from '@study/contracts/ids';
import { desc, eq, sql } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

import { invalid } from './errors.ts';
import type { makeDocumentReads } from './reads.ts';

export function makeDocumentHistory(
  { db, clock }: StoreResources,
  reads: ReturnType<typeof makeDocumentReads>
) {
  const orm = db.orm;
  const now = () => unixSeconds(clock);
  const { aggregate, liveVersion } = reads;
  function preview(documentId: StudyDocumentId, keepLatest: number, deletion = false) {
    aggregate(documentId);
    const all = orm
      .select()
      .from(s.study_document_versions)
      .where(eq(s.study_document_versions.document_id, documentId))
      .orderBy(desc(s.study_document_versions.number))
      .all();
    const published = all
      .filter((x) => x.status === 'published')
      .slice(0, keepLatest)
      .map((x) => x.id);
    const candidates = all.filter(
      (x) =>
        (deletion || x.status === 'published') &&
        !published.includes(x.id) &&
        !orm
          .select()
          .from(s.study_document_retirements)
          .where(eq(s.study_document_retirements.version_id, x.id))
          .get()
    );
    const blockedVersionIds = candidates
      .filter((x) => {
        const dependency = orm
          .select()
          .from(s.study_document_inputs)
          .where(eq(s.study_document_inputs.document_version_id, x.id))
          .all()
          .some((i) => i.version_id === null || !all.some((v) => v.id === i.version_id));
        const proposal = orm
          .select()
          .from(s.study_document_proposals)
          .where(
            sql`${s.study_document_proposals.base_version_id}=${x.id} OR ${s.study_document_proposals.proposed_version_id}=${x.id}`
          )
          .get();
        const externalProposal =
          proposal !== undefined &&
          [proposal.base_version_id, proposal.proposed_version_id].some(
            (id) =>
              orm
                .select()
                .from(s.study_document_versions)
                .where(eq(s.study_document_versions.id, id))
                .get()?.document_id !== documentId
          );
        const captured =
          orm
            .select()
            .from(s.session_context_documents)
            .where(eq(s.session_context_documents.version_id, x.id))
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
            .where(eq(s.material_evidence_inputs.document_version_id, x.id))
            .get() !== undefined ||
          orm
            .select()
            .from(s.learning_practice_inputs)
            .where(eq(s.learning_practice_inputs.document_version_id, x.id))
            .get() !== undefined ||
          (proposal !== undefined && (!deletion || externalProposal))
        );
      })
      .map((x) => x.id);
    const versionIds = candidates.map((x) => x.id);
    const memberships = {
      sessions: orm
        .select()
        .from(s.session_documents)
        .where(eq(s.session_documents.document_id, documentId))
        .all()
        .map((x) => [String(x.session_id), String(x.position)]),
      projects: orm
        .select()
        .from(s.project_documents)
        .where(eq(s.project_documents.document_id, documentId))
        .all()
        .map((x) => String(x.project_id))
    };
    const token = createHash('sha256')
      .update(
        JSON.stringify({
          memberships,
          documentId: String(documentId),
          keepLatest,
          deletion,
          versions: all.map((x) => [String(x.id), x.status]),
          blocked: blockedVersionIds.map(String),
          retired: all
            .filter((x) => !candidates.includes(x) && !published.includes(x.id))
            .map((x) => String(x.id))
        })
      )
      .digest('hex');
    return {
      documentId,
      token,
      versionIds,
      blockedVersionIds,
      semantics: 'retire_bodies_retain_identities' as const
    };
  }
  function retire(
    documentId: StudyDocumentId,
    keepLatest: number,
    token: string,
    deletion = false
  ) {
    const result = preview(documentId, keepLatest, deletion);
    if (result.token !== token || result.blockedVersionIds.length)
      invalid('Retirement selection changed or has retained dependents');
    for (const id of result.versionIds) {
      const row = liveVersion(id);
      orm
        .insert(s.study_document_retirements)
        .values({ version_id: id, reason: deletion ? 'deletion' : 'history', created_at: now() })
        .run();
      orm
        .delete(s.study_document_citation_assessments)
        .where(eq(s.study_document_citation_assessments.version_id, id))
        .run();
      orm
        .delete(s.study_document_citations)
        .where(eq(s.study_document_citations.version_id, id))
        .run();
      orm.delete(s.study_document_inputs).where(eq(s.study_document_inputs.version_id, id)).run();
      orm.delete(s.blocks).where(eq(s.blocks.document_id, row.content_snapshot_id)).run();
      orm
        .update(s.content_snapshots)
        .set({ meta: '{}' })
        .where(eq(s.content_snapshots.id, row.content_snapshot_id))
        .run();
    }
    if (deletion) {
      orm.delete(s.session_documents).where(eq(s.session_documents.document_id, documentId)).run();
      orm.delete(s.project_documents).where(eq(s.project_documents.document_id, documentId)).run();
      orm
        .insert(s.study_document_deletions)
        .values({ document_id: documentId, created_at: now() })
        .run();
    }
    return result;
  }
  return { preview, retire };
}
