DROP TRIGGER IF EXISTS material_deletion_context_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS material_deletion_reply_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS material_deletion_reply_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS material_deletion_reply_publication;
--> statement-breakpoint
DROP TRIGGER IF EXISTS history_reply_publication;
--> statement-breakpoint
DROP TRIGGER IF EXISTS conversation_reply_requests_history_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS conversation_reply_requests_history_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS session_run_contexts_history_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS session_run_contexts_history_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sessions_history_selection;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_requests_active_insert BEFORE INSERT ON conversation_reply_requests WHEN EXISTS(SELECT 1 FROM session_retired_intents r WHERE r.request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id=NEW.request_id AND r.event_type='ConversationGenerationRequested') BEGIN SELECT RAISE(ABORT,'retired reply cannot restore captured content'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_requests_active_update BEFORE UPDATE ON conversation_reply_requests WHEN EXISTS(SELECT 1 FROM session_retired_intents r WHERE r.request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id=NEW.request_id AND r.event_type='ConversationGenerationRequested') BEGIN SELECT RAISE(ABORT,'retired reply cannot restore captured content'); END;
--> statement-breakpoint
CREATE TRIGGER session_run_contexts_active_request BEFORE INSERT ON session_run_contexts WHEN EXISTS(SELECT 1 FROM session_retired_intents r WHERE r.request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id=NEW.request_id AND r.event_type='ConversationGenerationRequested') BEGIN SELECT RAISE(ABORT,'retired context cannot capture newer content'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_version_active_insert BEFORE INSERT ON message_versions WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.event_type='ConversationGenerationRequested' AND (r.correlation_id=NEW.generation_request_id OR EXISTS(SELECT 1 FROM conversation_reply_requests captured WHERE captured.version_id=NEW.id AND captured.request_id=r.correlation_id))) BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_version_active_update BEFORE UPDATE OF status,text ON message_versions WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.event_type='ConversationGenerationRequested' AND (r.correlation_id=NEW.generation_request_id OR EXISTS(SELECT 1 FROM conversation_reply_requests captured WHERE captured.version_id=NEW.id AND captured.request_id=r.correlation_id))) BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER session_selection_exact_inputs BEFORE UPDATE OF selection ON sessions
WHEN EXISTS(SELECT 1 FROM json_each(NEW.selection) j WHERE
 json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN('document','source')
 OR (json_extract(j.value,'$.input.kind')='document' AND NOT EXISTS(SELECT 1 FROM study_document_versions v WHERE CAST(v.id AS TEXT)=CAST(json_extract(j.value,'$.input.versionId') AS TEXT) AND v.status='published' AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id) AND NOT EXISTS(SELECT 1 FROM study_document_deletions d WHERE d.document_id=v.document_id)))
 OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM source_extraction_revisions e WHERE CAST(e.source_id AS TEXT)=CAST(json_extract(j.value,'$.input.sourceId') AS TEXT) AND CAST(e.revision AS TEXT)=CAST(json_extract(j.value,'$.input.revision') AS TEXT) AND CAST(e.snapshot_id AS TEXT)=CAST(json_extract(j.value,'$.input.snapshotId') AS TEXT))))
BEGIN SELECT RAISE(ABORT,'session selection requires available exact domain inputs'); END;
