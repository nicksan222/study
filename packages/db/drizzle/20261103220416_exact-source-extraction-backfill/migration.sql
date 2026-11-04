-- A pending source replacement can retain the prior extraction while revision already names
-- the new input. Only exact prior publication roots may prove that extraction's revision.
DELETE FROM source_extraction_revisions
WHERE EXISTS (
 SELECT 1 FROM source_processing p
 WHERE p.source_id=source_extraction_revisions.source_id
 AND p.revision=source_extraction_revisions.revision
 AND p.document_id=source_extraction_revisions.snapshot_id
 AND p.published_request_id IS NOT p.request_id
)
AND NOT EXISTS (
 SELECT 1 FROM material_source_snapshots m
 WHERE m.source_id=source_extraction_revisions.source_id
 AND m.revision=source_extraction_revisions.revision
 AND m.document_id=source_extraction_revisions.snapshot_id
)
AND NOT EXISTS (
 SELECT 1 FROM study_document_inputs i
 WHERE i.source_id=source_extraction_revisions.source_id
 AND i.source_revision=source_extraction_revisions.revision
 AND i.source_snapshot_id=source_extraction_revisions.snapshot_id
);
--> statement-breakpoint
CREATE TRIGGER source_extraction_revision_owner BEFORE INSERT ON source_extraction_revisions
WHEN NOT EXISTS(SELECT 1 FROM content_snapshots WHERE id=NEW.snapshot_id AND source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'exact extraction must belong to its source'); END;
