DROP TRIGGER study_document_publication_locations;
--> statement-breakpoint
CREATE TRIGGER study_document_publication_locations BEFORE UPDATE OF status ON study_document_versions
WHEN NEW.status='published' AND OLD.status!='published' AND EXISTS(SELECT 1 FROM blocks b WHERE b.document_id=NEW.content_snapshot_id AND NOT (CASE WHEN json_valid(b.anchor) THEN coalesce(
    json_type(b.anchor) = 'object' AND CASE json_extract(b.anchor, '$.type')
    WHEN 'authored' THEN 1
    WHEN 'time' THEN json_type(b.anchor, '$.startMs') = 'integer' AND json_extract(b.anchor, '$.startMs') >= 0
      AND json_type(b.anchor, '$.endMs') = 'integer' AND json_extract(b.anchor, '$.endMs') >= json_extract(b.anchor, '$.startMs')
    WHEN 'page' THEN json_type(b.anchor, '$.page') = 'integer' AND json_extract(b.anchor, '$.page') >= 1
    WHEN 'paragraph' THEN json_type(b.anchor, '$.index') = 'integer' AND json_extract(b.anchor, '$.index') >= 0
    WHEN 'slide' THEN json_type(b.anchor, '$.index') = 'integer' AND json_extract(b.anchor, '$.index') >= 0
    WHEN 'url' THEN json_type(b.anchor, '$.url') = 'text' AND length(trim(json_extract(b.anchor, '$.url'))) > 0
      AND json_type(b.anchor, '$.fragment') IN ('null', 'text')
    WHEN 'text' THEN json_type(b.anchor, '$.lineStart') = 'integer' AND json_extract(b.anchor, '$.lineStart') >= 0
      AND json_type(b.anchor, '$.lineEnd') = 'integer' AND json_extract(b.anchor, '$.lineEnd') >= json_extract(b.anchor, '$.lineStart')
      AND json_type(b.anchor, '$.start') = 'integer' AND json_extract(b.anchor, '$.start') >= 0
      AND json_type(b.anchor, '$.end') = 'integer' AND json_extract(b.anchor, '$.end') >= json_extract(b.anchor, '$.start')
    ELSE 0 END, 0) ELSE 0 END))
BEGIN SELECT RAISE(ABORT,'document publication requires canonical block locations'); END;
