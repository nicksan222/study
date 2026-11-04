CREATE TRIGGER source_extraction_blocks_insert BEFORE INSERT ON blocks
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_blocks_update BEFORE UPDATE ON blocks
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.document_id) OR EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_blocks_delete BEFORE DELETE ON blocks
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_document_assets_insert BEFORE INSERT ON document_assets
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_document_assets_update BEFORE UPDATE ON document_assets
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.document_id) OR EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_document_assets_delete BEFORE DELETE ON document_assets
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.document_id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_content_snapshots_update BEFORE UPDATE ON content_snapshots
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.id) OR EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_content_snapshots_delete BEFORE DELETE ON content_snapshots
WHEN EXISTS(SELECT 1 FROM source_extraction_revisions WHERE snapshot_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'retained source extraction is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER source_extraction_identity_update BEFORE UPDATE ON source_extraction_revisions BEGIN SELECT RAISE(ABORT,'retained extraction identity is immutable'); END;
