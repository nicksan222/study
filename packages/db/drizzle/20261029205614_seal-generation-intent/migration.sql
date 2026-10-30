UPDATE material_generation_requests SET payload=json_set(payload,'$.inputVersionIds',json((SELECT json_group_array(CAST(version_id AS TEXT)) FROM (SELECT version_id FROM material_generation_inputs WHERE request_id=material_generation_requests.id ORDER BY position))));
--> statement-breakpoint
DROP TRIGGER material_versions_frozen;
--> statement-breakpoint
UPDATE material_versions SET generation_request_id=(SELECT id FROM material_generation_requests WHERE result_version_id=material_versions.id) WHERE EXISTS(SELECT 1 FROM material_generation_requests WHERE result_version_id=material_versions.id);
--> statement-breakpoint
CREATE TRIGGER material_versions_frozen BEFORE UPDATE ON material_versions
WHEN EXISTS(SELECT 1 FROM material_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=old.id AND v.status='published') OR new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.project_id IS NOT old.project_id OR new.kind IS NOT old.kind OR new.number IS NOT old.number OR new.created_at IS NOT old.created_at
BEGIN SELECT RAISE(ABORT, 'published versions and version identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.payload IS NOT OLD.payload OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'generation intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_retained BEFORE DELETE ON material_generation_requests
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'generation intent cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_immutable BEFORE UPDATE ON material_generation_inputs
BEGIN SELECT RAISE(ABORT, 'generation inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_retained BEFORE DELETE ON material_generation_inputs
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'generation inputs cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_captured BEFORE INSERT ON material_generation_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.id=NEW.version_id AND v.project_id=r.project_id JOIN materials m ON m.id=v.material_id WHERE r.id=NEW.request_id AND r.project_id=NEW.project_id AND CAST(json_extract(r.payload,'$.inputVersionIds[' || NEW.position || ']') AS TEXT)=CAST(NEW.version_id AS TEXT) AND v.status='published' AND v.kind='document' AND m.archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'generation input does not match captured intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_insert BEFORE INSERT ON material_generation_requests
WHEN NEW.result_version_id IS NOT NULL OR NEW.result_hash IS NOT NULL OR json_type(NEW.payload,'$.inputVersionIds') IS NOT 'array' OR json_array_length(NEW.payload,'$.inputVersionIds') NOT BETWEEN 1 AND 20 OR EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.inputVersionIds') WHERE type!='text' OR value NOT GLOB '[1-9]*' OR value GLOB '*[^0-9]*') OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.payload,'$.inputVersionIds'))!=json_array_length(NEW.payload,'$.inputVersionIds')
BEGIN SELECT RAISE(ABORT, 'invalid generation intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_binding_immutable BEFORE UPDATE OF generation_request_id ON material_versions
WHEN OLD.generation_request_id IS NOT NULL AND NEW.generation_request_id IS NOT OLD.generation_request_id
BEGIN SELECT RAISE(ABORT, 'generation binding is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(
 SELECT 1 FROM material_generation_requests r JOIN materials m ON m.id=NEW.material_id
 WHERE r.id=NEW.generation_request_id AND r.project_id=NEW.project_id AND json_extract(r.payload,'$.kind')=NEW.kind AND json_extract(r.payload,'$.title')=m.title AND json_extract(r.payload,'$.instruction') IS NEW.instruction
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=r.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=r.id)
)
BEGIN SELECT RAISE(ABORT, 'generated publication does not match its request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NOT EXISTS(
 SELECT 1 FROM material_versions v JOIN materials m ON m.id=v.material_id WHERE v.id=NEW.result_version_id AND v.project_id=NEW.project_id AND v.generation_request_id=NEW.id AND v.status='published' AND v.creator='agent' AND v.operation='generate' AND v.kind=json_extract(NEW.payload,'$.kind') AND v.instruction IS json_extract(NEW.payload,'$.instruction')
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=NEW.id)=json_array_length(NEW.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id)
))
BEGIN SELECT RAISE(ABORT, 'generation receipt does not identify its published output'); END;
--> statement-breakpoint
-- Validate backfilled receipts under the same guard as new publications. Inconsistent
-- historical data aborts the migrator transaction; it must never become a committed result.
UPDATE material_generation_requests SET result_version_id=result_version_id,result_hash=result_hash WHERE result_version_id IS NOT NULL;
