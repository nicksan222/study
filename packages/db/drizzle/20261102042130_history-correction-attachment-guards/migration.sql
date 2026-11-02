DROP TRIGGER material_history_members_valid;
--> statement-breakpoint
CREATE TRIGGER material_history_members_valid BEFORE INSERT ON material_history_members
WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p JOIN material_versions v ON v.material_id=p.material_id, json_each(p.selection) j
WHERE p.operation_id=NEW.operation_id AND p.status='pending' AND v.id=NEW.version_id AND CAST(v.id AS TEXT)=j.value AND v.status='published'
AND (SELECT count(*) FROM material_versions newer WHERE newer.material_id=v.material_id AND newer.status='published' AND newer.number>v.number)>=p.keep_latest
AND NOT EXISTS(SELECT 1 FROM document_proposals d WHERE (v.id IN(d.base_version_id,d.proposed_version_id) OR EXISTS(SELECT 1 FROM material_generation_inputs i WHERE i.request_id=d.request_id AND i.version_id=v.id)) AND NOT EXISTS(SELECT 1 FROM document_proposal_receipts r WHERE r.request_id=d.request_id AND r.result_version_id IS NOT NULL))
AND NOT EXISTS(SELECT 1 FROM material_source_snapshots s LEFT JOIN source_processing sp ON sp.source_id=s.source_id WHERE s.version_id=v.id AND (v.operation='original' OR (s.document_id IS NOT NULL AND sp.document_id=s.document_id))))
BEGIN SELECT RAISE(ABORT,'history cannot prune protected roots'); END;
--> statement-breakpoint
DROP TRIGGER material_history_requests_valid;
--> statement-breakpoint
CREATE TRIGGER material_history_requests_valid BEFORE INSERT ON material_history_requests
WHEN NOT EXISTS(SELECT 1 FROM material_history_prunes p WHERE p.operation_id=NEW.operation_id AND p.status='pending') OR NOT (
(NEW.kind='generation' AND (EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_history_members m ON m.version_id=i.version_id WHERE i.request_id=NEW.request_id AND m.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM material_versions v JOIN material_history_members m ON m.version_id=v.id WHERE v.generation_request_id=NEW.request_id AND m.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_history_requests c ON c.request_id=json_extract(r.payload,'$.documentTransform.contextRequestId') WHERE r.id=NEW.request_id AND c.kind='context' AND c.operation_id=NEW.operation_id)))
OR (NEW.kind='context' AND (
 EXISTS(SELECT 1 FROM (SELECT request_id,snapshot FROM session_run_contexts UNION ALL SELECT request_id,json_extract(snapshot,'$.context') AS snapshot FROM conversation_reply_requests) c,json_each(c.snapshot,'$.inputs') j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(j.value,'$.versionId') WHERE c.request_id=NEW.request_id AND m.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM conversation_reply_requests r,
   json_each(r.snapshot,'$.messages') message, json_each(message.value,'$.attachments') attachment
   JOIN source_history_documents owned ON CAST(owned.document_id AS TEXT)=json_extract(attachment.value,'$.documentId')
   JOIN documents doc ON doc.id=owned.document_id AND CAST(doc.source_id AS TEXT)=json_extract(attachment.value,'$.sourceId')
   WHERE r.request_id=NEW.request_id AND owned.operation_id=NEW.operation_id)
))
OR (NEW.kind='learning' AND (EXISTS(SELECT 1 FROM learning_practice_slots p,json_each(p.input_version_ids) j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=j.value WHERE p.id=NEW.request_id AND m.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_history_members m ON m.version_id=a.version_id WHERE e.correlation_id=NEW.request_id AND m.operation_id=NEW.operation_id)))
OR (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(e.payload,'$.materialVersionId') WHERE e.correlation_id=NEW.request_id AND m.operation_id=NEW.operation_id))
OR (NEW.kind='source' AND EXISTS(SELECT 1 FROM workflow_events e JOIN source_history_documents d ON CAST(d.document_id AS TEXT)=json_extract(e.payload,'$.documentId') WHERE e.correlation_id=NEW.request_id AND d.operation_id=NEW.operation_id AND e.type IN ('SourceIndexed','SourceCorrectionRequested')))
)
BEGIN SELECT RAISE(ABORT,'history retirement requires exact version ownership'); END;
--> statement-breakpoint
DROP TRIGGER conversation_reply_requests_history_insert;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_requests_history_insert BEFORE INSERT ON conversation_reply_requests
WHEN EXISTS(SELECT 1 FROM material_history_requests WHERE request_id=NEW.request_id)
OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.context.inputs') j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(j.value,'$.versionId'))
OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.messages') message,
 json_each(message.value,'$.attachments') attachment
 JOIN source_history_documents owned ON CAST(owned.document_id AS TEXT)=json_extract(attachment.value,'$.documentId'))
BEGIN SELECT RAISE(ABORT,'pruned input cannot be captured'); END;
