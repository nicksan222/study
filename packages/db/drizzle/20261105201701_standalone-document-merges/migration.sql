DROP TRIGGER study_document_generation_result_insert;
--> statement-breakpoint
CREATE TRIGGER study_document_generation_result_insert BEFORE INSERT ON study_document_generation_requests
WHEN NEW.result_version_id IS NOT NULL AND (NOT (EXISTS(SELECT 1 FROM study_document_versions v WHERE v.id=NEW.result_version_id AND v.document_id=NEW.document_id AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM study_document_version_parents p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM study_document_version_parents p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p.document_id=NEW.document_id)
  AND (v.status='published' OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM study_document_transform_requests WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM study_document_transform_requests tr
 JOIN study_document_versions v ON v.id=NEW.result_version_id
 JOIN study_documents output ON output.id=v.document_id
 WHERE tr.id=NEW.id AND tr.session_id IS NULL AND NEW.session_id IS NULL
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
 AND (SELECT COUNT(*) FROM study_document_inputs i WHERE i.version_id=v.id)=json_array_length(tr.request,'$.merge.versions')
 AND (SELECT COUNT(DISTINCT b.document_id) FROM json_each(tr.request,'$.merge.versions') j
      JOIN study_document_versions b ON CAST(b.id AS TEXT)=j.value)=json_array_length(tr.request,'$.merge.versions')
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.merge.versions') j WHERE NOT EXISTS(
     SELECT 1 FROM study_document_versions b
     JOIN study_documents d ON d.id=b.document_id
     JOIN study_document_inputs i ON i.version_id=v.id AND i.document_version_id=b.id AND i.position=CAST(j.key AS INTEGER)
     WHERE CAST(b.id AS TEXT)=j.value AND b.status='published'
     AND b.document_id!=v.document_id AND d.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM study_document_versions newer WHERE newer.document_id=b.document_id AND newer.status='published' AND newer.number>b.number)
     AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=b.id)
     AND NOT EXISTS(SELECT 1 FROM study_document_deletions x WHERE x.document_id=b.document_id)
   )
 )
) OR EXISTS(
 SELECT 1 FROM study_document_transform_requests tr JOIN session_run_contexts c ON c.request_id=tr.context_request_id JOIN study_document_versions v ON v.id=NEW.result_version_id
 WHERE tr.id=NEW.id AND (NEW.session_id IS NULL OR NEW.session_id=tr.session_id) AND tr.cancelled=0 AND tr.session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM session_deletions d WHERE d.session_id=tr.session_id)
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND tr.context_request_id=c.request_id AND c.session_id=tr.session_id
 AND json_extract(c.snapshot,'$.requestId')=c.request_id AND json_extract(c.snapshot,'$.sessionId')=CAST(c.session_id AS TEXT)
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS CASE WHEN NEW.expected_version_id IS NULL THEN NULL ELSE CAST(NEW.expected_version_id AS TEXT) END
 AND (NEW.expected_version_id IS NULL OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j JOIN study_document_versions b ON CAST(json_extract(j.value,'$.input.versionId') AS INTEGER)=b.id
  WHERE json_extract(j.value,'$.input.kind')='document' AND b.id=NEW.expected_version_id
   AND json_extract(j.value,'$.scope.kind')='document' AND json_extract(j.value,'$.snapshotId')=CAST(b.content_snapshot_id AS TEXT)))
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE
  (json_extract(j.value,'$.input.kind')='document' AND NOT EXISTS(SELECT 1 FROM study_document_versions b JOIN session_context_documents p ON p.version_id=b.id AND p.request_id=c.request_id
   WHERE b.id=CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) AND CAST(b.content_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM session_context_sources p WHERE p.request_id=c.request_id
   AND CAST(p.source_id AS TEXT)=json_extract(j.value,'$.input.sourceId') AND CAST(p.revision AS TEXT)=json_extract(j.value,'$.input.revision')
   AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.input.snapshotId') AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN ('document','source'))
 AND (SELECT COUNT(*) FROM study_document_inputs i WHERE i.version_id=NEW.result_version_id)=
  (SELECT COUNT(*) FROM session_context_documents WHERE request_id=c.request_id)+(SELECT COUNT(*) FROM session_context_sources WHERE request_id=c.request_id)+json_array_length(c.snapshot,'$.messages')
 AND NOT EXISTS(SELECT version_id FROM session_context_documents WHERE request_id=c.request_id EXCEPT SELECT document_version_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND document_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT document_version_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND document_version_id IS NOT NULL EXCEPT SELECT version_id FROM session_context_documents WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT source_id,revision,snapshot_id FROM session_context_sources WHERE request_id=c.request_id EXCEPT SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL)
 AND NOT EXISTS(SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL EXCEPT SELECT source_id,revision,snapshot_id FROM session_context_sources WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j EXCEPT SELECT exact_message_version_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT exact_message_version_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL EXCEPT SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j)
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND v.operation=CASE WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='translate') THEN 'translate' WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='summarize') THEN 'summarize' ELSE 'generate' END
 AND (NEW.expected_version_id IS NOT NULL OR (SELECT title FROM study_documents WHERE id=v.document_id)=json_extract(tr.request,'$.title')))))
BEGIN SELECT RAISE(ABORT,'authored generation result does not match its exact retained authority'); END;
--> statement-breakpoint
DROP TRIGGER study_document_generation_result_update;
--> statement-breakpoint
CREATE TRIGGER study_document_generation_result_update BEFORE UPDATE OF result_version_id ON study_document_generation_requests
WHEN NEW.result_version_id IS NOT NULL AND OLD.result_version_id IS NULL AND (NOT (EXISTS(SELECT 1 FROM study_document_versions v WHERE v.id=NEW.result_version_id AND v.document_id=NEW.document_id AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM study_document_version_parents p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM study_document_version_parents p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p.document_id=NEW.document_id)
  AND (v.status='published' OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM study_document_transform_requests WHERE id=NEW.id) OR EXISTS(
 SELECT 1 FROM study_document_transform_requests tr
 JOIN study_document_versions v ON v.id=NEW.result_version_id
 JOIN study_documents output ON output.id=v.document_id
 WHERE tr.id=NEW.id AND tr.session_id IS NULL AND NEW.session_id IS NULL
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
 AND (SELECT COUNT(*) FROM study_document_inputs i WHERE i.version_id=v.id)=json_array_length(tr.request,'$.merge.versions')
 AND (SELECT COUNT(DISTINCT b.document_id) FROM json_each(tr.request,'$.merge.versions') j
      JOIN study_document_versions b ON CAST(b.id AS TEXT)=j.value)=json_array_length(tr.request,'$.merge.versions')
 AND NOT EXISTS(
   SELECT 1 FROM json_each(tr.request,'$.merge.versions') j WHERE NOT EXISTS(
     SELECT 1 FROM study_document_versions b
     JOIN study_documents d ON d.id=b.document_id
     JOIN study_document_inputs i ON i.version_id=v.id AND i.document_version_id=b.id AND i.position=CAST(j.key AS INTEGER)
     WHERE CAST(b.id AS TEXT)=j.value AND b.status='published'
     AND b.document_id!=v.document_id AND d.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM study_document_versions newer WHERE newer.document_id=b.document_id AND newer.status='published' AND newer.number>b.number)
     AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=b.id)
     AND NOT EXISTS(SELECT 1 FROM study_document_deletions x WHERE x.document_id=b.document_id)
   )
 )
) OR EXISTS(
 SELECT 1 FROM study_document_transform_requests tr JOIN session_run_contexts c ON c.request_id=tr.context_request_id JOIN study_document_versions v ON v.id=NEW.result_version_id
 WHERE tr.id=NEW.id AND (NEW.session_id IS NULL OR NEW.session_id=tr.session_id) AND tr.cancelled=0 AND tr.session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM session_deletions d WHERE d.session_id=tr.session_id)
 AND NOT EXISTS(SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id IN (tr.id,tr.context_request_id))
 AND NOT EXISTS(SELECT 1 FROM workflow_executions e WHERE e.status='cancelled' AND json_extract(e.payload,'$.event.correlationId') IN (tr.id,tr.context_request_id))
 AND tr.context_request_id=c.request_id AND c.session_id=tr.session_id
 AND json_extract(c.snapshot,'$.requestId')=c.request_id AND json_extract(c.snapshot,'$.sessionId')=CAST(c.session_id AS TEXT)
 AND json_extract(tr.request,'$.contextRequestId')=tr.context_request_id
 AND json_extract(tr.request,'$.editTargetVersionId') IS CASE WHEN NEW.expected_version_id IS NULL THEN NULL ELSE CAST(NEW.expected_version_id AS TEXT) END
 AND (NEW.expected_version_id IS NULL OR EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j JOIN study_document_versions b ON CAST(json_extract(j.value,'$.input.versionId') AS INTEGER)=b.id
  WHERE json_extract(j.value,'$.input.kind')='document' AND b.id=NEW.expected_version_id
   AND json_extract(j.value,'$.scope.kind')='document' AND json_extract(j.value,'$.snapshotId')=CAST(b.content_snapshot_id AS TEXT)))
 AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') j WHERE
  (json_extract(j.value,'$.input.kind')='document' AND NOT EXISTS(SELECT 1 FROM study_document_versions b JOIN session_context_documents p ON p.version_id=b.id AND p.request_id=c.request_id
   WHERE b.id=CAST(json_extract(j.value,'$.input.versionId') AS INTEGER) AND CAST(b.content_snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR (json_extract(j.value,'$.input.kind')='source' AND NOT EXISTS(SELECT 1 FROM session_context_sources p WHERE p.request_id=c.request_id
   AND CAST(p.source_id AS TEXT)=json_extract(j.value,'$.input.sourceId') AND CAST(p.revision AS TEXT)=json_extract(j.value,'$.input.revision')
   AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.input.snapshotId') AND CAST(p.snapshot_id AS TEXT)=json_extract(j.value,'$.snapshotId')))
  OR json_extract(j.value,'$.input.kind') IS NULL OR json_extract(j.value,'$.input.kind') NOT IN ('document','source'))
 AND (SELECT COUNT(*) FROM study_document_inputs i WHERE i.version_id=NEW.result_version_id)=
  (SELECT COUNT(*) FROM session_context_documents WHERE request_id=c.request_id)+(SELECT COUNT(*) FROM session_context_sources WHERE request_id=c.request_id)+json_array_length(c.snapshot,'$.messages')
 AND NOT EXISTS(SELECT version_id FROM session_context_documents WHERE request_id=c.request_id EXCEPT SELECT document_version_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND document_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT document_version_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND document_version_id IS NOT NULL EXCEPT SELECT version_id FROM session_context_documents WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT source_id,revision,snapshot_id FROM session_context_sources WHERE request_id=c.request_id EXCEPT SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL)
 AND NOT EXISTS(SELECT source_id,source_revision,source_snapshot_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND source_id IS NOT NULL EXCEPT SELECT source_id,revision,snapshot_id FROM session_context_sources WHERE request_id=c.request_id)
 AND NOT EXISTS(SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j EXCEPT SELECT exact_message_version_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL)
 AND NOT EXISTS(SELECT exact_message_version_id FROM study_document_inputs WHERE version_id=NEW.result_version_id AND exact_message_version_id IS NOT NULL EXCEPT SELECT CAST(json_extract(j.value,'$.versionId') AS INTEGER) FROM json_each(c.snapshot,'$.messages') j)
 AND v.instruction=CASE WHEN tr.instruction!='' THEN tr.instruction ELSE (SELECT group_concat(value,', ') FROM json_each(tr.request,'$.operations')) END
 AND v.operation=CASE WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='translate') THEN 'translate' WHEN EXISTS(SELECT 1 FROM json_each(tr.request,'$.operations') WHERE value='summarize') THEN 'summarize' ELSE 'generate' END
 AND (NEW.expected_version_id IS NOT NULL OR (SELECT title FROM study_documents WHERE id=v.document_id)=json_extract(tr.request,'$.title')))))
BEGIN SELECT RAISE(ABORT,'authored generation result does not match its exact retained authority'); END;
--> statement-breakpoint
DROP TRIGGER study_document_transform_result_hash;
--> statement-breakpoint
CREATE TRIGGER study_document_transform_result_hash BEFORE UPDATE OF result_version_id ON study_document_transform_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (NEW.result_hash IS NULL OR length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NEW.cancelled=1 OR (NEW.session_id IS NULL AND json_type(NEW.request,'$.merge') IS NOT 'object') OR EXISTS(SELECT 1 FROM session_deletions WHERE session_id=NEW.session_id))
BEGIN SELECT RAISE(ABORT,'authored transform cannot complete outside its retained authority'); END;
