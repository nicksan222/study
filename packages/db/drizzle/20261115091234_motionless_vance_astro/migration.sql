DROP TRIGGER IF EXISTS "retired_execution_insert";--> statement-breakpoint
DROP TRIGGER IF EXISTS "retired_execution_payload";--> statement-breakpoint
DROP TRIGGER IF EXISTS "workflow_activities_retired_insert";--> statement-breakpoint
DROP TRIGGER IF EXISTS "workflow_clocks_retired_insert";--> statement-breakpoint
DROP TRIGGER IF EXISTS "workflow_deferreds_retired_insert";--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_generation_result_insert";--> statement-breakpoint
DROP TRIGGER IF EXISTS "page_generation_result_update";--> statement-breakpoint
-- Intentional cutover from the released custom workflow protocol. Domain content remains intact.
DELETE FROM workflow_agent_progress;--> statement-breakpoint
DELETE FROM workflow_configuration_waits;--> statement-breakpoint
DELETE FROM workflow_receipts;--> statement-breakpoint
DELETE FROM workflow_events;--> statement-breakpoint
DELETE FROM workflow_activities;--> statement-breakpoint
DELETE FROM workflow_deferreds;--> statement-breakpoint
DELETE FROM workflow_clocks;--> statement-breakpoint
DELETE FROM workflow_retired_executions;--> statement-breakpoint
DELETE FROM workflow_retired_correlations;--> statement-breakpoint
DELETE FROM workflow_executions;--> statement-breakpoint
-- Cancel domain shells whose execution protocol was reset; completed content is retained.
UPDATE material_generation_requests SET cancelled=1 WHERE result_version_id IS NULL;--> statement-breakpoint
UPDATE page_transform_requests SET cancelled=1,error_kind='cancelled' WHERE result_version_id IS NULL;--> statement-breakpoint
UPDATE learning_practice_controls SET enabled=0;--> statement-breakpoint
UPDATE learning_practice_slots SET status='cancelled' WHERE status='pending';--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_correlations(correlation_id,event_type)
SELECT request_id,'NoteGenerationRequested' FROM note_reply_requests WHERE version_id IN (SELECT id FROM message_versions WHERE status!='complete');--> statement-breakpoint
UPDATE message_versions SET status='failed',text='' WHERE status IN ('pending','writing');--> statement-breakpoint

ALTER TABLE `workflow_agent_progress` ADD `generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_executions` ADD `generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_executions` ADD `cancellation_mode` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workflow_executions` (
	`execution_id` text PRIMARY KEY,
	`workflow_tag` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`cancellation_mode` text,
	`parent_execution_id` text,
	`result` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "workflow_executions_generation_check" CHECK("generation" > 0),
	CONSTRAINT "workflow_executions_cancellation_check" CHECK("cancellation_mode" IS NULL OR "cancellation_mode" IN ('safe', 'unsafe')),
	CONSTRAINT "workflow_executions_version_check" CHECK("version" > 0),
	CONSTRAINT "workflow_executions_payload_check" CHECK(json_valid("payload")),
	CONSTRAINT "workflow_executions_result_check" CHECK("result" IS NULL OR json_valid("result")),
	CONSTRAINT "workflow_executions_status_check" CHECK("status" IN ('running', 'suspended', 'cancelling', 'blocked', 'completed', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_workflow_executions`(`execution_id`, `workflow_tag`, `version`, `payload`, `status`, `parent_execution_id`, `result`, `created_at`, `updated_at`) SELECT `execution_id`, `workflow_tag`, `version`, `payload`, `status`, `parent_execution_id`, `result`, `created_at`, `updated_at` FROM `workflow_executions`;--> statement-breakpoint
DROP TABLE `workflow_executions`;--> statement-breakpoint
ALTER TABLE `__new_workflow_executions` RENAME TO `workflow_executions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `workflow_clocks_due_idx`;--> statement-breakpoint
CREATE INDEX `workflow_executions_parent_idx` ON `workflow_executions` (`parent_execution_id`);--> statement-breakpoint
CREATE INDEX `workflow_executions_recovery_idx` ON `workflow_executions` (`status`,`workflow_tag`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workflow_executions_pagination_idx` ON `workflow_executions` (`created_at`,`execution_id`);--> statement-breakpoint
CREATE INDEX `workflow_executions_correlation_pagination_idx` ON `workflow_executions` (json_extract("payload", '$.event.correlationId'),`created_at`,`execution_id`);--> statement-breakpoint
DROP TABLE `workflow_activities`;--> statement-breakpoint
DROP TABLE `workflow_clocks`;--> statement-breakpoint
DROP TABLE `workflow_deferreds`;--> statement-breakpoint
ALTER TABLE `workflow_agent_progress` DROP COLUMN `owner_token`;
--> statement-breakpoint
CREATE TRIGGER retired_execution_insert BEFORE INSERT ON workflow_executions
WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=json_extract(NEW.payload,'$.event.correlationId') AND event_type=json_extract(NEW.payload,'$.event.type'))
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot restart'); END;--> statement-breakpoint
CREATE TRIGGER retired_execution_payload BEFORE UPDATE ON workflow_executions
WHEN OLD.payload='{}' AND EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=OLD.execution_id)
 AND (NEW.payload!='{}' OR NEW.result IS NOT NULL OR NEW.status NOT IN ('completed','cancelled','cancelling','blocked'))
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot restore checkpoints'); END;--> statement-breakpoint
CREATE TRIGGER page_generation_result_insert BEFORE INSERT ON "page_generation_requests"
WHEN NEW.result_version_id IS NOT NULL AND (NOT (EXISTS(SELECT 1 FROM "page_versions" v WHERE v.id=NEW.result_version_id AND v."page_id"=NEW."page_id" AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM "page_version_parents" p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM "page_version_parents" p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p."page_id"=NEW."page_id")
  AND (v.status='published' OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM "page_transform_requests" WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr
 JOIN "page_versions" v ON v.id=NEW.result_version_id
 JOIN "pages" output ON output.id=v."page_id"
 WHERE tr.id=NEW.id AND tr."note_id" IS NULL AND NEW."note_id" IS NULL
 AND NEW.expected_version_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.merge')='object'
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND tr.context_request_id='merge/' || json_extract(tr.request,'$.merge.key')
 AND json_extract(tr.request,'$.editTargetVersionId') IS NULL
 AND json_extract(tr.request,'$.title')=json_extract(tr.request,'$.merge.title')
 AND output.title=json_extract(tr.request,'$.title')
 AND v.operation='generate' AND v.language IS json_extract(tr.request,'$.merge.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND json_type(tr.request,'$.merge.versions')='array'
 AND json_array_length(tr.request,'$.merge.versions') BETWEEN 2 AND 20
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=v.id)=json_array_length(tr.request,'$.merge.versions')
 AND (SELECT COUNT(DISTINCT b."page_id") FROM json_each(tr.request,'$.merge.versions') j
      JOIN "page_versions" b ON CAST(b.id AS TEXT)=j.value)=json_array_length(tr.request,'$.merge.versions')
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.merge.versions') j WHERE NOT EXISTS(
     SELECT 1 FROM "page_versions" b
     JOIN "pages" d ON d.id=b."page_id"
     JOIN "page_inputs" i ON i.version_id=v.id AND i."page_version_id"=b.id AND i.position=CAST(j.key AS INTEGER)
     WHERE CAST(b.id AS TEXT)=j.value AND b.status='published'
     AND b."page_id"!=v."page_id" AND d.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=b."page_id" AND newer.status='published' AND newer.number>b.number)
     AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=b.id)
     AND NOT EXISTS(SELECT 1 FROM "page_deletions" x WHERE x."page_id"=b."page_id")
   )
 )
) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr JOIN "note_run_contexts" c ON c.request_id=tr.context_request_id JOIN "page_versions" v ON v.id=NEW.result_version_id
 WHERE tr.id=NEW.id AND (NEW."note_id" IS NULL OR NEW."note_id"=tr."note_id") AND tr.cancelled=0 AND tr."note_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "note_deletions" d WHERE d."note_id"=tr."note_id")
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND tr.context_request_id=c.request_id AND c."note_id"=tr."note_id"
 AND json_extract(c.snapshot,'$.requestId')=c.request_id AND json_extract(c.snapshot,'$.noteId')=CAST(c."note_id" AS TEXT)
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS CASE WHEN NEW.expected_version_id IS NULL THEN NULL ELSE CAST(NEW.expected_version_id AS TEXT) END
 AND (NEW.expected_version_id IS NULL OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j JOIN "page_versions" b ON CAST(json_extract(j.value,'$.input.versionId') AS INTEGER)=b.id
  WHERE json_extract(j.value,'$.input.kind')='page' AND b.id=NEW.expected_version_id
   AND json_extract(j.value,'$.scope.kind')='document' AND json_extract(j.value,'$.snapshotId')=CAST(b.content_snapshot_id AS TEXT)))
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE
  (json_extract(j.value,'$.input.kind')='page' AND NOT EXISTS(SELECT 1 FROM "page_versions" b JOIN "note_context_pages" p ON p.version_id=b.id AND p.request_id=c.request_id
   WHERE b.id=CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) AND CAST(b.content_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM "note_context_sources" p WHERE p.request_id=c.request_id
   AND CAST(p.source_id AS TEXT)=json_extract(j.value,'$.input.sourceId') AND CAST(p.revision AS TEXT)=json_extract(j.value,'$.input.revision')
   AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.input.snapshotId') AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN ('page','source'))
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=NEW.result_version_id)=
  (SELECT COUNT(*) FROM "note_context_pages" WHERE request_id=c.request_id)+(SELECT COUNT(*) FROM "note_context_sources" WHERE request_id=c.request_id)+json_array_length(c.snapshot,'$.messages')
 AND NOT EXISTS(SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id EXCEPT SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL)
 AND NOT EXISTS(SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL EXCEPT SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id EXCEPT SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL)
 AND NOT EXISTS(SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL EXCEPT SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j EXCEPT SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL EXCEPT SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j)
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND v.operation=CASE WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='translate') THEN 'translate' WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='summarize') THEN 'summarize' ELSE 'generate' END
 AND (NEW.expected_version_id IS NOT NULL OR (SELECT title FROM "pages" WHERE id=v."page_id")=json_extract(tr.request,'$.title')))))
BEGIN SELECT RAISE(ABORT,'authored generation result does not match its exact retained authority'); END;--> statement-breakpoint
CREATE TRIGGER page_generation_result_update BEFORE UPDATE OF result_version_id ON "page_generation_requests"
WHEN NEW.result_version_id IS NOT NULL AND OLD.result_version_id IS NULL AND (NOT (EXISTS(SELECT 1 FROM "page_versions" v WHERE v.id=NEW.result_version_id AND v."page_id"=NEW."page_id" AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM "page_retirements" x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM "page_version_parents" p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM "page_version_parents" p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p."page_id"=NEW."page_id")
  AND (v.status='published' OR EXISTS(SELECT 1 FROM "page_proposals" p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM "page_transform_requests" WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr
 JOIN "page_versions" v ON v.id=NEW.result_version_id
 JOIN "pages" output ON output.id=v."page_id"
 WHERE tr.id=NEW.id AND tr."note_id" IS NULL AND NEW."note_id" IS NULL
 AND NEW.expected_version_id IS NULL AND tr.cancelled=0
 AND json_type(tr.request,'$.merge')='object'
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND tr.context_request_id='merge/' || json_extract(tr.request,'$.merge.key')
 AND json_extract(tr.request,'$.editTargetVersionId') IS NULL
 AND json_extract(tr.request,'$.title')=json_extract(tr.request,'$.merge.title')
 AND output.title=json_extract(tr.request,'$.title')
 AND v.operation='generate' AND v.language IS json_extract(tr.request,'$.merge.language')
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND json_type(tr.request,'$.merge.versions')='array'
 AND json_array_length(tr.request,'$.merge.versions') BETWEEN 2 AND 20
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=v.id)=json_array_length(tr.request,'$.merge.versions')
 AND (SELECT COUNT(DISTINCT b."page_id") FROM json_each(tr.request,'$.merge.versions') j
      JOIN "page_versions" b ON CAST(b.id AS TEXT)=j.value)=json_array_length(tr.request,'$.merge.versions')
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.merge.versions') j WHERE NOT EXISTS(
     SELECT 1 FROM "page_versions" b
     JOIN "pages" d ON d.id=b."page_id"
     JOIN "page_inputs" i ON i.version_id=v.id AND i."page_version_id"=b.id AND i.position=CAST(j.key AS INTEGER)
     WHERE CAST(b.id AS TEXT)=j.value AND b.status='published'
     AND b."page_id"!=v."page_id" AND d.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM "page_versions" newer WHERE newer."page_id"=b."page_id" AND newer.status='published' AND newer.number>b.number)
     AND NOT EXISTS(SELECT 1 FROM "page_retirements" r WHERE r.version_id=b.id)
     AND NOT EXISTS(SELECT 1 FROM "page_deletions" x WHERE x."page_id"=b."page_id")
   )
 )
) OR EXISTS(
 SELECT 1 FROM "page_transform_requests" tr JOIN "note_run_contexts" c ON c.request_id=tr.context_request_id JOIN "page_versions" v ON v.id=NEW.result_version_id
 WHERE tr.id=NEW.id AND (NEW."note_id" IS NULL OR NEW."note_id"=tr."note_id") AND tr.cancelled=0 AND tr."note_id" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "note_deletions" d WHERE d."note_id"=tr."note_id")
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND tr.context_request_id=c.request_id AND c."note_id"=tr."note_id"
 AND json_extract(c.snapshot,'$.requestId')=c.request_id AND json_extract(c.snapshot,'$.noteId')=CAST(c."note_id" AS TEXT)
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS CASE WHEN NEW.expected_version_id IS NULL THEN NULL ELSE CAST(NEW.expected_version_id AS TEXT) END
 AND (NEW.expected_version_id IS NULL OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j JOIN "page_versions" b ON CAST(json_extract(j.value,'$.input.versionId') AS INTEGER)=b.id
  WHERE json_extract(j.value,'$.input.kind')='page' AND b.id=NEW.expected_version_id
   AND json_extract(j.value,'$.scope.kind')='document' AND json_extract(j.value,'$.snapshotId')=CAST(b.content_snapshot_id AS TEXT)))
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE
  (json_extract(j.value,'$.input.kind')='page' AND NOT EXISTS(SELECT 1 FROM "page_versions" b JOIN "note_context_pages" p ON p.version_id=b.id AND p.request_id=c.request_id
   WHERE b.id=CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) AND CAST(b.content_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM "note_context_sources" p WHERE p.request_id=c.request_id
   AND CAST(p.source_id AS TEXT)=json_extract(j.value,'$.input.sourceId') AND CAST(p.revision AS TEXT)=json_extract(j.value,'$.input.revision')
   AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.input.snapshotId') AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN ('page','source'))
 AND (SELECT COUNT(*) FROM "page_inputs" i WHERE i.version_id=NEW.result_version_id)=
  (SELECT COUNT(*) FROM "note_context_pages" WHERE request_id=c.request_id)+(SELECT COUNT(*) FROM "note_context_sources" WHERE request_id=c.request_id)+json_array_length(c.snapshot,'$.messages')
 AND NOT EXISTS(SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id EXCEPT SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL)
 AND NOT EXISTS(SELECT "page_version_id" FROM "page_inputs" WHERE version_id=NEW.result_version_id AND "page_version_id" IS NOT NULL EXCEPT SELECT version_id FROM "note_context_pages" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id EXCEPT SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL)
 AND NOT EXISTS(SELECT source_id,source_revision,source_snapshot_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL EXCEPT SELECT source_id,revision,snapshot_id FROM "note_context_sources" WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j EXCEPT SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT exact_message_version_id FROM "page_inputs" WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL EXCEPT SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j)
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND v.operation=CASE WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='translate') THEN 'translate' WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='summarize') THEN 'summarize' ELSE 'generate' END
 AND (NEW.expected_version_id IS NOT NULL OR (SELECT title FROM "pages" WHERE id=v."page_id")=json_extract(tr.request,'$.title')))))
BEGIN SELECT RAISE(ABORT,'authored generation result does not match its exact retained authority'); END;
--> statement-breakpoint
-- Source readers follow this correlation and require an authoritative terminal outcome.
INSERT INTO workflow_executions(execution_id,workflow_tag,version,payload,status,created_at,updated_at)
SELECT 'cutover-source-'||source_id,'source-ingestion/v1',1,json_object('event',json_object('correlationId',request_id)),'cancelled',0,0
FROM source_processing WHERE published_request_id IS NULL OR published_request_id!=request_id;
