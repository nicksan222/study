CREATE TRIGGER study_document_citation_retained BEFORE INSERT ON study_document_retirements
WHEN EXISTS(SELECT 1 FROM citations c JOIN study_document_versions v ON v.id=NEW.version_id WHERE c.authored_version_id=v.id OR c.document_id=v.content_snapshot_id)
BEGIN SELECT RAISE(ABORT,'raw citations retain exact authored bodies'); END;
