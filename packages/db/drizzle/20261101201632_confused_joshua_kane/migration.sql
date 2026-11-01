DROP TRIGGER material_generation_result_immutable;
--> statement-breakpoint
DROP TRIGGER material_generation_intent_immutable;
--> statement-breakpoint
DROP TRIGGER material_generation_intent_retained;
--> statement-breakpoint
DROP TRIGGER material_generation_input_retained;
--> statement-breakpoint
DROP TRIGGER material_generation_intent_insert;
--> statement-breakpoint
DROP TRIGGER material_generation_publish;
--> statement-breakpoint
DROP TRIGGER material_generation_receipt_valid;
--> statement-breakpoint
DROP TRIGGER material_generation_request_scope;
--> statement-breakpoint
DROP TRIGGER material_generation_receipt_scope;
--> statement-breakpoint
DROP TRIGGER material_generation_publication_scope;
--> statement-breakpoint
DROP TRIGGER material_generation_question_specification;
--> statement-breakpoint
DROP TRIGGER material_generation_question_publication;
--> statement-breakpoint
DROP TRIGGER learning_practice_slot_publication;
--> statement-breakpoint
DROP TRIGGER material_generation_input_captured;
--> statement-breakpoint
ALTER TABLE `material_generation_requests` ADD `cancelled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `material_generation_requests` ADD `result_metadata` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_material_generation_requests` (
	`id` text PRIMARY KEY,
	`project_id` integer,
	`cancelled` integer DEFAULT false NOT NULL,
	`result_metadata` text,
	`payload` text NOT NULL,
	`result_version_id` integer,
	`result_hash` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_material_generation_requests_result_version_id_material_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT "material_generation_payload_check" CHECK(json_valid("payload")),
	CONSTRAINT "material_generation_result_pair_check" CHECK(("result_version_id" IS NULL) = ("result_hash" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_material_generation_requests`(`id`, `project_id`, `payload`, `result_version_id`, `result_hash`, `created_at`) SELECT `id`, `project_id`, `payload`, `result_version_id`, `result_hash`, `created_at` FROM `material_generation_requests`;--> statement-breakpoint
DROP TABLE `material_generation_requests`;--> statement-breakpoint
ALTER TABLE `__new_material_generation_requests` RENAME TO `material_generation_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `material_generation_requests_id_project_unique` ON `material_generation_requests` (`id`,`project_id`);
--> statement-breakpoint
CREATE TRIGGER material_generation_result_immutable BEFORE UPDATE OF result_version_id, result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.result_hash IS NOT OLD.result_hash)
BEGIN SELECT RAISE(ABORT, 'generation result is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.payload IS NOT OLD.payload OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'generation intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_retained BEFORE DELETE ON material_generation_requests
WHEN 1
BEGIN SELECT RAISE(ABORT, 'generation intent cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_retained BEFORE DELETE ON material_generation_inputs
WHEN EXISTS(SELECT 1 FROM material_generation_requests WHERE id=OLD.request_id)
BEGIN SELECT RAISE(ABORT, 'generation inputs cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_insert BEFORE INSERT ON material_generation_requests
WHEN NEW.result_version_id IS NOT NULL OR NEW.result_hash IS NOT NULL OR json_type(NEW.payload,'$.inputVersionIds') IS NOT 'array' OR json_array_length(NEW.payload,'$.inputVersionIds') NOT BETWEEN CASE WHEN json_extract(NEW.payload,'$.kind')='document' THEN 0 ELSE 1 END AND 20 OR EXISTS(SELECT 1 FROM json_each(NEW.payload,'$.inputVersionIds') WHERE type!='text' OR value NOT GLOB '[1-9]*' OR value GLOB '*[^0-9]*') OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.payload,'$.inputVersionIds'))!=json_array_length(NEW.payload,'$.inputVersionIds')
BEGIN SELECT RAISE(ABORT, 'invalid generation intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(
 SELECT 1 FROM material_generation_requests r JOIN materials m ON m.id=NEW.material_id
 WHERE r.id=NEW.generation_request_id AND (json_extract(r.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=NEW.material_id AND pm.project_id=r.project_id)) AND json_extract(r.payload,'$.kind')=NEW.kind AND json_extract(r.payload,'$.title')=m.title AND json_extract(r.payload,'$.instruction') IS NEW.instruction
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=r.id AND json_extract(r.payload,'$.kind')!='document' AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=r.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=r.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=r.id)
)
BEGIN SELECT RAISE(ABORT, 'generated publication does not match its request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NOT EXISTS(
 SELECT 1 FROM material_versions v JOIN materials m ON m.id=v.material_id WHERE v.id=NEW.result_version_id AND (json_extract(NEW.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=NEW.project_id)) AND v.generation_request_id=NEW.id AND v.status='published' AND v.creator='agent' AND v.operation='generate' AND v.kind=json_extract(NEW.payload,'$.kind') AND v.instruction IS json_extract(NEW.payload,'$.instruction')
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=NEW.id)=json_array_length(NEW.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=NEW.id AND json_extract(NEW.payload,'$.kind')!='document' AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=NEW.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id)
))
BEGIN SELECT RAISE(ABORT, 'generation receipt does not identify its published output'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_request_scope
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM material_generation_scopes s
  WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for this project'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_scope
BEFORE UPDATE OF result_version_id ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL
  AND json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM material_generation_scopes s
    WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
  )
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publication_scope
BEFORE UPDATE OF status ON material_versions
WHEN NEW.status = 'published' AND OLD.status != 'published' AND EXISTS (
  SELECT 1 FROM material_generation_requests r
  WHERE r.id = NEW.generation_request_id AND json_extract(r.payload, '$.scopeId') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM material_generation_scopes s
      WHERE s.id = json_extract(r.payload, '$.scopeId') AND s.project_id = r.project_id AND s.enabled = 1)
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_question_specification
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.questionSpec') IS NOT NULL AND (
  json_type(NEW.payload, '$.questionSpec') IS NOT 'object'
  OR json_extract(NEW.payload, '$.kind') IS NOT 'quiz'
  OR json_extract(NEW.payload, '$.questionSpec.count') IS NOT 1
  OR json_extract(NEW.payload, '$.questionSpec.kind') IS NULL
  OR json_extract(NEW.payload, '$.questionSpec.kind') NOT IN ('choice', 'open')
)
BEGIN SELECT RAISE(ABORT, 'invalid generation question specification'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_question_publication
BEFORE UPDATE OF status ON material_versions
WHEN NEW.status = 'published' AND OLD.status != 'published' AND EXISTS (
  SELECT 1 FROM material_generation_requests r WHERE r.id = NEW.generation_request_id
    AND json_extract(r.payload, '$.questionSpec') IS NOT NULL AND (
      NEW.kind != 'quiz'
      OR (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = NEW.id) != 1
      OR EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = NEW.id AND (
        (json_extract(r.payload, '$.questionSpec.kind') = 'open' AND q.kind != 'open')
        OR (json_extract(r.payload, '$.questionSpec.kind') = 'choice' AND q.kind NOT IN ('single_choice', 'multiple_choice'))
      ))
    )
)
BEGIN SELECT RAISE(ABORT, 'generated quiz does not match its captured question specification'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_publication
BEFORE UPDATE OF version_id,attempt_id,status ON learning_practice_slots
WHEN OLD.version_id IS NULL AND NEW.version_id IS NOT NULL AND (
  NEW.status != 'ready' OR NOT EXISTS (
    SELECT 1 FROM learning_practice_controls c JOIN material_generation_scopes g ON g.id = c.epoch AND g.project_id = c.project_id
    JOIN material_versions v ON v.id = NEW.version_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=c.project_id)
    JOIN material_generation_requests r ON r.id = NEW.id AND r.project_id = c.project_id AND r.result_version_id = v.id
    JOIN material_quiz_attempts a ON a.id = NEW.attempt_id AND a.version_id = v.id
    WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1 AND g.enabled = 1
      AND v.status = 'published' AND v.kind = 'quiz' AND v.generation_request_id = NEW.id
      AND json_extract(r.payload, '$.scopeId') = NEW.epoch
      AND json_extract(r.payload, '$.questionSpec.count') = 1 AND json_extract(r.payload, '$.questionSpec.kind') = NEW.kind
      AND json_extract(r.payload, '$.inputVersionIds') = json(NEW.input_version_ids)
      AND (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = v.id) = 1
      AND NOT EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = v.id AND ((NEW.kind = 'open' AND q.kind != 'open') OR (NEW.kind = 'choice' AND q.kind NOT IN ('single_choice','multiple_choice'))))
  )
)
BEGIN SELECT RAISE(ABORT, 'practice publication does not match its slot'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_captured BEFORE INSERT ON material_generation_inputs
WHEN NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.id=NEW.version_id AND (json_extract(r.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=r.project_id)) JOIN materials m ON m.id=v.material_id WHERE r.id=NEW.request_id AND CAST(json_extract(r.payload,'$.inputVersionIds[' || NEW.position || ']') AS TEXT)=CAST(NEW.version_id AS TEXT) AND v.status='published' AND (v.kind='document' OR EXISTS(SELECT 1 FROM material_source_snapshots pin WHERE pin.version_id=v.id AND pin.document_id IS NOT NULL)) AND m.archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'generation input does not match captured intent'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_session_scope BEFORE INSERT ON material_generation_requests
WHEN (json_extract(NEW.payload,'$.kind')='document' AND (
 NEW.project_id IS NOT NULL OR json_extract(NEW.payload,'$.scopeId') IS NOT NULL OR
 NOT EXISTS(SELECT 1 FROM session_run_contexts c WHERE c.request_id=json_extract(NEW.payload,'$.documentTransform.contextRequestId') AND NEW.id='document/' || c.request_id
 AND json_array_length(NEW.payload,'$.inputVersionIds')=json_array_length(c.snapshot,'$.inputs')
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') i WHERE
 json_extract(NEW.payload,'$.inputVersionIds[' || i.key || ']') IS NOT json_extract(i.value,'$.versionId')))

)) OR (json_extract(NEW.payload,'$.kind')!='document' AND (NEW.project_id IS NULL OR json_extract(NEW.payload,'$.documentTransform') IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'invalid generation scope'); END;

--> statement-breakpoint
CREATE TRIGGER material_generation_cancel_fence BEFORE UPDATE ON material_generation_requests
WHEN (OLD.cancelled=1 AND NEW.cancelled!=1) OR (NEW.cancelled=1 AND OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL)
 OR (OLD.result_version_id IS NOT NULL AND NEW.result_metadata IS NOT OLD.result_metadata)
BEGIN SELECT RAISE(ABORT, 'generation cancellation and result metadata are immutable'); END;

--> statement-breakpoint
CREATE TRIGGER material_generation_session_publication BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published' AND EXISTS (
 SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.generation_request_id AND
 (r.cancelled=1 OR (json_extract(r.payload,'$.kind')='document' AND NOT EXISTS(
 SELECT 1 FROM session_run_contexts c JOIN sessions se ON se.id=c.session_id
 WHERE c.request_id=json_extract(r.payload,'$.documentTransform.contextRequestId')))))
BEGIN SELECT RAISE(ABORT, 'generation session is unavailable or cancelled'); END;
