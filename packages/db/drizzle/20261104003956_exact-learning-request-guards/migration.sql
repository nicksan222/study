DROP TRIGGER material_generation_intent_insert;
--> statement-breakpoint
DROP TRIGGER material_generation_session_scope;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_insert BEFORE INSERT ON material_generation_requests
WHEN NEW.result_version_id IS NOT NULL OR NEW.result_hash IS NOT NULL
 OR json_type(NEW.payload,'$.inputs') IS NOT 'array' OR json_array_length(NEW.payload,'$.inputs') NOT BETWEEN 1 AND 20
 OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.payload,'$.inputs'))!=json_array_length(NEW.payload,'$.inputs')
 OR EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.inputs') j WHERE j.type!='object'
 OR json_extract(j.value,'$.kind') IS NULL OR json_extract(j.value,'$.kind') NOT IN ('source','document')
 OR (json_extract(j.value,'$.kind')='document' AND (json_type(j.value,'$.versionId') IS NOT 'text'
 OR json_extract(j.value,'$.versionId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.versionId') GLOB '*[^0-9]*'))
 OR (json_extract(j.value,'$.kind')='source' AND (json_type(j.value,'$.sourceId') IS NOT 'text'
 OR json_extract(j.value,'$.sourceId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.sourceId') GLOB '*[^0-9]*'
 OR json_type(j.value,'$.revision') IS NOT 'text' OR json_extract(j.value,'$.revision') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.revision') GLOB '*[^0-9]*'
 OR json_type(j.value,'$.snapshotId') IS NOT 'text' OR json_extract(j.value,'$.snapshotId') NOT GLOB '[1-9]*' OR json_extract(j.value,'$.snapshotId') GLOB '*[^0-9]*')))
BEGIN SELECT RAISE(ABORT,'invalid exact generation intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_session_scope BEFORE INSERT ON material_generation_requests
WHEN NEW.project_id IS NULL OR json_extract(NEW.payload,'$.kind') IS NULL
 OR json_extract(NEW.payload,'$.kind') NOT IN ('diagram','quiz','flashcards')
 OR json_extract(NEW.payload,'$.documentTransform') IS NOT NULL
BEGIN SELECT RAISE(ABORT,'invalid learning generation scope'); END;
