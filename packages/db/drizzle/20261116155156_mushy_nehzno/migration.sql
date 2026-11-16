ALTER TABLE `workflow_agent_progress` ADD `trace` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workflow_agent_progress` (
	`run_id` text PRIMARY KEY,
	`execution_id` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`activity_name` text NOT NULL,
	`attempt` integer NOT NULL,
	`agent_id` text NOT NULL,
	`phase` text DEFAULT 'generating' NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`failure_kind` text,
	`text` text DEFAULT '' NOT NULL,
	`tools` text DEFAULT '[]' NOT NULL,
	`trace` text,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_agent_progress_execution_id_workflow_executions_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`execution_id`) ON DELETE CASCADE,
	CONSTRAINT "workflow_agent_progress_phase_check" CHECK("phase" IN ('generating', 'preparing', 'compacting')),
	CONSTRAINT "workflow_agent_progress_trace_check" CHECK("trace" IS NULL OR json_valid("trace")),
	CONSTRAINT "workflow_agent_progress_tools_check" CHECK(json_valid("tools")),
	CONSTRAINT "workflow_agent_progress_mode_check" CHECK("mode" IN ('text', 'object')),
	CONSTRAINT "workflow_agent_progress_status_check" CHECK("status" IN ('running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_workflow_agent_progress`(`run_id`, `execution_id`, `generation`, `activity_name`, `attempt`, `agent_id`, `phase`, `mode`, `status`, `failure_kind`, `text`, `tools`, `revision`, `updated_at`) SELECT `run_id`, `execution_id`, `generation`, `activity_name`, `attempt`, `agent_id`, `phase`, `mode`, `status`, `failure_kind`, `text`, `tools`, `revision`, `updated_at` FROM `workflow_agent_progress`;--> statement-breakpoint
DROP TABLE `workflow_agent_progress`;--> statement-breakpoint
ALTER TABLE `__new_workflow_agent_progress` RENAME TO `workflow_agent_progress`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `workflow_agent_progress_execution_idx` ON `workflow_agent_progress` (`execution_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_run_id` ON `ai_usage` (`runId`);