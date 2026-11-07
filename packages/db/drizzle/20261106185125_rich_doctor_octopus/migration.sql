CREATE TABLE `workflow_agent_progress` (
	`run_id` text PRIMARY KEY,
	`execution_id` text NOT NULL,
	`owner_token` text NOT NULL,
	`activity_name` text NOT NULL,
	`attempt` integer NOT NULL,
	`agent_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`failure_kind` text,
	`text` text DEFAULT '' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_agent_progress_execution_id_workflow_executions_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`execution_id`) ON DELETE CASCADE,
	CONSTRAINT "workflow_agent_progress_tools_check" CHECK(json_valid("tools")),
	CONSTRAINT "workflow_agent_progress_mode_check" CHECK("mode" IN ('text', 'object')),
	CONSTRAINT "workflow_agent_progress_status_check" CHECK("status" IN ('running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `workflow_agent_progress_execution_idx` ON `workflow_agent_progress` (`execution_id`,`updated_at`);