CREATE TABLE `workflow_job_bindings` (
	`execution_id` text NOT NULL,
	`activity_name` text NOT NULL,
	`activity_attempt` integer NOT NULL,
	`job_id` integer NOT NULL,
	`owner_token` text NOT NULL,
	`snapshot` text NOT NULL,
	CONSTRAINT `workflow_job_bindings_pk` PRIMARY KEY(`execution_id`, `activity_name`, `activity_attempt`),
	CONSTRAINT `fk_workflow_job_bindings_execution_id_workflow_executions_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`execution_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workflow_job_bindings_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "workflow_job_bindings_attempt_check" CHECK("activity_attempt" >= 0),
	CONSTRAINT "workflow_job_bindings_snapshot_check" CHECK(json_valid("snapshot"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_job_bindings_job_unique` ON `workflow_job_bindings` (`job_id`);