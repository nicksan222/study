DROP TRIGGER material_file_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_file_versions_delete_draft BEFORE DELETE ON material_file_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_audio_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_audio_versions_delete_draft BEFORE DELETE ON material_audio_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_video_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_video_versions_delete_draft BEFORE DELETE ON material_video_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_image_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_image_versions_delete_draft BEFORE DELETE ON material_image_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_link_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_link_versions_delete_draft BEFORE DELETE ON material_link_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_document_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_delete_draft BEFORE DELETE ON material_document_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_diagram_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_delete_draft BEFORE DELETE ON material_diagram_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_delete_draft BEFORE DELETE ON material_quiz_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_flashcard_versions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_delete_draft BEFORE DELETE ON material_flashcard_versions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_questions_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_delete_draft BEFORE DELETE ON material_quiz_questions
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_flashcard_entries_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_delete_draft BEFORE DELETE ON material_flashcard_entries
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_version_citations_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_delete_draft BEFORE DELETE ON material_version_citations
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_choices_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_delete_draft BEFORE DELETE ON material_quiz_choices
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_open_answers_delete_draft;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_delete_draft BEFORE DELETE ON material_quiz_open_answers
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_source_snapshots_published_delete;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_published_delete BEFORE DELETE ON material_source_snapshots
WHEN (EXISTS (SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published source revision is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_annotation_revision_retained;
--> statement-breakpoint
CREATE TRIGGER material_annotation_revision_retained BEFORE DELETE ON material_annotation_revisions
WHEN NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'annotation revisions are retained'); END;
--> statement-breakpoint
DROP TRIGGER material_annotation_retained;
--> statement-breakpoint
CREATE TRIGGER material_annotation_retained BEFORE DELETE ON material_annotations
WHEN NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=OLD.material_id AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'annotation identities are retained'); END;
--> statement-breakpoint
DROP TRIGGER material_citation_assessment_retained;
--> statement-breakpoint
CREATE TRIGGER material_citation_assessment_retained BEFORE DELETE ON material_citation_assessments
WHEN NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.claim_version_id) AND d.status IN ('pending','failed')) OR EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.evidence_version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'citation assessments are retained'); END;
--> statement-breakpoint
DROP TRIGGER document_edit_receipts_delete_immutable;
--> statement-breakpoint
CREATE TRIGGER document_edit_receipts_delete_immutable BEFORE DELETE ON document_edit_receipts
WHEN NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=OLD.material_id AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_input_retained;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_retained BEFORE DELETE ON material_generation_inputs
WHEN (EXISTS(SELECT 1 FROM material_generation_requests WHERE id=OLD.request_id)
 AND NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=OLD.request_id AND kind='generation'))
BEGIN SELECT RAISE(ABORT, 'generation inputs cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER document_proposals_delete_immutable;
--> statement-breakpoint
CREATE TRIGGER document_proposals_delete_immutable BEFORE DELETE ON document_proposals
WHEN (NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=OLD.request_id AND kind='generation'))
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
DROP TRIGGER document_proposal_receipts_delete_immutable;
--> statement-breakpoint
CREATE TRIGGER document_proposal_receipts_delete_immutable BEFORE DELETE ON document_proposal_receipts
WHEN (NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=OLD.request_id AND kind='generation'))
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
DROP TRIGGER retired_proposal_receipt_valid;
--> statement-breakpoint
CREATE TRIGGER retired_proposal_receipt_valid BEFORE INSERT ON retired_document_proposal_receipts
WHEN NOT EXISTS(SELECT 1 FROM document_proposal_receipts r JOIN document_proposals p ON p.request_id=r.request_id
 LEFT JOIN session_generation_retirements x ON x.request_id=p.request_id
 WHERE (x.request_id IS NOT NULL OR EXISTS(SELECT 1 FROM material_deletion_requests md WHERE md.request_id=p.request_id AND md.kind='generation')) AND r.key=NEW.key AND r.request_id=NEW.request_id AND r.operation=NEW.operation AND r.outcome=NEW.outcome
 AND NEW.intent=r.intent AND json_type(NEW.intent)='object'
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.intent) WHERE key NOT IN ('key','requestId','projectId','expectedVersionId','baseVersionId'))
 AND r.result_version_id=NEW.result_version_id AND r.current_version_id=NEW.current_version_id AND p.base_version_id=NEW.base_version_id AND p.proposed_version_id=NEW.proposed_version_id)
BEGIN SELECT RAISE(ABORT, 'retired receipt requires completed exact proposal ownership'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_intent_immutable;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at
 OR (NEW.payload IS NOT OLD.payload AND NOT (NEW.payload='{}' AND NEW.cancelled=1 AND NEW.result_metadata IS NULL AND (EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id) OR EXISTS(SELECT 1 FROM material_deletion_requests md WHERE md.request_id=OLD.id AND md.kind='generation'))))
BEGIN SELECT RAISE(ABORT, 'generation intent is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_result_immutable;
--> statement-breakpoint
CREATE TRIGGER material_generation_result_immutable BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.result_hash IS NOT OLD.result_hash)
 AND NOT (NEW.result_version_id IS NULL AND NEW.result_hash IS NULL AND (EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id) OR EXISTS(SELECT 1 FROM material_deletion_requests md WHERE md.request_id=OLD.id AND md.kind='generation'))
 AND (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=OLD.result_version_id AND v.status='draft' AND v.generation_request_id=OLD.id) OR EXISTS(SELECT 1 FROM material_deletion_requests md WHERE md.request_id=OLD.id AND md.kind='generation')))
BEGIN SELECT RAISE(ABORT, 'generation result is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_cancel_fence;
--> statement-breakpoint
CREATE TRIGGER material_generation_cancel_fence BEFORE UPDATE ON material_generation_requests
WHEN (OLD.cancelled=1 AND NEW.cancelled!=1) OR (NEW.cancelled=1 AND OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL)
 OR (OLD.result_version_id IS NOT NULL AND NEW.result_metadata IS NOT OLD.result_metadata
 AND NOT (NEW.result_metadata IS NULL AND NEW.payload='{}' AND NEW.cancelled=1 AND (EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id) OR EXISTS(SELECT 1 FROM material_deletion_requests md WHERE md.request_id=OLD.id AND md.kind='generation'))))
BEGIN SELECT RAISE(ABORT, 'generation cancellation and result metadata are immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_versions_frozen;
--> statement-breakpoint
CREATE TRIGGER material_versions_frozen BEFORE UPDATE ON material_versions
WHEN (((OLD.status='published' AND NOT (
 OLD.instruction IS NOT NULL AND NEW.instruction IS NULL AND NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.language IS OLD.language AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at
 AND EXISTS(SELECT 1 FROM session_generation_retirements x
 JOIN material_generation_requests r ON r.id=x.request_id
 JOIN session_deletions d ON d.session_id=x.session_id
 WHERE x.request_id=OLD.generation_request_id AND d.status IN ('pending','failed')
 AND OLD.instruction IS json_extract(r.payload,'$.instruction')
 AND json_extract(r.payload,'$.documentTransform.contextRequestId') IS NOT NULL)
)) OR new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.kind IS NOT old.kind OR new.number IS NOT old.number OR new.created_at IS NOT old.created_at) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.id) AND d.status IN ('pending','failed')) AND NEW.instruction IS NULL AND NEW.language IS NULL AND NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at)) AND NOT (NEW.instruction IS NULL AND NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.language IS OLD.language AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at AND EXISTS(SELECT 1 FROM material_deletion_requests d JOIN material_generation_requests r ON r.id=d.request_id WHERE d.request_id=OLD.generation_request_id AND d.kind='generation' AND OLD.instruction IS json_extract(r.payload,'$.instruction')))
BEGIN SELECT RAISE(ABORT, 'published versions and version identities are immutable'); END;
--> statement-breakpoint
DROP TRIGGER source_recording_bytes_retained;
--> statement-breakpoint
CREATE TRIGGER source_recording_bytes_retained BEFORE DELETE ON source_blobs
WHEN (EXISTS(SELECT 1 FROM source_recording_imports r JOIN sources src ON src.id=r.source_id WHERE r.source_id=OLD.source_id)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_imports WHERE source_id=OLD.source_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT,'imported recording bytes are retained'); END;
--> statement-breakpoint
DROP TRIGGER source_recording_capture_frozen;
--> statement-breakpoint
CREATE TRIGGER source_recording_capture_frozen BEFORE UPDATE ON sources
WHEN (EXISTS(SELECT 1 FROM source_recording_imports WHERE source_id=OLD.id) AND (
 NEW.id IS NOT OLD.id OR NEW.origin IS NOT OLD.origin OR NEW.kind IS NOT OLD.kind OR NEW.mime IS NOT OLD.mime OR NEW.name IS NOT OLD.name OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.sha256 IS NOT OLD.sha256 OR NEW.uri IS NOT OLD.uri OR NEW.created_at IS NOT OLD.created_at)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_imports WHERE source_id=OLD.id) AND d.status IN ('pending','failed')) AND NEW.name='-' AND NEW.uri IS NULL AND NEW.size_bytes=1 AND NEW.sha256=zeroblob(32) AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.origin IS OLD.origin AND NEW.kind IS OLD.kind AND NEW.mime IS OLD.mime AND NEW.created_at IS OLD.created_at)
BEGIN SELECT RAISE(ABORT,'imported recording metadata is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_attempt_delete;
--> statement-breakpoint
CREATE TRIGGER material_attempt_delete BEFORE DELETE ON material_quiz_attempts
WHEN (old.status='completed' AND EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed attempts cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_responses_completed_delete;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_delete BEFORE DELETE ON material_quiz_responses
WHEN (EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_review_delete;
--> statement-breakpoint
CREATE TRIGGER material_review_delete BEFORE DELETE ON material_card_reviews
WHEN (EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'card reviews are append only'); END;
--> statement-breakpoint
DROP TRIGGER material_quiz_selections_completed_delete;
--> statement-breakpoint
CREATE TRIGGER material_quiz_selections_completed_delete BEFORE DELETE ON material_quiz_selections
WHEN (EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
DROP TRIGGER learning_practice_selection_delete;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_delete
BEFORE DELETE ON material_quiz_selections
WHEN (EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_retained BEFORE DELETE ON material_deletions
BEGIN SELECT RAISE(ABORT,'deletion barrier is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_identity BEFORE UPDATE ON material_deletions
WHEN NEW.material_id IS NOT OLD.material_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.selection IS NOT OLD.selection OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.status='completed' AND (NEW.status IS NOT OLD.status OR NEW.phase IS NOT OLD.phase OR NEW.attempt IS NOT OLD.attempt OR NEW.completed_at IS NOT OLD.completed_at OR NEW.error_kind IS NOT OLD.error_kind))
BEGIN SELECT RAISE(ABORT,'deletion identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_members_update_retained BEFORE UPDATE ON material_deletion_members BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_members_delete_retained BEFORE DELETE ON material_deletion_members BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_requests_update_retained BEFORE UPDATE ON material_deletion_requests BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_requests_delete_retained BEFORE DELETE ON material_deletion_requests BEGIN SELECT RAISE(ABORT,'deletion ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_member_valid BEFORE INSERT ON material_deletion_members
WHEN NOT EXISTS(SELECT 1 FROM material_deletions d JOIN json_each(d.selection) i WHERE d.material_id=NEW.deletion_id AND d.status='pending' AND CAST(i.value AS INTEGER)=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'deletion member requires exact accepted selection'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_publication BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published' AND (
 EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
 OR EXISTS(SELECT 1 FROM material_version_inputs i JOIN material_versions v ON v.id=i.input_version_id JOIN material_deletion_members d ON d.material_id=v.material_id WHERE i.version_id=NEW.id AND NOT EXISTS(SELECT 1 FROM material_versions revision
 JOIN material_version_parents p ON p.version_id=revision.id
 JOIN material_versions parent ON parent.id=p.parent_version_id AND parent.material_id=revision.material_id
 JOIN material_version_inputs inherited ON inherited.version_id=parent.id AND inherited.input_version_id=i.input_version_id
 WHERE revision.id=NEW.id AND revision.kind='document' AND revision.creator='user' AND revision.operation='edit'
 AND revision.generation_request_id IS NULL AND parent.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=parent.material_id)))
 OR EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.generation_request_id))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_version_insert BEFORE INSERT ON material_versions
WHEN EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN SELECT RAISE(ABORT,'deleted Material cannot create versions'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_input_insert BEFORE INSERT ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id)
 OR (EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.input_version_id)
 AND NOT EXISTS(SELECT 1 FROM material_versions revision
 JOIN material_version_parents p ON p.version_id=revision.id
 JOIN material_versions parent ON parent.id=p.parent_version_id AND parent.material_id=revision.material_id
 JOIN material_version_inputs inherited ON inherited.version_id=parent.id AND inherited.input_version_id=NEW.input_version_id
 WHERE revision.id=NEW.version_id AND revision.kind='document' AND revision.creator='user' AND revision.operation='edit'
 AND revision.generation_request_id IS NULL AND parent.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=parent.material_id)))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot be used'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_generation_input BEFORE INSERT ON material_generation_inputs
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id)
BEGIN SELECT RAISE(ABORT,'deleted Material cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_context_insert BEFORE INSERT ON session_run_contexts
WHEN EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.inputs') i JOIN material_deletion_members d ON CAST(d.material_id AS TEXT)=json_extract(i.value,'$.materialId'))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_reply_insert BEFORE INSERT ON conversation_reply_requests
WHEN EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.context.inputs') i JOIN material_deletion_members d ON CAST(d.material_id AS TEXT)=json_extract(i.value,'$.materialId'))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot be captured'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_source_processing_insert BEFORE INSERT ON source_processing WHEN EXISTS(SELECT 1 FROM material_imports i JOIN material_deletion_members d ON d.material_id=i.material_id WHERE i.source_id=NEW.source_id) BEGIN SELECT RAISE(ABORT,'deleted source cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_source_processing_update BEFORE UPDATE ON source_processing WHEN EXISTS(SELECT 1 FROM material_imports i JOIN material_deletion_members d ON d.material_id=i.material_id WHERE i.source_id=NEW.source_id) BEGIN SELECT RAISE(ABORT,'deleted source cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_documents_insert BEFORE INSERT ON documents WHEN EXISTS(SELECT 1 FROM material_imports i JOIN material_deletion_members d ON d.material_id=i.material_id WHERE i.source_id=NEW.source_id) BEGIN SELECT RAISE(ABORT,'deleted source cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_documents_update BEFORE UPDATE ON documents WHEN EXISTS(SELECT 1 FROM material_imports i JOIN material_deletion_members d ON d.material_id=i.material_id WHERE i.source_id=NEW.source_id) BEGIN SELECT RAISE(ABORT,'deleted source cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_blocks_insert BEFORE INSERT ON blocks WHEN EXISTS(SELECT 1 FROM documents doc JOIN material_imports i ON i.source_id=doc.source_id JOIN material_deletion_members d ON d.material_id=i.material_id WHERE doc.id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'deleted source cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_blocks_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM documents doc JOIN material_imports i ON i.source_id=doc.source_id JOIN material_deletion_members d ON d.material_id=i.material_id WHERE doc.id=NEW.document_id) BEGIN SELECT RAISE(ABORT,'deleted source cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_search AFTER INSERT ON material_deletion_members
BEGIN DELETE FROM catalog_fts WHERE kind='source' AND target_id IN (SELECT source_id FROM material_imports WHERE material_id=NEW.material_id); DELETE FROM catalog_fts WHERE (kind='material' AND target_id=NEW.material_id) OR (kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=NEW.material_id)); END;
--> statement-breakpoint
DROP TRIGGER catalog_native_material_update;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_update AFTER UPDATE OF title,archived_at ON materials WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
DROP TRIGGER catalog_native_version_insert;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_insert AFTER INSERT ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
DROP TRIGGER catalog_native_version_update;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_update AFTER UPDATE OF status,number ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
DROP TRIGGER catalog_native_version_delete;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_delete AFTER DELETE ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=old.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=old.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;

--> statement-breakpoint
DROP TRIGGER learning_practice_slot_immutable;

--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_immutable
BEFORE UPDATE ON learning_practice_slots
WHEN (NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.epoch IS NOT OLD.epoch
  OR NEW.ordinal IS NOT OLD.ordinal OR NEW.kind IS NOT OLD.kind OR NEW.input_version_ids IS NOT OLD.input_version_ids
  OR (OLD.version_id IS NOT NULL AND (NEW.version_id IS NOT OLD.version_id OR NEW.attempt_id IS NOT OLD.attempt_id))
  OR (OLD.status IN ('answered','cancelled') AND NEW.status IS NOT OLD.status)
  OR (OLD.status = 'ready' AND NEW.status NOT IN ('ready','answered','cancelled'))
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending','ready','cancelled'))) AND NOT (EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id) AND NEW.status='cancelled' AND NEW.version_id IS NULL AND NEW.attempt_id IS NULL AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id AND NEW.epoch IS OLD.epoch AND NEW.ordinal IS OLD.ordinal AND NEW.kind IS OLD.kind AND NEW.input_version_ids IS OLD.input_version_ids AND NEW.generation_attempt IS OLD.generation_attempt AND NEW.failure_kind IS OLD.failure_kind)
BEGIN SELECT RAISE(ABORT, 'practice slot intent and receipts are immutable'); END;

--> statement-breakpoint
CREATE TRIGGER material_deletion_practice_capture BEFORE INSERT ON learning_practice_slots
WHEN EXISTS(SELECT 1 FROM json_each(NEW.input_version_ids) i JOIN material_versions v ON CAST(v.id AS TEXT)=i.value JOIN material_deletion_members d ON d.material_id=v.material_id)
BEGIN SELECT RAISE(ABORT,'deleted Material cannot be captured'); END;

--> statement-breakpoint
CREATE TRIGGER material_deletion_proposal_insert BEFORE INSERT ON document_proposals
WHEN EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.request_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id IN (NEW.base_version_id,NEW.proposed_version_id))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot publish a proposal'); END;

--> statement-breakpoint
CREATE TRIGGER material_deletion_proposal_action BEFORE INSERT ON document_proposal_receipts
WHEN EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'retired proposal cannot apply or keep'); END;

--> statement-breakpoint
CREATE TRIGGER material_deletion_reply_publication BEFORE UPDATE OF status,text ON message_versions
WHEN EXISTS(SELECT 1 FROM conversation_reply_requests r JOIN material_deletion_requests d ON d.request_id=r.request_id WHERE r.version_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;

--> statement-breakpoint
CREATE TRIGGER material_deletion_title BEFORE UPDATE ON materials
WHEN EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.id) AND (NEW.title!='-' OR NEW.kind IS NOT OLD.kind OR NEW.id IS NOT OLD.id)
BEGIN SELECT RAISE(ABORT,'deleted Material metadata is unavailable'); END;

--> statement-breakpoint
DROP TRIGGER recording_posts_immutable;
--> statement-breakpoint
CREATE TRIGGER recording_posts_immutable BEFORE UPDATE ON recording_posts
WHEN (NEW.request_id IS NOT OLD.request_id OR NEW.recording_id IS NOT OLD.recording_id OR NEW.session_id IS NOT OLD.session_id OR NEW.name IS NOT OLD.name OR NEW.wav IS NOT OLD.wav OR NEW.duration_ms IS NOT OLD.duration_ms OR NEW.created_at IS NOT OLD.created_at OR (OLD.message_id IS NOT NULL AND (NEW.message_id IS NOT OLD.message_id OR NEW.source_id IS NOT OLD.source_id))) AND NOT (EXISTS(SELECT 1 FROM material_deletion_requests d JOIN source_recording_imports sr ON sr.request_id=OLD.request_id JOIN material_imports i ON i.source_id=sr.source_id JOIN material_deletion_members m ON m.material_id=i.material_id AND m.deletion_id=d.deletion_id WHERE d.request_id=OLD.request_id AND d.kind='recording') AND NEW.name='-' AND NEW.wav=zeroblob(46) AND NEW.duration_ms=0 AND NEW.request_id IS OLD.request_id AND NEW.recording_id IS OLD.recording_id AND NEW.session_id IS OLD.session_id AND NEW.project_id IS OLD.project_id AND NEW.source_id IS OLD.source_id AND NEW.message_id IS OLD.message_id AND NEW.created_at IS OLD.created_at)
BEGIN SELECT RAISE(ABORT,'recording snapshot and receipt are immutable'); END;

--> statement-breakpoint
CREATE TRIGGER material_deletion_reply_update BEFORE UPDATE ON conversation_reply_requests
WHEN EXISTS(SELECT 1 FROM material_deletion_requests WHERE request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT,'retired reply cannot restore private captures'); END;
--> statement-breakpoint
DROP TRIGGER recording_chunks_captured_delete;
--> statement-breakpoint
CREATE TRIGGER recording_chunks_captured_delete BEFORE DELETE ON recording_chunks
WHEN EXISTS(SELECT 1 FROM recording_posts p JOIN sessions s ON s.id=p.session_id WHERE p.recording_id=OLD.recording_id)
 AND NOT EXISTS(SELECT 1 FROM recording_posts p JOIN material_deletion_requests d ON d.request_id=p.request_id WHERE p.recording_id=OLD.recording_id AND p.message_id IS NULL AND d.kind='recording')
BEGIN SELECT RAISE(ABORT,'captured recording PCM is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_request_valid BEFORE INSERT ON material_deletion_requests
WHEN NOT EXISTS(SELECT 1 FROM material_deletions d WHERE d.material_id=NEW.deletion_id AND d.status='pending') OR NOT (
 (NEW.kind='generation' AND (
  EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_deletion_requests c ON c.request_id=json_extract(r.payload,'$.documentTransform.contextRequestId') WHERE r.id=NEW.request_id AND c.kind='context' AND c.deletion_id=NEW.deletion_id) OR
  EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions v ON v.id=i.version_id JOIN material_deletion_members m ON m.material_id=v.material_id WHERE i.request_id=NEW.request_id AND m.deletion_id=NEW.deletion_id)
  OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members m ON m.material_id=v.material_id WHERE v.generation_request_id=NEW.request_id AND m.deletion_id=NEW.deletion_id)
  OR EXISTS(SELECT 1 FROM material_generation_requests r JOIN session_run_contexts c ON c.request_id=json_extract(r.payload,'$.documentTransform.contextRequestId'),json_tree(c.snapshot) j JOIN material_deletion_members m ON CAST(m.material_id AS TEXT)=CAST(j.value AS TEXT) WHERE r.id=NEW.request_id AND j.key='materialId' AND m.deletion_id=NEW.deletion_id)
 )) OR
 (NEW.kind='context' AND EXISTS(
  SELECT 1 FROM (SELECT request_id,snapshot FROM session_run_contexts UNION ALL SELECT request_id,snapshot FROM conversation_reply_requests) c,json_tree(c.snapshot) j
  WHERE c.request_id=NEW.request_id AND (
   (j.key='materialId' AND EXISTS(SELECT 1 FROM material_deletion_members m WHERE CAST(m.material_id AS TEXT)=CAST(j.value AS TEXT) AND m.deletion_id=NEW.deletion_id))
   OR (j.key='sourceId' AND EXISTS(SELECT 1 FROM material_imports i JOIN material_deletion_members m ON m.material_id=i.material_id WHERE CAST(i.source_id AS TEXT)=CAST(j.value AS TEXT) AND m.deletion_id=NEW.deletion_id))
  ))) OR
 (NEW.kind='source' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_imports i ON CAST(i.source_id AS TEXT)=json_extract(e.payload,'$.sourceId') JOIN material_deletion_members m ON m.material_id=i.material_id WHERE e.correlation_id=NEW.request_id AND m.deletion_id=NEW.deletion_id AND e.type IN ('SourceProcessingRequested','SourceCorrectionRequested','SourceIndexed','SourceProcessingFailed','SourceProjectChanged'))) OR
 (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_deletion_members m ON CAST(m.material_id AS TEXT)=json_extract(e.payload,'$.materialId') WHERE e.correlation_id=NEW.request_id AND m.deletion_id=NEW.deletion_id AND e.type IN ('MaterialPublished','MaterialAnnotationChanged'))) OR
 (NEW.kind='recording' AND EXISTS(SELECT 1 FROM source_recording_imports r JOIN material_imports i ON i.source_id=r.source_id JOIN material_deletion_members m ON m.material_id=i.material_id WHERE r.request_id=NEW.request_id AND m.deletion_id=NEW.deletion_id)) OR
 (NEW.kind='learning' AND (
  EXISTS(SELECT 1 FROM learning_practice_slots p,json_each(p.input_version_ids) j JOIN material_versions v ON CAST(v.id AS TEXT)=j.value JOIN material_deletion_members m ON m.material_id=v.material_id WHERE p.id=NEW.request_id AND m.deletion_id=NEW.deletion_id)
  OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_versions v ON v.id=a.version_id JOIN material_deletion_members m ON m.material_id=v.material_id WHERE e.correlation_id=NEW.request_id AND m.deletion_id=NEW.deletion_id AND e.type='QuizAnswerSubmitted')
 ))
)
BEGIN SELECT RAISE(ABORT,'retirement requires exact deleting Material ownership'); END;

--> statement-breakpoint
DROP TRIGGER catalog_source_update;
--> statement-breakpoint
CREATE TRIGGER catalog_source_update AFTER UPDATE OF name,project_id ON sources WHEN NOT EXISTS(SELECT 1 FROM material_imports i JOIN material_deletion_members d ON d.material_id=i.material_id WHERE i.source_id=NEW.id)
BEGIN DELETE FROM catalog_fts WHERE kind='source' AND target_id=old.id; INSERT INTO catalog_fts VALUES(new.name, 'source', new.id, new.project_id); END;

--> statement-breakpoint
CREATE TRIGGER material_file_versions_deletion_insert BEFORE INSERT ON material_file_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_audio_versions_deletion_insert BEFORE INSERT ON material_audio_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_video_versions_deletion_insert BEFORE INSERT ON material_video_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_image_versions_deletion_insert BEFORE INSERT ON material_image_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_link_versions_deletion_insert BEFORE INSERT ON material_link_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_document_versions_deletion_insert BEFORE INSERT ON material_document_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_diagram_versions_deletion_insert BEFORE INSERT ON material_diagram_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_quiz_versions_deletion_insert BEFORE INSERT ON material_quiz_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_flashcard_versions_deletion_insert BEFORE INSERT ON material_flashcard_versions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_deletion_insert BEFORE INSERT ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_flashcard_entries_deletion_insert BEFORE INSERT ON material_flashcard_entries WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_deletion_insert BEFORE INSERT ON material_source_snapshots WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_version_citations_deletion_insert BEFORE INSERT ON material_version_citations WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;

--> statement-breakpoint
CREATE TRIGGER material_annotation_deletion_insert BEFORE INSERT ON material_annotation_revisions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id)
BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore annotations'); END;
--> statement-breakpoint
CREATE TRIGGER material_assessment_deletion_insert BEFORE INSERT ON material_citation_assessments
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id IN (NEW.claim_version_id,NEW.evidence_version_id))
BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore assessments'); END;

--> statement-breakpoint
-- Deletion keeps existing published owners; it never makes remaining bytes newly acquirable.
CREATE TRIGGER document_asset_deleted_acquisition BEFORE INSERT ON document_assets
WHEN EXISTS(SELECT 1 FROM source_material_deletion_assets retired WHERE retired.source_id=NEW.source_id AND retired.revision=NEW.revision) AND NOT EXISTS(SELECT 1 FROM material_versions owner JOIN (
 SELECT dv.version_id,a.source_id,a.revision FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 UNION ALL SELECT version_id,source_id,revision FROM material_source_snapshots
 ) asset ON asset.version_id=owner.id
 WHERE asset.source_id=NEW.source_id AND asset.revision=NEW.revision AND owner.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=owner.material_id)
 )
BEGIN SELECT RAISE(ABORT,'deleted image requires a retained published owner'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_deleted_assets_insert BEFORE INSERT ON material_document_versions
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.document_id=NEW.document_id AND EXISTS(SELECT 1 FROM source_material_deletion_assets retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision) AND NOT EXISTS(SELECT 1 FROM material_versions owner JOIN (
 SELECT dv.version_id,a.source_id,a.revision FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 UNION ALL SELECT version_id,source_id,revision FROM material_source_snapshots
 ) asset ON asset.version_id=owner.id
 WHERE asset.source_id=a.source_id AND asset.revision=a.revision AND owner.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=owner.material_id)
 AND (owner.material_id=(SELECT material_id FROM material_versions WHERE id=NEW.version_id) OR EXISTS(
 SELECT 1 FROM material_version_inputs i WHERE i.version_id=NEW.version_id AND i.input_version_id=owner.id))))
BEGIN SELECT RAISE(ABORT,'deleted image requires explicit retained ownership'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_deleted_assets_update BEFORE UPDATE ON material_document_versions
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.document_id=NEW.document_id AND EXISTS(SELECT 1 FROM source_material_deletion_assets retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision) AND NOT EXISTS(SELECT 1 FROM material_versions owner JOIN (
 SELECT dv.version_id,a.source_id,a.revision FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 UNION ALL SELECT version_id,source_id,revision FROM material_source_snapshots
 ) asset ON asset.version_id=owner.id
 WHERE asset.source_id=a.source_id AND asset.revision=a.revision AND owner.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=owner.material_id)
 AND (owner.material_id=(SELECT material_id FROM material_versions WHERE id=NEW.version_id) OR EXISTS(
 SELECT 1 FROM material_version_inputs i WHERE i.version_id=NEW.version_id AND i.input_version_id=owner.id))))
BEGIN SELECT RAISE(ABORT,'deleted image requires explicit retained ownership'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_deleted_assets_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published' AND EXISTS(
 SELECT 1 FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 WHERE dv.version_id=NEW.id AND EXISTS(SELECT 1 FROM source_material_deletion_assets retired WHERE retired.source_id=a.source_id AND retired.revision=a.revision) AND NOT EXISTS(SELECT 1 FROM material_versions owner JOIN (
 SELECT dv.version_id,a.source_id,a.revision FROM material_document_versions dv JOIN document_assets a ON a.document_id=dv.document_id
 UNION ALL SELECT version_id,source_id,revision FROM material_source_snapshots
 ) asset ON asset.version_id=owner.id
 WHERE asset.source_id=a.source_id AND asset.revision=a.revision AND owner.status='published'
 AND NOT EXISTS(SELECT 1 FROM material_deletion_members d WHERE d.material_id=owner.material_id)
 AND (owner.material_id=(SELECT material_id FROM material_versions WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM material_version_inputs i WHERE i.version_id=NEW.id AND i.input_version_id=owner.id))))
BEGIN SELECT RAISE(ABORT,'deleted image cannot acquire a new publication owner'); END;
