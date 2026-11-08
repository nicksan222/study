DROP INDEX IF EXISTS `learning_practice_inputs_document`;--> statement-breakpoint
DROP INDEX IF EXISTS `material_evidence_inputs_document`;--> statement-breakpoint
CREATE INDEX `learning_practice_inputs_page` ON `learning_practice_inputs` (`page_version_id`);--> statement-breakpoint
CREATE INDEX `material_evidence_inputs_page` ON `material_evidence_inputs` (`page_version_id`);
--> statement-breakpoint
-- Repair only captured reply boundaries; user text and canonical content stay untouched.
CREATE TEMP TABLE note_boundary_json (old TEXT PRIMARY KEY, migrated TEXT NOT NULL);
--> statement-breakpoint
INSERT OR IGNORE INTO note_boundary_json SELECT "snapshot","snapshot" FROM "note_reply_requests" WHERE "snapshot" IS NOT NULL AND json_valid("snapshot");
--> statement-breakpoint
INSERT OR IGNORE INTO note_boundary_json SELECT "payload","payload" FROM "workflow_executions" WHERE "payload" IS NOT NULL AND json_valid("payload");
--> statement-breakpoint
INSERT OR IGNORE INTO note_boundary_json SELECT "result","result" FROM "workflow_executions" WHERE "result" IS NOT NULL AND json_valid("result");
--> statement-breakpoint
INSERT OR IGNORE INTO note_boundary_json SELECT "result","result" FROM "workflow_activities" WHERE "result" IS NOT NULL AND json_valid("result");
--> statement-breakpoint
INSERT OR IGNORE INTO note_boundary_json SELECT "result","result" FROM "workflow_deferreds" WHERE "result" IS NOT NULL AND json_valid("result");
--> statement-breakpoint
UPDATE note_boundary_json SET migrated=(
 WITH RECURSIVE boundaries AS (
  SELECT j.fullkey || '.reason' AS path,
   row_number() OVER (ORDER BY j.id) AS ordinal
  FROM json_tree(old) j
  WHERE j.key='historyBoundary' AND j.type='object'
   AND json_extract(j.value,'$.reason')='conversation-boundary'
   AND json_type(j.value,'$.includedMessages')='integer'
   AND json_type(j.value,'$.excludedMessages')='integer'
   AND json_type(old,j.path || '.requestId')='text'
   AND json_type(old,j.path || '.noteId')='text'
   AND json_type(old,j.path || '.messageId')='text'
   AND json_type(old,j.path || '.versionId')='text'
   AND json_type(old,j.path || '.messages')='array'
   AND NOT EXISTS (
    SELECT 1 FROM json_tree(old) canonical
    WHERE canonical.type IN ('object','array')
     AND (canonical.key IN ('meta','metadata') OR (canonical.type='object' AND json_type(canonical.value,'$.blocks')='array'))
     AND (j.fullkey=canonical.fullkey OR substr(j.fullkey,1,length(canonical.fullkey)+1) IN (canonical.fullkey || '.',canonical.fullkey || '['))
   )
 ), rewritten(ordinal,value) AS (
  SELECT 0,old UNION ALL
  SELECT b.ordinal,json_set(r.value,b.path,'note-boundary')
  FROM rewritten r JOIN boundaries b ON b.ordinal=r.ordinal+1
 ) SELECT value FROM rewritten ORDER BY ordinal DESC LIMIT 1
);
--> statement-breakpoint
UPDATE "note_reply_requests" SET "snapshot"=(SELECT migrated FROM note_boundary_json WHERE old="note_reply_requests"."snapshot") WHERE "snapshot" IN (SELECT old FROM note_boundary_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_executions" SET "payload"=(SELECT migrated FROM note_boundary_json WHERE old="workflow_executions"."payload") WHERE "payload" IN (SELECT old FROM note_boundary_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_executions" SET "result"=(SELECT migrated FROM note_boundary_json WHERE old="workflow_executions"."result") WHERE "result" IN (SELECT old FROM note_boundary_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_activities" SET "result"=(SELECT migrated FROM note_boundary_json WHERE old="workflow_activities"."result") WHERE "result" IN (SELECT old FROM note_boundary_json WHERE old!=migrated);
--> statement-breakpoint
UPDATE "workflow_deferreds" SET "result"=(SELECT migrated FROM note_boundary_json WHERE old="workflow_deferreds"."result") WHERE "result" IN (SELECT old FROM note_boundary_json WHERE old!=migrated);
--> statement-breakpoint
DROP TABLE note_boundary_json;
