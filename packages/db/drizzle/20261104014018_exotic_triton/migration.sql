CREATE TABLE `conversation_reply_sources` (
	`request_id` text NOT NULL,
	`part_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_id` integer,
	CONSTRAINT `conversation_reply_sources_pk` PRIMARY KEY(`request_id`, `part_id`),
	CONSTRAINT `fk_conversation_reply_sources_request_id_conversation_reply_requests_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `conversation_reply_requests`(`request_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_conversation_reply_sources_source_id_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`revision`) REFERENCES `source_snapshots`(`source_id`,`revision`),
	CONSTRAINT `fk_conversation_reply_sources_source_id_revision_snapshot_id_source_extraction_revisions_source_id_revision_snapshot_id_fk` FOREIGN KEY (`source_id`,`revision`,`snapshot_id`) REFERENCES `source_extraction_revisions`(`source_id`,`revision`,`snapshot_id`),
	CONSTRAINT "conversation_reply_source_identity" CHECK("part_id">0 AND "revision">0)
);
--> statement-breakpoint
CREATE INDEX `conversation_reply_sources_revision` ON `conversation_reply_sources` (`source_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `conversation_reply_sources_snapshot` ON `conversation_reply_sources` (`snapshot_id`);
--> statement-breakpoint
CREATE TEMP TABLE cutover_reply_source_parts AS
SELECT r.request_id,CAST(message.key AS INTEGER) message_index,CAST(part.key AS INTEGER) part_index,
CAST(json_extract(part.value,'$.partId') AS INTEGER) part_id,CAST(json_extract(part.value,'$.sourceId') AS INTEGER) source_id,
CAST(coalesce(json_extract(part.value,'$.snapshotId'),json_extract(part.value,'$.documentId')) AS INTEGER) snapshot_id,
CASE WHEN json_extract(part.value,'$.revision') IS NOT NULL THEN CAST(json_extract(part.value,'$.revision') AS INTEGER)
ELSE (SELECT CASE WHEN count(*)=1 THEN max(e.revision) END FROM source_extraction_revisions e WHERE e.source_id=CAST(json_extract(part.value,'$.sourceId') AS INTEGER)
 AND e.snapshot_id=CAST(coalesce(json_extract(part.value,'$.snapshotId'),json_extract(part.value,'$.documentId')) AS INTEGER)) END revision
FROM conversation_reply_requests r,json_each(r.snapshot,'$.messages') message,json_each(message.value,'$.attachments') part;
--> statement-breakpoint
CREATE TEMP TABLE cutover_unsupported_replies AS SELECT r.request_id,r.session_id,r.version_id,v.message_id,v.status
FROM conversation_reply_requests r LEFT JOIN message_versions v ON v.id=r.version_id
WHERE json_type(r.snapshot,'$.messages') IS NOT 'array' OR json_extract(r.snapshot,'$.requestId') IS NOT r.request_id
OR EXISTS(SELECT 1 FROM cutover_reply_source_parts p WHERE p.request_id=r.request_id AND (p.revision IS NULL OR p.part_id IS NULL OR NOT EXISTS(
 SELECT 1 FROM source_extraction_revisions e WHERE e.source_id=p.source_id AND e.revision=p.revision AND e.snapshot_id=p.snapshot_id)))
OR EXISTS(SELECT 1 FROM session_retired_intents retired WHERE retired.request_id=r.request_id)
OR EXISTS(SELECT 1 FROM cutover_reply_source_parts p WHERE p.request_id=r.request_id GROUP BY p.part_id HAVING count(*)>1)
OR EXISTS(SELECT 1 FROM json_each(r.snapshot,'$.pendingAttachments') p WHERE p.type='object' AND NOT EXISTS(SELECT 1 FROM source_snapshots s
 WHERE s.source_id=CAST(json_extract(p.value,'$.sourceId') AS INTEGER) AND s.revision=CAST(json_extract(p.value,'$.inputRevision') AS INTEGER)));
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_correlations(correlation_id,event_type) SELECT request_id,'ConversationGenerationRequested' FROM cutover_unsupported_replies;
--> statement-breakpoint
INSERT OR IGNORE INTO workflow_retired_executions(execution_id,correlation_id)
SELECT execution_id,json_extract(payload,'$.event.correlationId') FROM workflow_executions
WHERE json_extract(payload,'$.event.type')='ConversationGenerationRequested' AND json_extract(payload,'$.event.correlationId') IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
DELETE FROM workflow_activities WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_deferreds WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_clocks WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
DELETE FROM workflow_configuration_waits WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
UPDATE workflow_executions SET payload='{}',result=NULL,owner_token=NULL,status=CASE WHEN status='completed' THEN 'completed' ELSE 'cancelled' END
WHERE execution_id IN(SELECT x.execution_id FROM workflow_retired_executions x JOIN cutover_unsupported_replies r ON r.request_id=x.correlation_id);
--> statement-breakpoint
UPDATE workflow_events SET payload='{}' WHERE type='ConversationGenerationRequested' AND correlation_id IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
UPDATE message_versions SET generation_request_id=(SELECT r.request_id FROM cutover_unsupported_replies r WHERE r.version_id=message_versions.id)
WHERE id IN(SELECT version_id FROM cutover_unsupported_replies) AND status='complete' AND generation_request_id IS NULL;
--> statement-breakpoint
UPDATE messages SET active_version_id=coalesce((SELECT parent.id FROM message_versions pending JOIN message_versions parent ON parent.id=pending.based_on AND parent.message_id=pending.message_id AND parent.status='complete'
 WHERE pending.id=messages.active_version_id),(SELECT id FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete' ORDER BY number DESC LIMIT 1))
WHERE active_version_id IN(SELECT version_id FROM cutover_unsupported_replies WHERE status!='complete')
AND EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete');
--> statement-breakpoint
INSERT OR IGNORE INTO session_retired_intents(session_id,intent_key,request_id,reason)
SELECT session_id,intent_key,request_id,'input_retired' FROM session_run_contexts WHERE request_id IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
DELETE FROM session_run_contexts WHERE request_id IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
DELETE FROM conversation_reply_requests WHERE request_id IN(SELECT request_id FROM cutover_unsupported_replies);
--> statement-breakpoint
DELETE FROM message_versions WHERE id IN(SELECT version_id FROM cutover_unsupported_replies WHERE status!='complete')
AND EXISTS(SELECT 1 FROM message_versions complete WHERE complete.message_id=message_versions.message_id AND complete.status='complete');
--> statement-breakpoint
DELETE FROM messages WHERE id IN(SELECT message_id FROM cutover_unsupported_replies WHERE status!='complete') AND NOT EXISTS(SELECT 1 FROM message_versions v WHERE v.message_id=messages.id AND v.status='complete');
--> statement-breakpoint
UPDATE conversation_reply_requests AS r SET snapshot=json_set(r.snapshot,'$.messages',json((SELECT json_group_array(json(value)) FROM (
 SELECT json_set(message.value,'$.attachments',json((SELECT json_group_array(json(value)) FROM (
  SELECT json_set(json_remove(part.value,'$.documentId'),'$.revision',CAST(p.revision AS TEXT),'$.snapshotId',CAST(p.snapshot_id AS TEXT)) value
  FROM json_each(message.value,'$.attachments') part JOIN cutover_reply_source_parts p ON p.request_id=r.request_id AND p.message_index=CAST(message.key AS INTEGER) AND p.part_index=CAST(part.key AS INTEGER) ORDER BY CAST(part.key AS INTEGER)
 )))) value FROM json_each(r.snapshot,'$.messages') message ORDER BY CAST(message.key AS INTEGER)
)))) WHERE EXISTS(SELECT 1 FROM cutover_reply_source_parts p WHERE p.request_id=r.request_id)
AND NOT EXISTS(SELECT 1 FROM session_retired_intents retired WHERE retired.request_id=r.request_id);
--> statement-breakpoint
INSERT INTO conversation_reply_sources(request_id,part_id,source_id,revision,snapshot_id)
SELECT p.request_id,p.part_id,p.source_id,p.revision,p.snapshot_id FROM cutover_reply_source_parts p JOIN conversation_reply_requests r ON r.request_id=p.request_id;
--> statement-breakpoint
INSERT INTO conversation_reply_sources(request_id,part_id,source_id,revision,snapshot_id)
SELECT r.request_id,CAST(json_extract(p.value,'$.partId') AS INTEGER),CAST(json_extract(p.value,'$.sourceId') AS INTEGER),CAST(json_extract(p.value,'$.inputRevision') AS INTEGER),NULL
FROM conversation_reply_requests r,json_each(r.snapshot,'$.pendingAttachments') p WHERE p.type='object';
--> statement-breakpoint
CREATE TRIGGER conversation_reply_sources_capture BEFORE INSERT ON conversation_reply_sources
WHEN (NEW.snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_reply_requests r,json_each(r.snapshot,'$.messages') m,json_each(m.value,'$.attachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.revision') AS INTEGER)=NEW.revision
 AND CAST(json_extract(p.value,'$.snapshotId') AS INTEGER)=NEW.snapshot_id)) OR (NEW.snapshot_id IS NULL AND NOT EXISTS(SELECT 1 FROM conversation_reply_requests r,json_each(r.snapshot,'$.pendingAttachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.inputRevision') AS INTEGER)=NEW.revision))
BEGIN SELECT RAISE(ABORT,'reply source pin does not match exact captured intent'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_sources_immutable BEFORE UPDATE ON conversation_reply_sources
WHEN NEW.request_id IS NOT OLD.request_id OR NEW.part_id IS NOT OLD.part_id OR NEW.source_id IS NOT OLD.source_id OR NEW.revision IS NOT OLD.revision
 OR (OLD.snapshot_id IS NOT NULL AND NEW.snapshot_id IS NOT OLD.snapshot_id) OR (NEW.snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversation_reply_requests r,json_each(r.snapshot,'$.messages') m,json_each(m.value,'$.attachments') p
 WHERE r.request_id=NEW.request_id AND CAST(json_extract(p.value,'$.partId') AS INTEGER)=NEW.part_id
 AND CAST(json_extract(p.value,'$.sourceId') AS INTEGER)=NEW.source_id AND CAST(json_extract(p.value,'$.revision') AS INTEGER)=NEW.revision
 AND CAST(json_extract(p.value,'$.snapshotId') AS INTEGER)=NEW.snapshot_id))
BEGIN SELECT RAISE(ABORT,'reply source identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_sources_retained BEFORE DELETE ON conversation_reply_sources
WHEN EXISTS(SELECT 1 FROM conversation_reply_requests r WHERE r.request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT,'retained reply source pins require capture retirement'); END;
--> statement-breakpoint
DROP TABLE cutover_unsupported_replies;
--> statement-breakpoint
DROP TABLE cutover_reply_source_parts;
