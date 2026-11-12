-- The migrator disables foreign keys. Capture exact ownership before deleting only diagrams.
PRAGMA legacy_alter_table=ON;
--> statement-breakpoint
-- Deletion fences outlive content; never reuse any previously allocated material ID.
CREATE TEMP TABLE removed_diagram_sequence AS SELECT coalesce(max(seq),0) AS seq FROM sqlite_sequence WHERE name='materials';
--> statement-breakpoint
DELETE FROM preferences WHERE scope='agent-rules' AND key='diagrams';
--> statement-breakpoint
CREATE TEMP TABLE removed_diagram_materials AS SELECT id FROM materials WHERE kind='diagram';
--> statement-breakpoint
CREATE TEMP TABLE removed_diagram_versions AS SELECT id FROM material_versions WHERE material_id IN (SELECT id FROM removed_diagram_materials);
--> statement-breakpoint
CREATE TEMP TABLE removed_diagram_history AS SELECT operation_id FROM material_history_prunes WHERE material_id IN (SELECT id FROM removed_diagram_materials);
--> statement-breakpoint
CREATE TEMP TABLE removed_diagram_requests AS
SELECT id FROM material_generation_requests WHERE json_extract(payload,'$.kind')='diagram'
 OR result_version_id IN (SELECT id FROM removed_diagram_versions)
UNION SELECT generation_request_id FROM material_versions WHERE id IN (SELECT id FROM removed_diagram_versions) AND generation_request_id IS NOT NULL
UNION SELECT request_id FROM material_history_requests WHERE kind='generation' AND operation_id IN (SELECT operation_id FROM removed_diagram_history)
UNION SELECT request_id FROM material_deletion_requests WHERE kind='generation' AND deletion_id IN (SELECT id FROM removed_diagram_materials);
--> statement-breakpoint
CREATE TEMP TABLE removed_diagram_events AS SELECT event_id FROM workflow_events WHERE
 (type IN ('MaterialGenerationRequested','MaterialGenerationFailed') AND (json_extract(payload,'$.kind')='diagram' OR json_extract(payload,'$.requestId') IN (SELECT id FROM removed_diagram_requests)))
 OR (type IN ('MaterialPublished','MaterialDeletionRequested') AND CAST(json_extract(payload,'$.materialId') AS INTEGER) IN (SELECT id FROM removed_diagram_materials))
 OR (type='MaterialHistoryPruneRequested' AND json_extract(payload,'$.operationId') IN (SELECT operation_id FROM removed_diagram_history));
--> statement-breakpoint
CREATE TEMP TABLE removed_diagram_executions AS WITH RECURSIVE removed(execution_id) AS (
 SELECT execution_id FROM workflow_executions WHERE json_extract(payload,'$.event.eventId') IN (SELECT event_id FROM removed_diagram_events)
 OR (json_extract(payload,'$.event.type') IN ('MaterialGenerationRequested','MaterialGenerationFailed') AND json_extract(payload,'$.event.requestId') IN (SELECT id FROM removed_diagram_requests))
 OR (json_extract(payload,'$.event.type')='MaterialHistoryPruneRequested' AND json_extract(payload,'$.event.operationId') IN (SELECT operation_id FROM removed_diagram_history))
 OR (json_extract(payload,'$.event.type')='MaterialDeletionRequested' AND CAST(json_extract(payload,'$.event.materialId') AS INTEGER) IN (SELECT id FROM removed_diagram_materials))
 UNION SELECT child.execution_id FROM workflow_executions child JOIN removed parent ON child.parent_execution_id=parent.execution_id
) SELECT execution_id FROM removed;
--> statement-breakpoint
DROP TRIGGER "material_deletion_title";
--> statement-breakpoint
DROP TRIGGER "material_evidence_citations_retained";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_owner";
--> statement-breakpoint
DROP TRIGGER "material_evidence_inputs_retained";
--> statement-breakpoint
DROP TRIGGER "material_generation_intent_retained";
--> statement-breakpoint
DROP TRIGGER "material_generation_note_scope";
--> statement-breakpoint
DROP TRIGGER "material_history_members_delete";
--> statement-breakpoint
DROP TRIGGER "material_history_prunes_retained";
--> statement-breakpoint
DROP TRIGGER "material_history_requests_delete";
--> statement-breakpoint
DROP TRIGGER "material_identity_update";
--> statement-breakpoint
DROP TRIGGER "material_version_parents_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_versions_delete_frozen";
--> statement-breakpoint
DROP TRIGGER "material_versions_publish_payload";
--> statement-breakpoint
DROP TRIGGER "material_generation_publish";
--> statement-breakpoint
DROP TRIGGER "material_generation_receipt_valid";
--> statement-breakpoint
DROP TRIGGER "catalog_native_material_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_material_update";
--> statement-breakpoint
DELETE FROM workflow_configuration_waits WHERE execution_id IN (SELECT execution_id FROM removed_diagram_executions);
--> statement-breakpoint
DELETE FROM workflow_agent_progress WHERE execution_id IN (SELECT execution_id FROM removed_diagram_executions);
--> statement-breakpoint
DELETE FROM workflow_clocks WHERE execution_id IN (SELECT execution_id FROM removed_diagram_executions);
--> statement-breakpoint
DELETE FROM workflow_deferreds WHERE execution_id IN (SELECT execution_id FROM removed_diagram_executions);
--> statement-breakpoint
DELETE FROM workflow_activities WHERE execution_id IN (SELECT execution_id FROM removed_diagram_executions);
--> statement-breakpoint
DELETE FROM workflow_receipts WHERE execution_id IN (SELECT execution_id FROM removed_diagram_executions) OR event_id IN (SELECT event_id FROM removed_diagram_events);
--> statement-breakpoint
DELETE FROM workflow_executions WHERE execution_id IN (SELECT execution_id FROM removed_diagram_executions);
--> statement-breakpoint
DELETE FROM workflow_events WHERE event_id IN (SELECT event_id FROM removed_diagram_events);
--> statement-breakpoint
DELETE FROM semantic_search_entries WHERE json_extract(target,'$.type')='material' AND CAST(json_extract(target,'$.materialId') AS INTEGER) IN (SELECT id FROM removed_diagram_materials);
--> statement-breakpoint
DELETE FROM catalog_fts WHERE kind='material' AND target_id IN (SELECT id FROM removed_diagram_materials);
--> statement-breakpoint
DELETE FROM material_evidence_citations WHERE version_id IN (SELECT id FROM removed_diagram_versions) OR input_id IN (SELECT id FROM material_evidence_inputs WHERE request_id IN (SELECT id FROM removed_diagram_requests));
--> statement-breakpoint
DELETE FROM material_evidence_inputs WHERE version_id IN (SELECT id FROM removed_diagram_versions) OR request_id IN (SELECT id FROM removed_diagram_requests);
--> statement-breakpoint
DELETE FROM material_version_parents WHERE version_id IN (SELECT id FROM removed_diagram_versions) OR parent_version_id IN (SELECT id FROM removed_diagram_versions);
--> statement-breakpoint
DELETE FROM material_history_requests WHERE operation_id IN (SELECT operation_id FROM removed_diagram_history);
--> statement-breakpoint
DELETE FROM material_history_members WHERE version_id IN (SELECT id FROM removed_diagram_versions);
--> statement-breakpoint
DELETE FROM material_history_prunes WHERE operation_id IN (SELECT operation_id FROM removed_diagram_history);
--> statement-breakpoint
DELETE FROM project_materials WHERE material_id IN (SELECT id FROM removed_diagram_materials);
--> statement-breakpoint
DELETE FROM note_materials WHERE material_id IN (SELECT id FROM removed_diagram_materials);
--> statement-breakpoint
DELETE FROM material_versions WHERE id IN (SELECT id FROM removed_diagram_versions);
--> statement-breakpoint
DELETE FROM material_generation_requests WHERE id IN (SELECT id FROM removed_diagram_requests);
--> statement-breakpoint
DELETE FROM materials WHERE id IN (SELECT id FROM removed_diagram_materials);
--> statement-breakpoint
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
	CONSTRAINT "materials_kind_check" CHECK(kind IN ('quiz','flashcards')),
	CONSTRAINT "materials_title_check" CHECK(length(trim(title)) BETWEEN 1 AND 200),
	CONSTRAINT "materials_times_check" CHECK(id > 0 AND typeof(created_at) = 'integer' AND typeof(updated_at) = 'integer' AND created_at >= 0 AND updated_at >= created_at AND (archived_at IS NULL OR (typeof(archived_at) = 'integer' AND archived_at >= created_at)))
);
--> statement-breakpoint
INSERT INTO `__new_materials`(`id`, `kind`, `title`, `description`, `create_key`, `creation_intent`, `created_at`, `updated_at`, `archived_at`) SELECT `id`, `kind`, `title`, `description`, `create_key`, `creation_intent`, `created_at`, `updated_at`, `archived_at` FROM `materials`;--> statement-breakpoint
DROP TABLE `materials`;--> statement-breakpoint
ALTER TABLE `__new_materials` RENAME TO `materials`;--> statement-breakpoint
DELETE FROM sqlite_sequence WHERE name='materials';
--> statement-breakpoint
INSERT INTO sqlite_sequence(name,seq) SELECT 'materials',seq FROM removed_diagram_sequence;
--> statement-breakpoint
DROP TABLE removed_diagram_sequence;
--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `materials_id_kind_unique` ON `materials` (`id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `materials_create_key_unique` ON `materials` (`create_key`);--> statement-breakpoint
DROP TABLE `material_diagram_versions`;
--> statement-breakpoint
CREATE TRIGGER material_deletion_title BEFORE UPDATE ON materials
WHEN EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.id) AND (NEW.title!='-' OR NEW.kind IS NOT OLD.kind OR NEW.id IS NOT OLD.id)
BEGIN SELECT RAISE(ABORT,'deleted Material metadata is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_citations_retained BEFORE DELETE ON material_evidence_citations
WHEN EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published') AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))
BEGIN SELECT RAISE(ABORT,'published learning citations are retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_owner BEFORE INSERT ON material_evidence_inputs
WHEN (NEW.version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_versions v WHERE v.id=NEW.version_id AND v.status='draft' AND v.kind IN ('quiz','flashcards')))
 OR (NEW.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=NEW.request_id AND r.cancelled=0 AND r.result_version_id IS NULL
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].kind')=CASE WHEN NEW."page_version_id" IS NULL THEN 'source' ELSE 'page' END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].versionId') IS CASE WHEN NEW."page_version_id" IS NULL THEN NULL ELSE CAST(NEW."page_version_id" AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].sourceId') IS CASE WHEN NEW.source_id IS NULL THEN NULL ELSE CAST(NEW.source_id AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].revision') IS CASE WHEN NEW.source_revision IS NULL THEN NULL ELSE CAST(NEW.source_revision AS TEXT) END
 AND json_extract(r.payload,'$.inputs['||NEW.position||'].snapshotId') IS CASE WHEN NEW.source_snapshot_id IS NULL THEN NULL ELSE CAST(NEW.source_snapshot_id AS TEXT) END))
BEGIN SELECT RAISE(ABORT,'exact learning input does not match its owner'); END;
--> statement-breakpoint
CREATE TRIGGER material_evidence_inputs_retained BEFORE DELETE ON material_evidence_inputs
WHEN (OLD.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_versions WHERE id=OLD.version_id AND status='published')
 AND NOT (EXISTS(SELECT 1 FROM material_history_members WHERE version_id=OLD.version_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=OLD.version_id))) OR (OLD.request_id IS NOT NULL AND EXISTS(SELECT 1 FROM material_generation_requests r WHERE r.id=OLD.request_id AND r.cancelled=0))
BEGIN SELECT RAISE(ABORT,'published learning evidence is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_retained BEFORE DELETE ON material_generation_requests
WHEN 1
BEGIN SELECT RAISE(ABORT, 'generation intent cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_note_scope BEFORE INSERT ON material_generation_requests
WHEN NEW.project_id IS NULL OR json_extract(NEW.payload,'$.kind') IS NULL
 OR json_extract(NEW.payload,'$.kind') NOT IN ('quiz','flashcards')
 OR json_extract(NEW.payload,'$.documentTransform') IS NOT NULL
BEGIN SELECT RAISE(ABORT,'invalid learning generation scope'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_members_delete BEFORE DELETE ON material_history_members BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_prunes_retained BEFORE DELETE ON material_history_prunes BEGIN SELECT RAISE(ABORT,'history cleanup is retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_delete BEFORE DELETE ON material_history_requests BEGIN SELECT RAISE(ABORT,'history cleanup ownership is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_identity_update BEFORE UPDATE ON materials
WHEN new.id IS NOT old.id OR new.kind IS NOT old.kind
BEGIN SELECT RAISE(ABORT, 'material ownership and kind are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_version_parents_delete_draft BEFORE DELETE ON material_version_parents
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_delete_frozen BEFORE DELETE ON material_versions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_versions_publish_payload BEFORE UPDATE OF status ON material_versions WHEN NEW.status='published' AND CASE NEW.kind WHEN 'quiz' THEN NOT EXISTS(SELECT 1 FROM material_quiz_versions WHERE version_id=NEW.id) WHEN 'flashcards' THEN NOT EXISTS(SELECT 1 FROM material_flashcard_versions WHERE version_id=NEW.id) ELSE 1 END BEGIN SELECT RAISE(ABORT,'published learning artifacts require their typed payload'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.id AND r.cancelled=0 AND v.kind IN ('quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND ((json_type(r.payload,'$.autoTitle')='true' AND length(m.title) BETWEEN 1 AND 200 AND m.title=trim(m.title)) OR (coalesce(json_type(r.payload,'$.autoTitle'),'false')!='true' AND json_extract(r.payload,'$.title')=m.title)) AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id))
BEGIN SELECT RAISE(ABORT,'generated publication does not match exact request'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*'
 OR NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_versions v ON v.generation_request_id=r.id JOIN materials m ON m.id=v.material_id
 WHERE v.id=NEW.result_version_id AND r.cancelled=0 AND v.kind IN ('quiz','flashcards') AND json_extract(r.payload,'$.kind')=v.kind
 AND ((json_type(r.payload,'$.autoTitle')='true' AND length(m.title) BETWEEN 1 AND 200 AND m.title=trim(m.title)) OR (coalesce(json_type(r.payload,'$.autoTitle'),'false')!='true' AND json_extract(r.payload,'$.title')=m.title)) AND json_extract(r.payload,'$.instruction') IS v.instruction
 AND EXISTS(SELECT 1 FROM project_materials p WHERE p.material_id=v.material_id AND p.project_id=r.project_id)
 AND json_array_length(r.payload,'$.inputs') BETWEEN 1 AND 20
 AND (SELECT COUNT(*) FROM material_evidence_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputs')
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id
 EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE version_id=v.id
 EXCEPT SELECT position,"page_version_id",source_id,source_revision,source_snapshot_id FROM material_evidence_inputs WHERE request_id=r.id) AND r.id=NEW.id AND v.status='published'))
BEGIN SELECT RAISE(ABORT,'generated receipt does not match exact publication'); END;
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
-- Content-free deletion and retirement fences remain to reject late duplicate work.
DROP TABLE removed_diagram_executions;
--> statement-breakpoint
DROP TABLE removed_diagram_events;
--> statement-breakpoint
DROP TABLE removed_diagram_requests;
--> statement-breakpoint
DROP TABLE removed_diagram_history;
--> statement-breakpoint
DROP TABLE removed_diagram_versions;
--> statement-breakpoint
DROP TABLE removed_diagram_materials;
--> statement-breakpoint
PRAGMA legacy_alter_table=OFF;
