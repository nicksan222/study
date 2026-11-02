CREATE TRIGGER session_generation_retirement_valid BEFORE INSERT ON session_generation_retirements
WHEN NOT EXISTS(SELECT 1 FROM material_generation_requests r JOIN session_run_contexts c
 ON c.request_id=json_extract(r.payload,'$.documentTransform.contextRequestId')
 JOIN session_deletions d ON d.session_id=c.session_id
 WHERE r.id=NEW.request_id AND c.session_id=NEW.session_id AND d.status='pending')
BEGIN SELECT RAISE(ABORT, 'retirement requires exact deleting session ownership'); END;
--> statement-breakpoint
CREATE TRIGGER session_generation_retirements_update_retained BEFORE UPDATE ON session_generation_retirements
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_generation_retirements_delete_retained BEFORE DELETE ON session_generation_retirements
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_correlations_update_retained BEFORE UPDATE ON workflow_retired_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_correlations_delete_retained BEFORE DELETE ON workflow_retired_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_executions_update_retained BEFORE UPDATE ON workflow_retired_executions
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_retired_executions_delete_retained BEFORE DELETE ON workflow_retired_executions
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_deletion_correlations_update_retained BEFORE UPDATE ON session_deletion_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_deletion_correlations_delete_retained BEFORE DELETE ON session_deletion_correlations
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER retired_document_proposal_receipts_update_retained BEFORE UPDATE ON retired_document_proposal_receipts
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER retired_document_proposal_receipts_delete_retained BEFORE DELETE ON retired_document_proposal_receipts
BEGIN SELECT RAISE(ABORT, 'retirement identities are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_deletion_retained BEFORE DELETE ON session_deletions
BEGIN SELECT RAISE(ABORT, 'deletion barriers are retained'); END;
--> statement-breakpoint
CREATE TRIGGER session_deletion_identity BEFORE UPDATE ON session_deletions
WHEN NEW.session_id IS NOT OLD.session_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.created_at IS NOT OLD.created_at
 OR (OLD.status='completed' AND (NEW.status!='completed' OR NEW.completed_at IS NOT OLD.completed_at OR NEW.error_kind IS NOT OLD.error_kind))
BEGIN SELECT RAISE(ABORT, 'deletion identity and completion are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_id_not_reusable BEFORE INSERT ON sessions
WHEN EXISTS(SELECT 1 FROM session_deletions WHERE session_id=NEW.id)
BEGIN SELECT RAISE(ABORT, 'deleted session identity cannot be reused'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_intent_immutable;
--> statement-breakpoint
CREATE TRIGGER material_generation_intent_immutable BEFORE UPDATE ON material_generation_requests
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at
 OR (NEW.payload IS NOT OLD.payload AND NOT (NEW.payload='{}' AND NEW.cancelled=1 AND NEW.result_metadata IS NULL AND EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id)))
BEGIN SELECT RAISE(ABORT, 'generation intent is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_result_immutable;
--> statement-breakpoint
CREATE TRIGGER material_generation_result_immutable BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NOT NULL AND (NEW.result_version_id IS NOT OLD.result_version_id OR NEW.result_hash IS NOT OLD.result_hash)
 AND NOT (NEW.result_version_id IS NULL AND NEW.result_hash IS NULL AND EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id)
 AND EXISTS(SELECT 1 FROM material_versions v WHERE v.id=OLD.result_version_id AND v.status='draft' AND v.generation_request_id=OLD.id))
BEGIN SELECT RAISE(ABORT, 'generation result is immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_cancel_fence;
--> statement-breakpoint
CREATE TRIGGER material_generation_cancel_fence BEFORE UPDATE ON material_generation_requests
WHEN (OLD.cancelled=1 AND NEW.cancelled!=1) OR (NEW.cancelled=1 AND OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL)
 OR (OLD.result_version_id IS NOT NULL AND NEW.result_metadata IS NOT OLD.result_metadata
 AND NOT (NEW.result_metadata IS NULL AND NEW.payload='{}' AND NEW.cancelled=1 AND EXISTS(SELECT 1 FROM session_generation_retirements x WHERE x.request_id=OLD.id)))
BEGIN SELECT RAISE(ABORT, 'generation cancellation and result metadata are immutable'); END;
--> statement-breakpoint
DROP TRIGGER material_generation_input_retained;
--> statement-breakpoint
CREATE TRIGGER material_generation_input_retained BEFORE DELETE ON material_generation_inputs
WHEN EXISTS(SELECT 1 FROM material_generation_requests WHERE id=OLD.request_id)
 AND NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT, 'generation inputs cannot be deleted'); END;
--> statement-breakpoint
DROP TRIGGER document_proposals_delete_immutable;
--> statement-breakpoint
CREATE TRIGGER document_proposals_delete_immutable BEFORE DELETE ON document_proposals
WHEN NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
DROP TRIGGER document_proposal_receipts_delete_immutable;
--> statement-breakpoint
CREATE TRIGGER document_proposal_receipts_delete_immutable BEFORE DELETE ON document_proposal_receipts
WHEN NOT EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=OLD.request_id)
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_proposal_session_active BEFORE INSERT ON document_proposals
WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id)
 OR EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT, 'proposal session is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER document_proposal_action_active BEFORE INSERT ON document_proposal_receipts
WHEN EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT, 'proposal session is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER retired_proposal_receipt_valid BEFORE INSERT ON retired_document_proposal_receipts
WHEN NOT EXISTS(SELECT 1 FROM document_proposal_receipts r JOIN document_proposals p ON p.request_id=r.request_id
 JOIN session_generation_retirements x ON x.request_id=p.request_id
 WHERE r.key=NEW.key AND r.request_id=NEW.request_id AND r.operation=NEW.operation AND r.outcome=NEW.outcome
 AND NEW.intent=r.intent AND json_type(NEW.intent)='object'
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.intent) WHERE key NOT IN ('key','requestId','projectId','expectedVersionId','baseVersionId'))
 AND r.result_version_id=NEW.result_version_id AND r.current_version_id=NEW.current_version_id AND p.base_version_id=NEW.base_version_id AND p.proposed_version_id=NEW.proposed_version_id)
BEGIN SELECT RAISE(ABORT, 'retired receipt requires completed exact proposal ownership'); END;
--> statement-breakpoint
CREATE TRIGGER retired_generation_publication BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND OLD.status!='published'
 AND EXISTS(SELECT 1 FROM session_generation_retirements WHERE request_id=NEW.generation_request_id)
BEGIN SELECT RAISE(ABORT, 'retired generation cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER retired_execution_insert BEFORE INSERT ON workflow_executions
WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=json_extract(NEW.payload,'$.event.correlationId') AND event_type=json_extract(NEW.payload,'$.event.type'))
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot restart'); END;
--> statement-breakpoint
CREATE TRIGGER retired_execution_payload BEFORE UPDATE ON workflow_executions
WHEN OLD.payload='{}' AND EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=OLD.execution_id)
 AND (NEW.payload!='{}' OR NEW.result IS NOT NULL OR NEW.owner_token IS NOT NULL OR NEW.status NOT IN ('completed','cancelled'))
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot restore checkpoints'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_activities_retired_insert BEFORE INSERT ON workflow_activities
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_deferreds_retired_insert BEFORE INSERT ON workflow_deferreds
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_clocks_retired_insert BEFORE INSERT ON workflow_clocks
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER workflow_configuration_waits_retired_insert BEFORE INSERT ON workflow_configuration_waits
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
--> statement-breakpoint
CREATE TRIGGER retired_event_insert BEFORE INSERT ON workflow_events
WHEN EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=NEW.correlation_id AND event_type=NEW.type)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot emit'); END;
--> statement-breakpoint
CREATE TRIGGER retired_event_payload BEFORE UPDATE ON workflow_events
WHEN OLD.payload='{}' AND EXISTS(SELECT 1 FROM workflow_retired_correlations WHERE correlation_id=OLD.correlation_id AND event_type=OLD.type)
 AND NEW.payload!='{}'
BEGIN SELECT RAISE(ABORT, 'retired event cannot restore content'); END;

--> statement-breakpoint
-- Only the automatically copied session instruction can retire; sealed library content is unchanged.
DROP TRIGGER material_versions_frozen;
--> statement-breakpoint
CREATE TRIGGER material_versions_frozen BEFORE UPDATE ON material_versions
WHEN (OLD.status='published' AND NOT (
 OLD.instruction IS NOT NULL AND NEW.instruction IS NULL AND NEW.id IS OLD.id AND NEW.material_id IS OLD.material_id AND NEW.kind IS OLD.kind AND NEW.number IS OLD.number AND NEW.status IS OLD.status AND NEW.operation IS OLD.operation AND NEW.creator IS OLD.creator AND NEW.generation_request_id IS OLD.generation_request_id AND NEW.language IS OLD.language AND NEW.created_at IS OLD.created_at AND NEW.published_at IS OLD.published_at
 AND EXISTS(SELECT 1 FROM session_generation_retirements x
 JOIN material_generation_requests r ON r.id=x.request_id
 JOIN session_deletions d ON d.session_id=x.session_id
 WHERE x.request_id=OLD.generation_request_id AND d.status IN ('pending','failed')
 AND OLD.instruction IS json_extract(r.payload,'$.instruction')
 AND json_extract(r.payload,'$.documentTransform.contextRequestId') IS NOT NULL)
)) OR new.id IS NOT old.id OR new.material_id IS NOT old.material_id OR new.kind IS NOT old.kind OR new.number IS NOT old.number OR new.created_at IS NOT old.created_at
BEGIN SELECT RAISE(ABORT, 'published versions and version identities are immutable'); END;

--> statement-breakpoint
DROP TRIGGER material_generation_publish;
--> statement-breakpoint
CREATE TRIGGER material_generation_publish BEFORE UPDATE OF status ON material_versions
WHEN NEW.status='published' AND NEW.creator='agent' AND NEW.operation='generate' AND NOT EXISTS(
 SELECT 1 FROM material_generation_requests r JOIN materials m ON m.id=NEW.material_id
 WHERE r.id=NEW.generation_request_id AND (json_extract(r.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=NEW.material_id AND pm.project_id=r.project_id)) AND json_extract(r.payload,'$.kind')=NEW.kind AND json_extract(r.payload,'$.title')=m.title AND (CASE WHEN json_extract(r.payload,'$.documentTransform.contextRequestId') IS NOT NULL THEN NULL ELSE json_extract(r.payload,'$.instruction') END) IS NEW.instruction
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=r.id)=json_array_length(r.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=r.id AND json_extract(r.payload,'$.kind')!='document' AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=r.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=r.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=NEW.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=r.id)
)
BEGIN SELECT RAISE(ABORT, 'generated publication does not match its request'); END;

--> statement-breakpoint
DROP TRIGGER material_generation_receipt_valid;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_valid BEFORE UPDATE OF result_version_id,result_hash ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL AND (length(NEW.result_hash)!=64 OR NEW.result_hash GLOB '*[^0-9a-f]*' OR NOT EXISTS(
 SELECT 1 FROM material_versions v JOIN materials m ON m.id=v.material_id WHERE v.id=NEW.result_version_id AND (json_extract(NEW.payload,'$.kind')='document' OR EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=NEW.project_id)) AND v.generation_request_id=NEW.id AND (
   (v.status='published' AND json_extract(NEW.payload,'$.documentTransform.editTargetVersionId') IS NULL)
   OR (v.status='draft' AND NEW.cancelled=0 AND NEW.project_id IS NULL
    AND json_extract(NEW.payload,'$.kind')='document'
    AND json_extract(NEW.payload,'$.scopeId') IS NULL
    AND EXISTS (
     SELECT 1 FROM document_proposals p
     JOIN material_versions base ON base.id=p.base_version_id AND base.material_id=v.material_id
     JOIN material_document_versions proposed_doc ON proposed_doc.version_id=v.id
     JOIN material_document_versions base_doc ON base_doc.version_id=base.id
     JOIN session_run_contexts c ON c.request_id=json_extract(NEW.payload,'$.documentTransform.contextRequestId') AND c.session_id=p.session_id
     JOIN sessions se ON se.id=c.session_id
     WHERE p.request_id=NEW.id AND p.proposed_version_id=v.id
      AND NEW.id='document/' || c.request_id
      AND json_extract(c.snapshot,'$.requestId')=c.request_id
      AND json_extract(c.snapshot,'$.sessionId')=CAST(c.session_id AS TEXT)
      AND CAST(base.id AS TEXT)=json_extract(NEW.payload,'$.documentTransform.editTargetVersionId')
      AND base.kind='document' AND base.status='published' AND base.creator!='import'
      AND proposed_doc.document_id!=base_doc.document_id
      AND EXISTS(SELECT 1 FROM blocks WHERE document_id=proposed_doc.document_id)
      AND (SELECT COUNT(*) FROM material_version_parents WHERE version_id=v.id)=1
      AND EXISTS(SELECT 1 FROM material_version_parents WHERE version_id=v.id AND parent_version_id=base.id AND material_id=base.material_id)
      AND json_array_length(c.snapshot,'$.inputs')=json_array_length(NEW.payload,'$.inputVersionIds')
      AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') i WHERE
       json_extract(NEW.payload,'$.inputVersionIds[' || i.key || ']') IS NOT json_extract(i.value,'$.versionId'))
      AND EXISTS(SELECT 1 FROM json_each(c.snapshot,'$.inputs') i WHERE
       json_extract(i.value,'$.versionId')=CAST(base.id AS TEXT)
       AND json_extract(i.value,'$.materialId')=CAST(base.material_id AS TEXT)
       AND json_extract(i.value,'$.documentId')=CAST(base_doc.document_id AS TEXT)
       AND json_extract(i.value,'$.scope.kind')='document')
    )
   )
  ) AND v.creator='agent' AND v.operation='generate' AND v.kind=json_extract(NEW.payload,'$.kind') AND v.instruction IS (CASE WHEN json_extract(NEW.payload,'$.documentTransform.contextRequestId') IS NOT NULL THEN NULL ELSE json_extract(NEW.payload,'$.instruction') END)
 AND (SELECT COUNT(*) FROM material_generation_inputs WHERE request_id=NEW.id)=json_array_length(NEW.payload,'$.inputVersionIds')
 AND NOT EXISTS(SELECT 1 FROM material_generation_inputs i JOIN material_versions iv ON iv.id=i.version_id WHERE i.request_id=NEW.id AND json_extract(NEW.payload,'$.kind')!='document' AND NOT EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=iv.material_id AND pm.project_id=NEW.project_id))
 AND NOT EXISTS(SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id EXCEPT SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id)
 AND NOT EXISTS(SELECT input_version_id FROM material_version_inputs WHERE version_id=v.id EXCEPT SELECT version_id FROM material_generation_inputs WHERE request_id=NEW.id)
))
BEGIN SELECT RAISE(ABORT, 'generation receipt does not identify its retained output'); END;
