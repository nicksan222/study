-- Additive guards preserve existing published snapshot and session capture fences.
CREATE TRIGGER material_versions_retained_edit_insert BEFORE INSERT ON material_versions
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_retained_edit_update BEFORE UPDATE ON material_versions
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.id) OR EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_retained_edit_delete BEFORE DELETE ON material_versions
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_retained_edit_insert BEFORE INSERT ON material_document_versions
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_retained_edit_update BEFORE UPDATE ON material_document_versions
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_document_versions_retained_edit_delete BEFORE DELETE ON material_document_versions
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_retained_edit_insert BEFORE INSERT ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_retained_edit_update BEFORE UPDATE ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_inputs_retained_edit_delete BEFORE DELETE ON material_version_inputs
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_retained_edit_insert BEFORE INSERT ON material_version_parents
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_retained_edit_update BEFORE UPDATE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_retained_edit_delete BEFORE DELETE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_retained_edit_insert BEFORE INSERT ON material_version_citations
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_retained_edit_update BEFORE UPDATE ON material_version_citations
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_citations_retained_edit_delete BEFORE DELETE ON material_version_citations
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_retained_edit_insert BEFORE INSERT ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions d WHERE d.document_id=new.document_id AND (EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=d.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=d.version_id)))
BEGIN SELECT RAISE(ABORT, 'retained edit Documents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_retained_edit_update BEFORE UPDATE ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions d WHERE d.document_id=old.document_id AND (EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=d.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=d.version_id))) OR EXISTS(SELECT 1 FROM material_document_versions d WHERE d.document_id=new.document_id AND (EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=d.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=d.version_id)))
BEGIN SELECT RAISE(ABORT, 'retained edit Documents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER blocks_retained_edit_delete BEFORE DELETE ON blocks
WHEN EXISTS(SELECT 1 FROM material_document_versions d WHERE d.document_id=old.document_id AND (EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=d.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=d.version_id)))
BEGIN SELECT RAISE(ABORT, 'retained edit Documents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER documents_retained_edit_insert BEFORE INSERT ON documents
WHEN EXISTS(SELECT 1 FROM material_document_versions d WHERE d.document_id=new.id AND (EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=d.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=d.version_id)))
BEGIN SELECT RAISE(ABORT, 'retained edit Documents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER documents_retained_edit_update BEFORE UPDATE ON documents
WHEN EXISTS(SELECT 1 FROM material_document_versions d WHERE d.document_id=old.id AND (EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=d.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=d.version_id))) OR EXISTS(SELECT 1 FROM material_document_versions d WHERE d.document_id=new.id AND (EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=d.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=d.version_id)))
BEGIN SELECT RAISE(ABORT, 'retained edit Documents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER documents_retained_edit_delete BEFORE DELETE ON documents
WHEN EXISTS(SELECT 1 FROM material_document_versions d WHERE d.document_id=old.id AND (EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=d.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=d.version_id)))
BEGIN SELECT RAISE(ABORT, 'retained edit Documents are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_edit_receipts_update_immutable BEFORE UPDATE ON document_edit_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_edit_receipts_delete_immutable BEFORE DELETE ON document_edit_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_proposals_update_immutable BEFORE UPDATE ON document_proposals
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_proposals_delete_immutable BEFORE DELETE ON document_proposals
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_proposal_receipts_update_immutable BEFORE UPDATE ON document_proposal_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_proposal_receipts_delete_immutable BEFORE DELETE ON document_proposal_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;

--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_retained_edit_insert BEFORE INSERT ON material_source_snapshots
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_retained_edit_update BEFORE UPDATE ON material_source_snapshots
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=new.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=new.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_source_snapshots_retained_edit_delete BEFORE DELETE ON material_source_snapshots
WHEN EXISTS(SELECT 1 FROM document_edit_receipts WHERE submitted_version_id=old.version_id) OR EXISTS(SELECT 1 FROM document_proposals WHERE proposed_version_id=old.version_id)
BEGIN SELECT RAISE(ABORT, 'retained edit snapshots are immutable'); END;
