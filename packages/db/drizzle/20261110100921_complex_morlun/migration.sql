PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workflow_configuration_waits` (
	`execution_id` text NOT NULL,
	`deferred_name` text NOT NULL,
	`observed_revision` text NOT NULL,
	`reason` text,
	CONSTRAINT `workflow_configuration_waits_pk` PRIMARY KEY(`execution_id`, `deferred_name`),
	CONSTRAINT `fk_workflow_configuration_waits_execution_id_workflow_executions_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`execution_id`) ON DELETE CASCADE,
	CONSTRAINT "workflow_configuration_waits_reason_check" CHECK("reason" IN ('auth', 'config', 'model_unavailable'))
);
--> statement-breakpoint
INSERT INTO `__new_workflow_configuration_waits`(`execution_id`, `deferred_name`, `observed_revision`, `reason`) SELECT `execution_id`, `deferred_name`, `observed_revision`, `reason` FROM `workflow_configuration_waits`;--> statement-breakpoint
DROP TABLE `workflow_configuration_waits`;--> statement-breakpoint
ALTER TABLE `__new_workflow_configuration_waits` RENAME TO `workflow_configuration_waits`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Rebuilding the table drops its SQL-managed retirement guard.
CREATE TRIGGER workflow_configuration_waits_retired_insert BEFORE INSERT ON workflow_configuration_waits
WHEN EXISTS(SELECT 1 FROM workflow_retired_executions WHERE execution_id=NEW.execution_id)
BEGIN SELECT RAISE(ABORT, 'retired workflow cannot checkpoint'); END;
