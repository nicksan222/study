CREATE TRIGGER study_document_retained_content_snapshots_insert BEFORE INSERT ON content_snapshots
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=NEW.id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_content_snapshots_update BEFORE UPDATE ON content_snapshots
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=OLD.id OR v.content_snapshot_id=NEW.id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_content_snapshots_delete BEFORE DELETE ON content_snapshots
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=OLD.id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_blocks_insert BEFORE INSERT ON blocks
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=NEW.document_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_blocks_update BEFORE UPDATE ON blocks
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_blocks_delete BEFORE DELETE ON blocks
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=OLD.document_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_document_assets_insert BEFORE INSERT ON document_assets
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=NEW.document_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_document_assets_update BEFORE UPDATE ON document_assets
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_document_assets_delete BEFORE DELETE ON document_assets
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.content_snapshot_id=OLD.document_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_versions_update BEFORE UPDATE ON study_document_versions
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=OLD.id OR v.id=NEW.id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_versions_delete BEFORE DELETE ON study_document_versions
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=OLD.id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_version_parents_insert BEFORE INSERT ON study_document_version_parents
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_version_parents_update BEFORE UPDATE ON study_document_version_parents
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=OLD.version_id OR v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_version_parents_delete BEFORE DELETE ON study_document_version_parents
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=OLD.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_inputs_insert BEFORE INSERT ON study_document_inputs
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_inputs_update BEFORE UPDATE ON study_document_inputs
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=OLD.version_id OR v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id)) AND NOT(OLD.message_version_id IS NOT NULL AND NEW.message_version_id IS NULL AND NEW.id IS OLD.id AND NEW.version_id IS OLD.version_id AND NEW.request_id IS OLD.request_id AND NEW.position IS OLD.position AND NEW.document_version_id IS OLD.document_version_id AND NEW.source_id IS OLD.source_id AND NEW.source_revision IS OLD.source_revision AND NEW.source_snapshot_id IS OLD.source_snapshot_id AND NEW.exact_message_version_id IS OLD.exact_message_version_id)
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_inputs_delete BEFORE DELETE ON study_document_inputs
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=OLD.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_citations_insert BEFORE INSERT ON study_document_citations
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_citations_update BEFORE UPDATE ON study_document_citations
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=OLD.version_id OR v.id=NEW.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retained_study_document_citations_delete BEFORE DELETE ON study_document_citations
WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE (v.id=OLD.version_id) AND (EXISTS(SELECT 1 FROM study_document_edit_receipts r WHERE r.submitted_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.proposed_version_id=v.id) OR EXISTS(SELECT 1 FROM study_document_generation_requests g WHERE g.result_version_id=v.id))
AND NOT EXISTS(SELECT 1 FROM study_document_retirements retired WHERE retired.version_id=v.id))
BEGIN SELECT RAISE(ABORT,'retained authored alternatives are immutable'); END;
