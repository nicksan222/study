-- Retire only local indexing executions; migrations run with foreign keys disabled.
CREATE TEMP TABLE retired_search_executions AS WITH RECURSIVE retired(id) AS (
 SELECT execution_id FROM workflow_executions WHERE workflow_tag='search-reconciliation/v1'
 UNION SELECT child.execution_id FROM workflow_executions child JOIN retired parent ON child.parent_execution_id=parent.id
) SELECT id FROM retired;
--> statement-breakpoint
DELETE FROM workflow_configuration_waits WHERE execution_id IN (SELECT id FROM retired_search_executions);
--> statement-breakpoint
DELETE FROM workflow_agent_progress WHERE execution_id IN (SELECT id FROM retired_search_executions);
--> statement-breakpoint
DELETE FROM workflow_clocks WHERE execution_id IN (SELECT id FROM retired_search_executions);
--> statement-breakpoint
DELETE FROM workflow_deferreds WHERE execution_id IN (SELECT id FROM retired_search_executions);
--> statement-breakpoint
DELETE FROM workflow_activities WHERE execution_id IN (SELECT id FROM retired_search_executions);
--> statement-breakpoint
DELETE FROM workflow_receipts WHERE execution_id IN (SELECT id FROM retired_search_executions);
--> statement-breakpoint
DELETE FROM workflow_executions WHERE execution_id IN (SELECT id FROM retired_search_executions);
--> statement-breakpoint
DROP TABLE retired_search_executions;
--> statement-breakpoint
DROP INDEX IF EXISTS `semantic_search_model_idx`;--> statement-breakpoint
DROP TABLE `semantic_search_entries`;
