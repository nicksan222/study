CREATE TRIGGER study_document_generation_base_insert BEFORE INSERT ON study_document_generation_requests
WHEN (1) AND NEW.expected_version_id IS NOT NULL AND NOT (EXISTS(SELECT 1 FROM study_document_versions b WHERE b.id=NEW.expected_version_id AND b.document_id=NEW.document_id AND b.status='published' AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id=b.id)))
BEGIN SELECT RAISE(ABORT,'generation requires its exact retained authored base'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_generation_base_update BEFORE UPDATE OF result_version_id ON study_document_generation_requests
WHEN (OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL) AND NEW.expected_version_id IS NOT NULL AND NOT (EXISTS(SELECT 1 FROM study_document_versions b WHERE b.id=NEW.expected_version_id AND b.document_id=NEW.document_id AND b.status='published' AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id=b.id)))
BEGIN SELECT RAISE(ABORT,'generation requires its exact retained authored base'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_generation_result_insert BEFORE INSERT ON study_document_generation_requests
WHEN NEW.result_version_id IS NOT NULL AND (NOT (EXISTS(SELECT 1 FROM study_document_versions v WHERE v.id=NEW.result_version_id AND v.document_id=NEW.document_id AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM study_document_version_parents p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM study_document_version_parents p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p.document_id=NEW.document_id)
  AND (v.status='published' OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM study_document_transform_requests WHERE id=NEW.id) OR EXISTS(
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
CREATE TRIGGER study_document_generation_result_update BEFORE UPDATE OF result_version_id ON study_document_generation_requests
WHEN NEW.result_version_id IS NOT NULL AND OLD.result_version_id IS NULL AND (NOT (EXISTS(SELECT 1 FROM study_document_versions v WHERE v.id=NEW.result_version_id AND v.document_id=NEW.document_id AND v.creator='agent' AND v.operation IN ('generate','summarize','translate')
 AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id=v.id)
 AND ((NEW.expected_version_id IS NULL AND v.status='published' AND v.number=1)
 OR (NEW.expected_version_id IS NOT NULL
  AND (SELECT COUNT(*) FROM study_document_version_parents p WHERE p.version_id=v.id)=1
  AND EXISTS(SELECT 1 FROM study_document_version_parents p WHERE p.version_id=v.id AND p.parent_version_id=NEW.expected_version_id AND p.document_id=NEW.document_id)
  AND (v.status='published' OR EXISTS(SELECT 1 FROM study_document_proposals p WHERE p.request_id=NEW.id AND p.base_version_id=NEW.expected_version_id AND p.proposed_version_id=v.id)))))) OR NOT (NOT EXISTS(SELECT 1 FROM study_document_transform_requests WHERE id=NEW.id) OR EXISTS(
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
CREATE TRIGGER study_document_proposal_exact_owner BEFORE INSERT ON study_document_proposals
WHEN NOT (EXISTS(SELECT 1 FROM study_document_generation_requests r JOIN study_document_versions b ON b.id=NEW.base_version_id JOIN study_document_versions p ON p.id=NEW.proposed_version_id
 WHERE r.id=NEW.request_id AND r.document_id=b.document_id AND r.expected_version_id=b.id AND b.status='published'
 AND p.document_id=b.document_id AND p.status='draft' AND p.creator='agent' AND p.operation IN ('generate','summarize','translate')
 AND (r.result_version_id IS NULL OR r.result_version_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id IN (b.id,p.id))))
BEGIN SELECT RAISE(ABORT,'proposal requires its exact authored request and target'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_generation_requests_retained_delete BEFORE DELETE ON study_document_generation_requests
WHEN 1
BEGIN SELECT RAISE(ABORT,'authored generation identities are retained'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_proposals_retained_delete BEFORE DELETE ON study_document_proposals
WHEN 1
BEGIN SELECT RAISE(ABORT,'authored generation identities are retained'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_transform_result_hash BEFORE UPDATE OF result_version_id ON study_document_transform_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (NEW.result_hash IS NULL OR length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NEW.cancelled=1 OR NEW.session_id IS NULL OR EXISTS(SELECT 1 FROM session_deletions WHERE session_id=NEW.session_id))
BEGIN SELECT RAISE(ABORT,'authored transform cannot complete outside its retained authority'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_proposal_receipt_exact_owner BEFORE INSERT ON study_document_proposal_receipts
WHEN NOT (EXISTS(SELECT 1 FROM study_document_proposals p JOIN study_document_versions base ON base.id=p.base_version_id JOIN study_document_versions proposed ON proposed.id=p.proposed_version_id JOIN study_document_versions current ON current.id=NEW.current_version_id
 WHERE p.request_id=NEW.request_id AND current.document_id=base.document_id AND current.status='published'
 AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id IN (base.id,proposed.id,current.id))
 AND NOT EXISTS(SELECT 1 FROM study_document_transform_requests t WHERE t.id=p.request_id AND (t.cancelled=1 OR t.session_id IS NULL OR EXISTS(SELECT 1 FROM session_deletions d WHERE d.session_id=t.session_id)))
 AND NOT EXISTS(SELECT 1 FROM study_document_proposal_receipts old WHERE old.request_id=NEW.request_id AND old.operation=NEW.operation AND old.result_version_id IS NOT NULL)
 AND ((NEW.outcome='conflict' AND NOT EXISTS(SELECT 1 FROM study_document_versions newer WHERE newer.document_id=current.document_id AND newer.status='published' AND newer.number>current.number))
 OR EXISTS(SELECT 1 FROM study_document_versions result WHERE result.id=NEW.result_version_id AND result.status='published'
 AND NOT EXISTS(SELECT 1 FROM study_document_retirements x WHERE x.version_id=result.id)
 AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM study_document_inputs WHERE version_id=proposed.id EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM study_document_inputs WHERE version_id=result.id) AND NOT EXISTS(SELECT position,document_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM study_document_inputs WHERE version_id=result.id EXCEPT SELECT position,document_version_id,source_id,source_revision,source_snapshot_id,exact_message_version_id FROM study_document_inputs WHERE version_id=proposed.id) AND NOT EXISTS(SELECT c.marker,c.quote,i.position,i.document_version_id,i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM study_document_citations c JOIN study_document_inputs i ON i.id=c.input_id WHERE c.version_id=proposed.id EXCEPT SELECT c.marker,c.quote,i.position,i.document_version_id,i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM study_document_citations c JOIN study_document_inputs i ON i.id=c.input_id WHERE c.version_id=result.id) AND NOT EXISTS(SELECT c.marker,c.quote,i.position,i.document_version_id,i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM study_document_citations c JOIN study_document_inputs i ON i.id=c.input_id WHERE c.version_id=result.id EXCEPT SELECT c.marker,c.quote,i.position,i.document_version_id,i.source_id,i.source_revision,i.source_snapshot_id,i.exact_message_version_id FROM study_document_citations c JOIN study_document_inputs i ON i.id=c.input_id WHERE c.version_id=proposed.id) AND NOT EXISTS(SELECT 1 FROM study_document_citations ca JOIN study_document_citations cb ON cb.version_id=result.id AND cb.marker=ca.marker WHERE ca.version_id=proposed.id AND (NOT (ca.anchor IS cb.anchor OR (ca.anchor IS NOT NULL AND cb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ca.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(cb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(cb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ca.anchor)))) OR NOT (ca.target IS cb.target OR (ca.target IS NOT NULL AND cb.target IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ca.target) EXCEPT SELECT fullkey,type,atom FROM json_tree(cb.target)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(cb.target) EXCEPT SELECT fullkey,type,atom FROM json_tree(ca.target))))))
 AND ((NEW.outcome='applied' AND result.document_id=base.document_id AND current.id=base.id AND result.creator='user' AND result.operation='edit'
 AND result.instruction IS proposed.instruction AND result.language IS proposed.language
 AND EXISTS(SELECT 1 FROM study_document_version_parents parent WHERE parent.version_id=result.id AND parent.parent_version_id=base.id)
 AND NOT EXISTS(SELECT 1 FROM study_document_version_parents parent WHERE parent.version_id=result.id AND parent.parent_version_id!=base.id)
 AND NOT EXISTS(SELECT 1 FROM study_document_versions middle WHERE middle.document_id=base.document_id AND middle.status='published' AND middle.number>base.number AND middle.number<result.number)
 AND ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) OR ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS NOT NULL AND (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id))) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)))))
 AND (SELECT COUNT(*) FROM blocks WHERE document_id=proposed.content_snapshot_id)=(SELECT COUNT(*) FROM blocks WHERE document_id=result.content_snapshot_id)
 AND NOT EXISTS(SELECT 1 FROM blocks ob WHERE ob.document_id=proposed.content_snapshot_id AND NOT EXISTS(SELECT 1 FROM blocks nb WHERE nb.document_id=result.content_snapshot_id
 AND nb.ordinal=ob.ordinal AND nb.kind=ob.kind AND nb.text=ob.text AND nb.editing_id=ob.editing_id
 AND (ob.content IS nb.content OR (ob.content IS NOT NULL AND nb.content IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.content)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.content)))) AND (ob.anchor IS nb.anchor OR (ob.anchor IS NOT NULL AND nb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.anchor)))))))
 OR (NEW.outcome='kept' AND result.document_id!=base.document_id AND result.number=1 AND result.creator='agent'
 AND result.operation=CASE WHEN proposed.operation='translate' THEN 'translate' ELSE 'generate' END
 AND result.instruction=coalesce(proposed.instruction,'Retained proposal') AND result.language IS proposed.language
 AND NOT EXISTS(SELECT 1 FROM study_document_version_parents parent WHERE parent.version_id=result.id)
 AND NOT EXISTS(SELECT 1 FROM study_document_versions newer WHERE newer.document_id=current.document_id AND newer.status='published' AND newer.number>current.number)
 AND NOT EXISTS(SELECT 1 FROM blocks old JOIN blocks fresh ON fresh.editing_id=old.editing_id WHERE old.document_id=proposed.content_snapshot_id AND fresh.document_id=result.content_snapshot_id)
 AND ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) OR ((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id) IS NOT NULL AND (SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id) IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id))) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=result.content_snapshot_id)) EXCEPT SELECT fullkey,type,atom FROM json_tree((SELECT meta FROM content_snapshots WHERE id=proposed.content_snapshot_id)))))
 AND (SELECT COUNT(*) FROM blocks WHERE document_id=proposed.content_snapshot_id)=(SELECT COUNT(*) FROM blocks WHERE document_id=result.content_snapshot_id)
 AND NOT EXISTS(SELECT 1 FROM blocks ob WHERE ob.document_id=proposed.content_snapshot_id AND NOT EXISTS(SELECT 1 FROM blocks nb WHERE nb.document_id=result.content_snapshot_id
 AND nb.ordinal=ob.ordinal AND nb.kind=ob.kind AND nb.text=ob.text AND nb.editing_id!=ob.editing_id
 AND (ob.content IS nb.content OR (ob.content IS NOT NULL AND nb.content IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.content)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.content) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.content)))) AND (ob.anchor IS nb.anchor OR (ob.anchor IS NOT NULL AND nb.anchor IS NOT NULL AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(ob.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(nb.anchor)) AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(nb.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(ob.anchor))))))))))))
BEGIN SELECT RAISE(ABORT,'proposal receipt requires its exact retained result and target'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_proposal_receipts_retained_delete BEFORE DELETE ON study_document_proposal_receipts
WHEN 1
BEGIN SELECT RAISE(ABORT,'authored proposal receipts are retained'); END;
