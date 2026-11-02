DROP TRIGGER material_file_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_delete_draft BEFORE DELETE ON material_file_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_audio_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_delete_draft BEFORE DELETE ON material_audio_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_video_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_delete_draft BEFORE DELETE ON material_video_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_image_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_delete_draft BEFORE DELETE ON material_image_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_link_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_delete_draft BEFORE DELETE ON material_link_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_document_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_delete_draft BEFORE DELETE ON material_document_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_diagram_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_delete_draft BEFORE DELETE ON material_diagram_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_delete_draft BEFORE DELETE ON material_quiz_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_flashcard_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_delete_draft BEFORE DELETE ON material_flashcard_versions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_questions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_delete_draft BEFORE DELETE ON material_quiz_questions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_choices_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_delete_draft BEFORE DELETE ON material_quiz_choices
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_open_answers_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_delete_draft BEFORE DELETE ON material_quiz_open_answers
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_flashcard_entries_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_delete_draft BEFORE DELETE ON material_flashcard_entries
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_version_citations_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_delete_draft BEFORE DELETE ON material_version_citations
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_source_snapshots_published_delete;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_delete BEFORE DELETE ON material_source_snapshots
WHEN ((EXISTS (SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_annotation_revision_retained;
--> statement-breakpoint
CREATE TRIGGER material_annotation_revision_retained BEFORE DELETE ON material_annotation_revisions
WHEN (NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'annotation revisions are retained'); END;
--> statement-breakpoint
DROP TRIGGER material_citation_assessment_retained;
--> statement-breakpoint
CREATE TRIGGER material_citation_assessment_retained BEFORE DELETE ON material_citation_assessments
WHEN (NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.claim_version_id) AND d.status IN ('pending','failed')) OR EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.evidence_version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.claim_version_id AND p.status IN ('pending','failed')) OR EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.evidence_version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'citation assessments are retained'); END;
--> statement-breakpoint
DROP TRIGGER document_edit_receipts_delete_immutable;
--> statement-breakpoint
CREATE TRIGGER document_edit_receipts_delete_immutable BEFORE DELETE ON document_edit_receipts
WHEN (NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=OLD.material_id AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.expected_version_id AND p.status IN ('pending','failed')) OR EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.current_version_id AND p.status IN ('pending','failed')) OR EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.submitted_version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_versions_frozen;
--> statement-breakpoint
CREATE TRIGGER material_versions_frozen BEFORE UPDATE ON material_versions
WHEN ((((OLD.status='published' AND NOT (
 OLD.instruction IS NOT NULL AND NEW.instruction IS NULL AND NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.language IS OLD.language AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at
 AND EXISTS(SELECT 1 FROM session_generation_retirements x
 JOIN material_generation_requests r ON r.id=x.request_id
 JOIN session_deletions d ON d.session_id=x.session_id
 WHERE x.request_id=OLD.generation_request_id AND d.status IN ('pending','failed')
 AND OLD.instruction IS json_extract(r.payload,'$.instruction')
 AND json_extract(r.payload,'$.documentTransform.contextRequestId') IS NOT NULL)
)) OR new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.kind IS NOT old.kind OR new.number IS NOT old.number OR new.created_at IS NOT old.created_at) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.id) AND d.status IN ('pending','failed')) AND NEW.instruction IS NULL AND NEW.language IS NULL AND NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at)) AND NOT (NEW.instruction IS NULL AND NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.language IS OLD.language AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at AND EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) d JOIN material_generation_requests r ON r.id=d.request_id WHERE d.request_id=OLD.generation_request_id AND d.kind='generation' AND OLD.instruction IS json_extract(r.payload,'$.instruction')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.id AND p.status IN ('pending','failed')) AND NEW.instruction IS NULL AND NEW.language IS NULL AND NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at)
BEGIN SELECT RAISE(ABORT, 'published versions and version identities are immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_input_retained;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_retained BEFORE DELETE ON material_generation_inputs
WHEN (EXISTS(SELECT 1 FROM material_generation_requests WHERE id=OLD.request_id)
 AND NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)) AND NOT (EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) WHERE request_id=OLD.request_id AND kind='generation'))
BEGIN SELECT RAISE(ABORT, 'generation inputs cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER document_proposals_delete_immutable;
--> statement-breakpoint
CREATE TRIGGER document_proposals_delete_immutable BEFORE DELETE ON document_proposals
WHEN (NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)) AND NOT (EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) WHERE request_id=OLD.request_id AND kind='generation'))
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
DROP TRIGGER document_proposal_receipts_delete_immutable;
--> statement-breakpoint
CREATE TRIGGER document_proposal_receipts_delete_immutable BEFORE DELETE ON document_proposal_receipts
WHEN (NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)) AND NOT (EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) WHERE request_id=OLD.request_id AND kind='generation'))
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
DROP TRIGGER retired_proposal_receipt_valid;
--> statement-breakpoint
CREATE TRIGGER retired_proposal_receipt_valid BEFORE INSERT ON retired_document_proposal_receipts
WHEN NOT EXISTS(SELECT 1 FROM document_proposal_receipts r JOIN document_proposals p ON p.request_id=r.request_id
 LEFT JOIN session_generation_retirements x ON x.request_id=p.request_id
 WHERE (x.request_id IS NOT NULL OR EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) md WHERE md.request_id=p.request_id AND md.kind='generation')) AND r.key=NEW.key AND r.request_id=NEW.request_id AND r.operation=NEW.operation AND r.outcome=NEW.outcome
 AND NEW.intent=r.intent AND json_type(NEW.intent)='object'
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.intent) WHERE key NOT IN ('key','requestId','projectId','expectedVersionId','baseVersionId'))
 AND r.result_version_id=NEW.result_version_id AND r.current_version_id=NEW.current_version_id AND p.base_version_id=NEW.base_version_id AND p.proposed_version_id=NEW.proposed_version_id)
BEGIN SELECT RAISE(ABORT, 'retired receipt requires completed exact proposal ownership'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_intent_immutable;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at
 OR (NEW.payload IS NOT OLD.payload AND NOT (NEW.payload='{}' AND NEW.cancelled=1 AND NEW.result_metadata IS NULL AND (EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id) OR EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) md WHERE md.request_id=OLD.id AND md.kind='generation'))))
BEGIN SELECT RAISE(ABORT, 'generation intent is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_result_immutable;
--> statement-breakpoint
CREATE TRIGGER material_generation_result_immutable BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.result_hash IS NOT OLD.result_hash)
 AND NOT (NEW.result_version_id IS NULL AND NEW.result_hash IS NULL AND (EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id) OR EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) md WHERE md.request_id=OLD.id AND md.kind='generation'))
 AND (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=OLD.result_version_id AND v.status='draft' AND v.generation_request_id=OLD.id) OR EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) md WHERE md.request_id=OLD.id AND md.kind='generation')))
BEGIN SELECT RAISE(ABORT, 'generation result is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_cancel_fence;
--> statement-breakpoint
CREATE TRIGGER material_generation_cancel_fence BEFORE UPDATE ON material_generation_requests
WHEN (OLD.cancelled=1 AND NEW.cancelled!=1) OR (NEW.cancelled=1 AND OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL)
 OR (OLD.result_version_id IS NOT NULL AND NEW.result_metadata IS NOT OLD.result_metadata
 AND NOT (NEW.result_metadata IS NULL AND NEW.payload='{}' AND NEW.cancelled=1 AND (EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id) OR EXISTS(SELECT 1 FROM (SELECT request_id,kind FROM material_deletion_requests UNION ALL SELECT request_id,kind FROM material_history_requests) md WHERE md.request_id=OLD.id AND md.kind='generation'))))
BEGIN SELECT RAISE(ABORT, 'generation cancellation and result metadata are immutable'); END;
--> statement-breakpoint
DROP TRIGGER learning_practice_slot_immutable;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_immutable
BEFORE UPDATE ON learning_practice_slots
WHEN ((NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.epoch IS NOT OLD.epoch
  OR NEW.ordinal IS NOT OLD.ordinal OR NEW.kind IS NOT OLD.kind OR NEW.input_version_ids IS NOT OLD.input_version_ids
  OR (OLD.version_id IS NOT NULL AND (NEW.version_id IS NOT OLD.version_id OR NEW.attempt_id IS NOT OLD.attempt_id))
  OR (OLD.status IN ('answered','cancelled') AND NEW.status IS NOT OLD.status)
  OR (OLD.status = 'ready' AND NEW.status NOT IN ('ready','answered','cancelled'))
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending','ready','cancelled'))) AND NOT (EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.input_version_ids IS OLD.input_version_ids AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.input_version_ids IS OLD.input_version_ids AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)
BEGIN SELECT RAISE(ABORT, 'practice slot intent and receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_update BEFORE UPDATE ON material_history_members BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_delete BEFORE DELETE ON material_history_members BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_update BEFORE UPDATE ON material_history_requests BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_delete BEFORE DELETE ON material_history_requests BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_history_documents_update BEFORE UPDATE ON source_history_documents BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_history_documents_delete BEFORE DELETE ON source_history_documents BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_history_revisions_update BEFORE UPDATE ON source_history_revisions BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_history_revisions_delete BEFORE DELETE ON source_history_revisions BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_identity BEFORE UPDATE ON material_history_prunes
WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.material_id IS NOT OLD.material_id OR NEW.keep_latest IS NOT OLD.keep_latest OR NEW.token IS NOT OLD.token OR NEW.selection IS NOT OLD.selection OR NEW.created_at IS NOT OLD.created_at OR OLD.status='completed'
OR NOT ((NEW.attempt=OLD.attempt AND NEW.status IN ('failed','completed')) OR (NEW.attempt=OLD.attempt+1 AND NEW.status='pending' AND OLD.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT,'history intent and completion are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_retained BEFORE DELETE ON material_history_prunes BEGIN SELECT RAISE(ABORT,'history cleanup is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_valid BEFORE INSERT ON material_history_prunes
WHEN NEW.status!='pending' OR NEW.attempt!=1 OR EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
OR EXISTS(SELECT 1 FROM material_history_prunes WHERE material_id=NEW.material_id AND status!='completed')
OR EXISTS(SELECT 1 FROM json_each(NEW.selection) j LEFT JOIN material_versions v ON CAST(v.id AS TEXT)=j.value WHERE v.id IS NULL OR v.material_id!=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'history requires available exact scope'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_valid BEFORE INSERT ON material_history_members
WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p JOIN material_versions v ON v.material_id=p.material_id, json_each(p.selection) j
WHERE p.operation_id=NEW.operation_id AND p.status='pending' AND v.id=NEW.version_id AND CAST(v.id AS TEXT)=j.value AND v.status='published'
AND (SELECT count(*) FROM material_versions newer WHERE newer.material_id=v.material_id AND newer.status='published' AND newer.number>v.number)>=p.keep_latest
AND NOT EXISTS(SELECT 1 FROM document_proposals d WHERE (v.id IN(d.base_version_id,d.proposed_version_id) OR EXISTS(SELECT 1 FROM material_generation_inputs i WHERE i.request_id=d.request_id AND i.version_id=v.id)) AND NOT EXISTS(SELECT 1 FROM document_proposal_receipts r WHERE r.request_id=d.request_id AND r.result_version_id IS NOT NULL))
AND NOT EXISTS(SELECT 1 FROM material_source_snapshots s LEFT JOIN source_processing sp ON sp.source_id=s.source_id WHERE s.version_id=v.id AND (v.operation='original' OR sp.revision=s.revision OR sp.document_id=s.document_id)))
BEGIN SELECT RAISE(ABORT,'history cannot prune protected roots'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_valid BEFORE INSERT ON material_history_requests
WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p WHERE p.operation_id=NEW.operation_id AND p.status='pending') OR NOT (
(NEW.kind='generation' AND (EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_history_members m ON m.version_id=i.version_id WHERE i.request_id=NEW.request_id AND m.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_history_members m ON m.version_id=v.id WHERE v.generation_request_id=NEW.request_id AND m.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_history_requests c ON c.request_id=json_extract(r.payload,'$.documentTransform.contextRequestId') WHERE r.id=NEW.request_id AND c.kind='context' AND c.operation_id=NEW.operation_id)))
OR (NEW.kind='context' AND EXISTS(SELECT 1 FROM (SELECT request_id,snapshot FROM session_run_contexts UNION ALL SELECT request_id,json_extract(snapshot,'$.context') AS snapshot FROM conversation_reply_requests) c,json_each(c.snapshot,'$.inputs') j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(j.value,'$.versionId') WHERE c.request_id=NEW.request_id AND m.operation_id=NEW.operation_id))
OR (NEW.kind='learning' AND (EXISTS(SELECT 1 FROM learning_practice_slots p,json_each(p.input_version_ids) j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=j.value WHERE p.id=NEW.request_id AND m.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_history_members m ON m.version_id=a.version_id WHERE e.correlation_id=NEW.request_id AND m.operation_id=NEW.operation_id)))
OR (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(e.payload,'$.materialVersionId') WHERE e.correlation_id=NEW.request_id AND m.operation_id=NEW.operation_id))
OR (NEW.kind='source' AND EXISTS(SELECT 1 FROM workflow_events e JOIN source_history_documents d ON CAST(d.document_id AS TEXT)=json_extract(e.payload,'$.documentId') WHERE e.correlation_id=NEW.request_id AND d.operation_id=NEW.operation_id AND e.type IN ('SourceIndexed','SourceCorrectionRequested')))
)
BEGIN SELECT RAISE(ABORT,'history retirement requires exact version ownership'); END;
--> statement-breakpoint
CREATE TRIGGER source_history_documents_valid BEFORE INSERT ON source_history_documents
WHEN NOT EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id JOIN (SELECT version_id,document_id FROM material_document_versions UNION ALL SELECT version_id,document_id FROM material_source_snapshots) d ON d.version_id=m.version_id WHERE m.operation_id=NEW.operation_id AND d.document_id=NEW.document_id AND p.status='pending')
BEGIN SELECT RAISE(ABORT,'history Document cleanup requires exact ownership'); END;
--> statement-breakpoint
CREATE TRIGGER source_history_revisions_valid BEFORE INSERT ON source_history_revisions
WHEN NOT EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id JOIN material_source_snapshots s ON s.version_id=m.version_id WHERE m.operation_id=NEW.operation_id AND s.source_id=NEW.source_id AND s.revision=NEW.revision AND p.status='pending')
AND NOT EXISTS(SELECT 1 FROM source_history_documents d JOIN document_assets a ON a.document_id=d.document_id JOIN material_history_prunes p ON p.operation_id=d.operation_id WHERE d.operation_id=NEW.operation_id AND a.source_id=NEW.source_id AND a.revision=NEW.revision AND p.status='pending')
BEGIN SELECT RAISE(ABORT,'history revision cleanup requires exact ownership'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_history_insert BEFORE INSERT ON material_file_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_history_update BEFORE UPDATE ON material_file_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_history_insert BEFORE INSERT ON material_audio_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_history_update BEFORE UPDATE ON material_audio_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_history_insert BEFORE INSERT ON material_video_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_history_update BEFORE UPDATE ON material_video_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_history_insert BEFORE INSERT ON material_image_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_history_update BEFORE UPDATE ON material_image_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_history_insert BEFORE INSERT ON material_link_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_history_update BEFORE UPDATE ON material_link_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_history_insert BEFORE INSERT ON material_document_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_history_update BEFORE UPDATE ON material_document_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_history_insert BEFORE INSERT ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_history_update BEFORE UPDATE ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_history_insert BEFORE INSERT ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_history_update BEFORE UPDATE ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_history_insert BEFORE INSERT ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_history_update BEFORE UPDATE ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_history_insert BEFORE INSERT ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_history_update BEFORE UPDATE ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_history_insert BEFORE INSERT ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_history_update BEFORE UPDATE ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_history_insert BEFORE INSERT ON material_source_snapshots WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_history_update BEFORE UPDATE ON material_source_snapshots WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_history_insert BEFORE INSERT ON material_version_citations WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_history_update BEFORE UPDATE ON material_version_citations WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_history_insert BEFORE INSERT ON material_version_inputs WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_history_update BEFORE UPDATE ON material_version_inputs WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_insert BEFORE INSERT ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_history_update BEFORE UPDATE ON material_version_parents WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_inputs_history_insert BEFORE INSERT ON material_generation_inputs WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) OR EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'pruned input cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER session_run_contexts_history_insert BEFORE INSERT ON session_run_contexts
WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=NEW.request_id)
OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.inputs') j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(j.value,'$.versionId'))
BEGIN SELECT RAISE(ABORT,'pruned input cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER session_run_contexts_history_update BEFORE UPDATE ON session_run_contexts WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=OLD.request_id) BEGIN SELECT RAISE(ABORT,'retired context cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_requests_history_insert BEFORE INSERT ON conversation_reply_requests
WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=NEW.request_id)
OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.context.inputs') j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(j.value,'$.versionId'))
BEGIN SELECT RAISE(ABORT,'pruned input cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_requests_history_update BEFORE UPDATE ON conversation_reply_requests WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=OLD.request_id) BEGIN SELECT RAISE(ABORT,'retired context cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER history_reply_publication BEFORE UPDATE OF status,text ON message_versions WHEN EXISTS(SELECT 1 FROM conversation_reply_requests r JOIN material_history_requests h ON h.request_id=r.request_id WHERE r.version_id=NEW.id) BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER history_proposal_action BEFORE INSERT ON document_proposal_receipts WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'retired proposal cannot apply'); END;
--> statement-breakpoint
CREATE TRIGGER history_proposal_capture BEFORE INSERT ON document_proposals WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id IN(NEW.base_version_id,NEW.proposed_version_id)) OR EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'pruned input cannot publish a proposal'); END;
--> statement-breakpoint
CREATE TRIGGER history_practice_capture BEFORE INSERT ON learning_practice_slots WHEN EXISTS(SELECT 1 FROM json_each(NEW.input_version_ids) j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=j.value) BEGIN SELECT RAISE(ABORT,'pruned input cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER history_annotation_capture BEFORE INSERT ON material_annotation_revisions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned input cannot be annotated'); END;
--> statement-breakpoint
CREATE TRIGGER history_assessment_capture BEFORE INSERT ON material_citation_assessments WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id IN(NEW.claim_version_id,NEW.evidence_version_id)) BEGIN SELECT RAISE(ABORT,'pruned evidence cannot be assessed'); END;
--> statement-breakpoint
CREATE TRIGGER documents_history_insert BEFORE INSERT ON documents WHEN EXISTS(SELECT 1 FROM source_history_documents h WHERE h.document_id=NEW.id) BEGIN SELECT RAISE(ABORT,'pruned Document cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER documents_history_update BEFORE UPDATE ON documents WHEN EXISTS(SELECT 1 FROM source_history_documents h WHERE h.document_id=NEW.id) BEGIN SELECT RAISE(ABORT,'pruned Document cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_history_insert BEFORE INSERT ON blocks WHEN EXISTS(SELECT 1 FROM source_history_documents h WHERE h.document_id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'pruned Document cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_history_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM source_history_documents h WHERE h.document_id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'pruned Document cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER source_snapshot_history_restore BEFORE INSERT ON source_snapshots WHEN EXISTS(SELECT 1 FROM source_history_revisions h WHERE h.source_id=NEW.source_id AND h.revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'pruned revision cannot be restored'); END;
--> statement-breakpoint
CREATE TRIGGER source_processing_history_update BEFORE UPDATE ON source_processing WHEN EXISTS(SELECT 1 FROM source_history_documents WHERE document_id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'pruned Document cannot become current'); END;
