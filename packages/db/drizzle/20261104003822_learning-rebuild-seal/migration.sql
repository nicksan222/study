CREATE TRIGGER learning_practice_answer_immutable
BEFORE UPDATE OF answer ON material_quiz_responses
WHEN NEW.answer IS NOT OLD.answer AND EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_insert
BEFORE INSERT ON material_quiz_selections
WHEN EXISTS (SELECT 1 FROM learning_practice_slots p WHERE p.attempt_id = NEW.attempt_id AND p.status = 'answered')
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_update
BEFORE UPDATE ON material_quiz_selections
WHEN EXISTS (SELECT 1 FROM learning_practice_slots p WHERE p.attempt_id IN (OLD.attempt_id, NEW.attempt_id) AND p.status = 'answered')
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_request_valid BEFORE INSERT ON material_deletion_requests
WHEN NOT EXISTS(SELECT 1 FROM material_deletions d WHERE d.material_id=NEW.deletion_id AND d.status='pending') OR NOT (
 (NEW.kind='generation' AND (
  EXISTS(SELECT 1 FROM material_generation_requests r JOIN material_deletion_requests c ON c.request_id=json_extract(r.payload,'$.documentTransform.contextRequestId') WHERE r.id=NEW.request_id AND c.kind='context' AND c.deletion_id=NEW.deletion_id) OR
  EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions v ON v.id=i.version_id JOIN material_deletion_members m ON m.material_id=v.material_id WHERE i.request_id=NEW.request_id AND m.deletion_id=NEW.deletion_id)
  OR EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members m ON m.material_id=v.material_id WHERE v.generation_request_id=NEW.request_id AND m.deletion_id=NEW.deletion_id)
  OR EXISTS(SELECT 1 FROM material_generation_requests r JOIN session_run_contexts c ON c.request_id=json_extract(r.payload,'$.documentTransform.contextRequestId'),json_tree(c.snapshot) j JOIN material_deletion_members m ON CAST(m.material_id AS TEXT)=CAST(j.value AS TEXT) WHERE r.id=NEW.request_id AND j.key='materialId' AND m.deletion_id=NEW.deletion_id)
 )) OR
 (NEW.kind='context' AND EXISTS(
  SELECT 1 FROM (SELECT request_id,snapshot FROM session_run_contexts UNION ALL SELECT request_id,snapshot FROM conversation_reply_requests) c,json_tree(c.snapshot) j
  WHERE c.request_id=NEW.request_id AND (
   (j.key='materialId' AND EXISTS(SELECT 1 FROM material_deletion_members m WHERE CAST(m.material_id AS TEXT)=CAST(j.value AS TEXT) AND m.deletion_id=NEW.deletion_id))
   OR (j.key='sourceId' AND EXISTS(SELECT 1 FROM material_imports i JOIN material_deletion_members m ON m.material_id=i.material_id WHERE CAST(i.source_id AS TEXT)=CAST(j.value AS TEXT) AND m.deletion_id=NEW.deletion_id))
  ))) OR
 (NEW.kind='source' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_imports i ON CAST(i.source_id AS TEXT)=json_extract(e.payload,'$.sourceId') JOIN material_deletion_members m ON m.material_id=i.material_id WHERE e.correlation_id=NEW.request_id AND m.deletion_id=NEW.deletion_id AND e.type IN ('SourceProcessingRequested','SourceCorrectionRequested','SourceIndexed','SourceProcessingFailed','SourceProjectChanged'))) OR
 (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_deletion_members m ON CAST(m.material_id AS TEXT)=json_extract(e.payload,'$.materialId') WHERE e.correlation_id=NEW.request_id AND m.deletion_id=NEW.deletion_id AND e.type IN ('MaterialPublished','MaterialAnnotationChanged'))) OR
 (NEW.kind='recording' AND EXISTS(SELECT 1 FROM source_recording_imports r JOIN material_imports i ON i.source_id=r.source_id JOIN material_deletion_members m ON m.material_id=i.material_id WHERE r.request_id=NEW.request_id AND m.deletion_id=NEW.deletion_id)) OR
 (NEW.kind='learning' AND (
  EXISTS(SELECT 1 FROM learning_practice_slots p,json_each(p.inputs) j JOIN material_versions v ON CAST(v.id AS TEXT)=j.value JOIN material_deletion_members m ON m.material_id=v.material_id WHERE p.id=NEW.request_id AND m.deletion_id=NEW.deletion_id)
  OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_versions v ON v.id=a.version_id JOIN material_deletion_members m ON m.material_id=v.material_id WHERE e.correlation_id=NEW.request_id AND m.deletion_id=NEW.deletion_id AND e.type='QuizAnswerSubmitted')
 ))
)
BEGIN SELECT RAISE(ABORT,'retirement requires exact deleting Material ownership'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_delete
BEFORE DELETE ON material_quiz_selections
WHEN ((EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=(SELECT version_id FROM material_quiz_attempts WHERE id=OLD.attempt_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
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
OR (NEW.kind='learning' AND (EXISTS(SELECT 1 FROM learning_practice_slots p,json_each(p.inputs) j JOIN material_history_members m ON CAST(m.version_id AS TEXT)=j.value WHERE p.id=NEW.request_id AND m.operation_id=NEW.operation_id)
 OR EXISTS(SELECT 1 FROM workflow_events e JOIN material_quiz_attempts a ON CAST(a.id AS TEXT)=json_extract(e.payload,'$.attemptId') JOIN material_history_members m ON m.version_id=a.version_id WHERE e.correlation_id=NEW.request_id AND m.operation_id=NEW.operation_id)))
OR (NEW.kind='publication' AND EXISTS(SELECT 1 FROM workflow_events e JOIN material_history_members m ON CAST(m.version_id AS TEXT)=json_extract(e.payload,'$.materialVersionId') WHERE e.correlation_id=NEW.request_id AND m.operation_id=NEW.operation_id))
OR (NEW.kind='source' AND EXISTS(SELECT 1 FROM workflow_events e JOIN source_history_documents d ON CAST(d.document_id AS TEXT)=json_extract(e.payload,'$.documentId') WHERE e.correlation_id=NEW.request_id AND d.operation_id=NEW.operation_id AND e.type IN ('SourceIndexed','SourceCorrectionRequested')))
)
BEGIN SELECT RAISE(ABORT,'history retirement requires exact version ownership'); END;
