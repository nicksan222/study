CREATE TABLE `workflow_configuration_waits` (
	`execution_id` text NOT NULL,
	`deferred_name` text NOT NULL,
	`observed_revision` text NOT NULL,
	CONSTRAINT `workflow_configuration_waits_pk` PRIMARY KEY(`execution_id`, `deferred_name`),
	CONSTRAINT `fk_workflow_configuration_waits_execution_id_workflow_executions_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`execution_id`) ON DELETE CASCADE
);
