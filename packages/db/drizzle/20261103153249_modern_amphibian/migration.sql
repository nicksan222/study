-- Preserve invariant triggers around the Drizzle-generated materials rebuild.
DROP TRIGGER IF EXISTS "catalog_native_material_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_material_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_version_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_version_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "catalog_native_version_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "learning_practice_slot_capture";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_deletion_title";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_input_captured";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_publish";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_generation_receipt_valid";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "material_identity_update";
--> statement-breakpoint
ALTER TABLE `materials` ADD `description` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `create_key` text;--> statement-breakpoint
ALTER TABLE `materials` ADD `creation_intent` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_materials` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`create_key` text,
	`creation_intent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "materials_description_check" CHECK("description" IS NULL OR length("description") <= 240),
	CONSTRAINT "materials_creation_intent_check" CHECK(("create_key" IS NULL AND "creation_intent" IS NULL) OR (length("create_key") BETWEEN 1 AND 200 AND json_valid("creation_intent"))),
	CONSTRAINT "materials_kind_check" CHECK(kind IN ('file','audio','video','image','link','document','diagram','quiz','flashcards')),
	CONSTRAINT "materials_title_check" CHECK(length(trim(title)) BETWEEN 1 AND 200),
	CONSTRAINT "materials_times_check" CHECK(id > 0 AND typeof(created_at) = 'integer' AND typeof(updated_at) = 'integer' AND created_at >= 0 AND updated_at >= created_at AND (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at >= created_at)))
);
--> statement-breakpoint
INSERT INTO `__new_materials`(`id`, `kind`, `title`, `created_at`, `updated_at`, `archived_at`) SELECT `id`, `kind`, `title`, `created_at`, `updated_at`, `archived_at` FROM `materials`;--> statement-breakpoint
DROP TABLE `materials`;--> statement-breakpoint
ALTER TABLE `__new_materials` RENAME TO `materials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `materials_id_kind_unique` ON `materials` (`id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `materials_create_key_unique` ON `materials` (`create_key`);
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_delete BEFORE DELETE ON materials BEGIN DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.id; DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_update AFTER UPDATE OF title,archived_at ON materials WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_delete AFTER DELETE ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=old.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=old.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_insert AFTER INSERT ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_update AFTER UPDATE OF status,number ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
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
CREATE TRIGGER material_deletion_title BEFORE UPDATE ON materials
WHEN EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.id) AND (NEW.title!='-' OR NEW.kind IS NOT OLD.kind OR NEW.id IS NOT OLD.id)
BEGIN SELECT RAISE(ABORT,'deleted Material metadata is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_captured BEFORE INSERT ON material_generation_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.id=NEW.version_id AND (json_extract(r.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=r.project_id)) JOIN materials m ON m.id=v.material_id WHERE r.id=NEW.request_id AND CAST(json_extract(r.payload,'$.inputVersionIds[' || NEW.position || ']') AS TEXT)=CAST(NEW.version_id AS TEXT) AND v.status='published' AND (v.kind='document' OR EXISTS(SELECT 1 FROM material_source_snapshots pin WHERE pin.version_id=v.id AND pin.document_id IS NOT NULL)) AND m.archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'generation input does not match captured intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(
 SELECT 1 FROM material_generation_requests r JOIN materials m ON m.id=NEW.material_id
 WHERE r.id=NEW.generation_request_id AND (json_extract(r.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=NEW.material_id AND pm.project_id=r.project_id)) AND json_extract(r.payload,'$.kind')=NEW.kind AND json_extract(r.payload,'$.title')=m.title AND (CASE WHEN json_extract(r.payload,'$.documentTransform.contextRequestId') IS NOT NULL THEN NULL ELSE json_extract(r.payload,'$.instruction') END) IS NEW.instruction
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=r.id AND json_extract(r.payload,'$.kind')!='document' AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=r.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=r.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=r.id)
)
BEGIN SELECT RAISE(ABORT, 'generated publication does not match its request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NOT EXISTS(
 SELECT 1 FROM material_versions v JOIN materials m ON m.id=v.material_id WHERE v.id=NEW.result_version_id AND (json_extract(NEW.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=NEW.project_id)) AND v.generation_request_id=NEW.id AND (
   (v.status='published' AND json_extract(NEW.payload,'$.documentTransform.editTargetVersionId') IS NULL)
   OR (v.status='draft' AND NEW.cancelled=0 AND NEW.project_id IS NULL
    AND json_extract(NEW.payload,'$.kind')='document'
    AND json_extract(NEW.payload,'$.scopeId') IS NULL
    AND EXISTS (
     SELECT 1 FROM document_proposals p
     JOIN material_versions base ON base.id=p.base_version_id AND base.material_id=v.material_id
     JOIN material_document_versions proposed_doc ON proposed_doc.version_id=v.id
     JOIN material_document_versions base_doc ON base_doc.version_id=base.id
     JOIN session_run_contexts c ON c.request_id=json_extract(NEW.payload,'$.documentTransform.contextRequestId') AND c.session_id=p.session_id
     JOIN sessions se ON se.id=c.session_id
     WHERE p.request_id=NEW.id AND p.proposed_version_id=v.id
      AND NEW.id='document/' || c.request_id
      AND json_extract(c.snapshot,'$.requestId')=c.request_id
      AND json_extract(c.snapshot,'$.sessionId')=CAST(c.session_id AS TEXT)
      AND CAST(base.id AS TEXT)=json_extract(NEW.payload,'$.documentTransform.editTargetVersionId')
      AND base.kind='document' AND base.status='published' AND base.creator!='import'
      AND proposed_doc.document_id!=base_doc.document_id
      AND EXISTS(SELECT 1 FROM blocks WHERE document_id=proposed_doc.document_id)
      AND (SELECT COUNT(*) FROM material_version_parents WHERE version_id=v.id)=1
      AND EXISTS(SELECT 1 FROM material_version_parents WHERE version_id=v.id AND parent_version_id=base.id AND material_id=base.material_id)
      AND json_array_length(c.snapshot,'$.inputs')=json_array_length(NEW.payload,'$.inputVersionIds')
      AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') i WHERE
       json_extract(NEW.payload,'$.inputVersionIds[' || i.key || ']') IS NOT json_extract(i.value,'$.versionId'))
      AND EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') i WHERE
       json_extract(i.value,'$.versionId')=CAST(base.id AS TEXT)
       AND json_extract(i.value,'$.materialId')=CAST(base.material_id AS TEXT)
       AND json_extract(i.value,'$.documentId')=CAST(base_doc.document_id AS TEXT)
       AND json_extract(i.value,'$.scope.kind')='document')
    )
   )
  ) AND v.creator='agent' AND v.operation='generate' AND v.kind=json_extract(NEW.payload,'$.kind') AND v.instruction IS (CASE WHEN json_extract(NEW.payload,'$.documentTransform.contextRequestId') IS NOT NULL THEN NULL ELSE json_extract(NEW.payload,'$.instruction') END)
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=NEW.id)=json_array_length(NEW.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=NEW.id AND json_extract(NEW.payload,'$.kind')!='document' AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=NEW.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id)
))
BEGIN SELECT RAISE(ABORT, 'generation receipt does not identify its retained output'); END;
--> statement-breakpoint
CREATE TRIGGER material_identity_update BEFORE UPDATE ON materials
WHEN new.id IS NOT old.id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'material ownership and kind are immutable'); END;
