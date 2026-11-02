/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Captures durable material publication state for atomic rollback assertions.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Binds the current database once and reads every durable output participant.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Test-only snapshots observe real persistence and never alter publication or              │
 * │ workflow state.                                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeMaterialOutput({ db }: StoreResources) {
  return () => ({
    annotations: db.orm.select().from(s.material_annotations).all(),
    annotationRevisions: db.orm.select().from(s.material_annotation_revisions).all(),
    citationAssessments: db.orm.select().from(s.material_citation_assessments).all(),
    materials: db.orm.select().from(s.materials).all(),
    versions: db.orm.select().from(s.material_versions).all(),
    documentRows: db.orm.select().from(s.documents).all(),
    parents: db.orm.select().from(s.material_version_parents).all(),
    editReceipts: db.orm.select().from(s.document_edit_receipts).all(),
    proposals: db.orm.select().from(s.document_proposals).all(),
    proposalReceipts: db.orm.select().from(s.document_proposal_receipts).all(),
    projectMemberships: db.orm.select().from(s.project_materials).all(),
    documents: db.orm.select().from(s.material_document_versions).all(),
    blocks: db.orm.select().from(s.blocks).all(),
    assets: db.orm.select().from(s.document_assets).all(),
    inputs: db.orm.select().from(s.material_version_inputs).all(),
    citations: db.orm.select().from(s.material_version_citations).all(),
    memberships: db.orm.select().from(s.session_materials).all(),
    requests: db.orm.select().from(s.material_generation_requests).all(),
    published: db.orm
      .select()
      .from(s.workflowEvents)
      .all()
      .filter((event) => event.type === 'MaterialPublished')
  });
}
