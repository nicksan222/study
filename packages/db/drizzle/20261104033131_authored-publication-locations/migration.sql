CREATE TRIGGER study_document_publication_locations BEFORE UPDATE OF status ON study_document_versions
WHEN NEW.status='published' AND OLD.status!='published' AND EXISTS(
 SELECT 1 FROM blocks b WHERE b.document_id=NEW.content_snapshot_id AND
 (json_type(b.anchor) IS NOT 'object' OR json_extract(b.anchor,'$.type') IS NOT 'authored'))
BEGIN SELECT RAISE(ABORT,'authored publication requires authored block locations'); END;
