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
