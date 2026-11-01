
CREATE TRIGGER material_import_document_canonical_shape BEFORE UPDATE OF status ON material_versions WHEN new.status='published' AND new.kind IN ('file','audio','video','image','link') AND (EXISTS(SELECT 1 FROM material_source_snapshots c JOIN blocks b ON b.document_id=c.document_id WHERE c.version_id=new.id AND NOT (CASE WHEN json_valid(b.anchor) THEN coalesce(
    json_type(b.anchor) = 'object' AND CASE json_extract(b.anchor, '$.type')
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
    ELSE 0 END, 0) ELSE 0 END)) OR EXISTS(SELECT 1 FROM material_source_snapshots c JOIN documents d ON d.id=c.document_id WHERE c.version_id=new.id AND NOT (CASE WHEN json_valid(d.meta) THEN coalesce(
    json_type(d.meta) = 'object'
    AND json_type(d.meta, '$.extractor') IN ('null','text')
    AND json_type(d.meta, '$.extractorVersion') = 'integer' AND json_extract(d.meta, '$.extractorVersion') >= 0
    AND json_type(d.meta, '$.provider') IN ('null','text')
    AND (json_type(d.meta, '$.durationMs') = 'null' OR (json_type(d.meta, '$.durationMs') = 'integer' AND json_extract(d.meta, '$.durationMs') >= 0))
    AND (json_type(d.meta, '$.pageCount') = 'null' OR (json_type(d.meta, '$.pageCount') = 'integer' AND json_extract(d.meta, '$.pageCount') >= 0))
    AND json_type(d.meta, '$.corrected') IN ('true','false')
    AND json_type(d.meta, '$.refiners') = 'array'
    AND json_type(d.meta, '$.waitingFor') = 'array'
    AND NOT EXISTS(SELECT 1 FROM json_each(d.meta, '$.waitingFor') w WHERE w.type != 'text')
    AND NOT EXISTS(SELECT 1 FROM json_each(d.meta, '$.refiners') r WHERE CASE WHEN r.type = 'object' THEN coalesce(
      json_type(r.value, '$.refiner') = 'text' AND length(trim(json_extract(r.value, '$.refiner'))) > 0
      AND json_type(r.value, '$.version') = 'integer' AND json_extract(r.value, '$.version') >= 0, 0) ELSE 0 END = 0)
    , 0) ELSE 0 END))) BEGIN SELECT RAISE(ABORT, 'published documents require canonical anchors and metadata'); END;

--> statement-breakpoint
CREATE TRIGGER import_documents_insert_frozen BEFORE INSERT ON documents
WHEN EXISTS(SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.document_id=new.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published imported document is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_documents_update_frozen BEFORE UPDATE ON documents
WHEN EXISTS(SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.document_id=old.id AND v.status='published') OR EXISTS(SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.document_id=new.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published imported document is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_documents_delete_frozen BEFORE DELETE ON documents
WHEN EXISTS(SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.document_id=old.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published imported document is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_blocks_insert_frozen BEFORE INSERT ON blocks
WHEN EXISTS(SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.document_id=new.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published imported document is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_blocks_update_frozen BEFORE UPDATE ON blocks
WHEN EXISTS(SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.document_id=old.document_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.document_id=new.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published imported document is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_blocks_delete_frozen BEFORE DELETE ON blocks
WHEN EXISTS(SELECT 1 FROM material_source_snapshots pin JOIN material_versions v ON v.id=pin.version_id WHERE pin.document_id=old.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published imported document is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER import_document_source_insert BEFORE INSERT ON material_source_snapshots
WHEN new.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM documents d JOIN material_versions v ON v.id=new.version_id JOIN material_imports i ON i.material_id=v.material_id AND i.source_id=new.source_id WHERE d.id=new.document_id AND d.source_id=new.source_id)
BEGIN SELECT RAISE(ABORT, 'imported document must match its bound source'); END;
--> statement-breakpoint
CREATE TRIGGER import_document_source_update BEFORE UPDATE ON material_source_snapshots
WHEN new.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM documents d JOIN material_versions v ON v.id=new.version_id JOIN material_imports i ON i.material_id=v.material_id AND i.source_id=new.source_id WHERE d.id=new.document_id AND d.source_id=new.source_id)
BEGIN SELECT RAISE(ABORT, 'imported document must match its bound source'); END;
--> statement-breakpoint
CREATE TRIGGER material_import_identity_update BEFORE UPDATE ON material_imports
BEGIN SELECT RAISE(ABORT, 'import identity is immutable'); END;

--> statement-breakpoint
DROP TRIGGER material_generation_input_captured;
--> statement-breakpoint

CREATE TRIGGER material_generation_input_captured BEFORE INSERT ON material_generation_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.id=NEW.version_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=r.project_id) JOIN materials m ON m.id=v.material_id WHERE r.id=NEW.request_id AND CAST(json_extract(r.payload,'$.inputVersionIds[' || NEW.position || ']') AS TEXT)=CAST(NEW.version_id AS TEXT) AND v.status='published' AND (v.kind='document' OR EXISTS(SELECT 1 FROM material_source_snapshots pin WHERE pin.version_id=v.id AND pin.document_id IS NOT NULL)) AND m.archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'generation input does not match captured intent'); END;

--> statement-breakpoint
CREATE TRIGGER material_import_document_nonempty BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND EXISTS(SELECT 1 FROM material_source_snapshots pin WHERE pin.version_id=new.id AND pin.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.document_id=pin.document_id AND length(trim(b.text))>0))
BEGIN SELECT RAISE(ABORT, 'imported extraction requires nonempty canonical content'); END;

--> statement-breakpoint
DROP TRIGGER learning_practice_slot_capture;
--> statement-breakpoint

CREATE TRIGGER learning_practice_slot_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.status != 'pending' OR NEW.version_id IS NOT NULL OR NEW.attempt_id IS NOT NULL
  OR NEW.kind IS NOT CASE WHEN NEW.ordinal % 3 = 2 THEN 'open' ELSE 'choice' END
  OR NOT EXISTS (SELECT 1 FROM learning_practice_controls c WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1)
  OR (SELECT COUNT(*) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch AND p.status IN ('pending','ready')) >= 2
  OR NEW.ordinal != (SELECT COALESCE(MAX(p.ordinal) + 1, 0) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch)
  OR json_type(NEW.input_version_ids) IS NOT 'array' OR json_array_length(NEW.input_version_ids) NOT BETWEEN 1 AND 20
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.input_version_ids)) != json_array_length(NEW.input_version_ids)
  OR EXISTS (SELECT 1 FROM json_each(NEW.input_version_ids) j WHERE j.type != 'text' OR NOT EXISTS (
    SELECT 1 FROM material_versions v JOIN materials m ON m.id = v.material_id JOIN (SELECT version_id FROM material_document_versions UNION ALL SELECT version_id FROM material_source_snapshots WHERE document_id IS NOT NULL) d ON d.version_id = v.id
    WHERE CAST(v.id AS TEXT) = j.value AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=NEW.project_id) AND v.status = 'published' AND m.archived_at IS NULL
  ))
BEGIN SELECT RAISE(ABORT, 'invalid or unbounded practice slot capture'); END;

--> statement-breakpoint
CREATE TRIGGER material_import_identity_delete BEFORE DELETE ON material_imports
BEGIN SELECT RAISE(ABORT, 'import identity is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_import_identity_insert BEFORE INSERT ON material_imports
WHEN NOT EXISTS(SELECT 1 FROM material_versions v JOIN material_source_snapshots pin ON pin.version_id=v.id WHERE v.material_id=new.material_id AND pin.source_id=new.source_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'import identity requires its published original'); END;

--> statement-breakpoint
CREATE TRIGGER material_import_snapshot_binding_insert BEFORE INSERT ON material_source_snapshots
WHEN EXISTS(SELECT 1 FROM material_imports i JOIN material_versions v ON v.material_id=i.material_id WHERE v.id=new.version_id AND i.source_id!=new.source_id)
BEGIN SELECT RAISE(ABORT, 'import snapshot must match its bound source'); END;

--> statement-breakpoint
CREATE TRIGGER material_import_snapshot_binding_update BEFORE UPDATE ON material_source_snapshots
WHEN EXISTS(SELECT 1 FROM material_imports i JOIN material_versions v ON v.material_id=i.material_id WHERE v.id=new.version_id AND i.source_id!=new.source_id)
BEGIN SELECT RAISE(ABORT, 'import snapshot must match its bound source'); END;
