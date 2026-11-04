CREATE TRIGGER source_extraction_citation_retained BEFORE DELETE ON source_extraction_revisions
WHEN EXISTS(SELECT 1 FROM citations c WHERE c.document_id=OLD.snapshot_id)
BEGIN SELECT RAISE(ABORT,'raw citations retain exact source extraction'); END;
--> statement-breakpoint
CREATE TRIGGER source_citation_retained BEFORE DELETE ON sources
WHEN EXISTS(SELECT 1 FROM citations c JOIN content_snapshots body ON body.id=c.document_id WHERE body.source_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'raw citations retain exact source bytes and extraction'); END;
