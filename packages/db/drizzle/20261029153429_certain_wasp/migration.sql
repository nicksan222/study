CREATE TABLE `workflow_activities` (
	`execution_id` text NOT NULL,
	`name` text NOT NULL,
	`attempt` integer NOT NULL,
	`result` text NOT NULL,
	CONSTRAINT `workflow_activities_pk` PRIMARY KEY(`execution_id`, `name`, `attempt`),
	CONSTRAINT `fk_workflow_activities_execution_id_workflow_executions_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`execution_id`) ON DELETE CASCADE,
	CONSTRAINT "workflow_activities_attempt_check" CHECK("attempt" >= 0),
	CONSTRAINT "workflow_activities_result_check" CHECK(json_valid("result"))
);
--> statement-breakpoint
CREATE TABLE `workflow_clocks` (
	`execution_id` text NOT NULL,
	`name` text NOT NULL,
	`deferred_name` text NOT NULL,
	`due_at` integer NOT NULL,
	CONSTRAINT `workflow_clocks_pk` PRIMARY KEY(`execution_id`, `name`),
	CONSTRAINT `fk_workflow_clocks_execution_id_workflow_executions_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`execution_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workflow_deferreds` (
	`execution_id` text NOT NULL,
	`name` text NOT NULL,
	`result` text NOT NULL,
	CONSTRAINT `workflow_deferreds_pk` PRIMARY KEY(`execution_id`, `name`),
	CONSTRAINT `fk_workflow_deferreds_execution_id_workflow_executions_execution_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `workflow_executions`(`execution_id`) ON DELETE CASCADE,
	CONSTRAINT "workflow_deferreds_result_check" CHECK(json_valid("result"))
);
--> statement-breakpoint
CREATE TABLE `workflow_executions` (
	`execution_id` text PRIMARY KEY,
	`workflow_tag` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`parent_execution_id` text,
	`result` text,
	`owner_token` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "workflow_executions_version_check" CHECK("version" > 0),
	CONSTRAINT "workflow_executions_payload_check" CHECK(json_valid("payload")),
	CONSTRAINT "workflow_executions_result_check" CHECK("result" IS NULL OR json_valid("result")),
	CONSTRAINT "workflow_executions_status_check" CHECK("status" IN ('running', 'suspended', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `workflow_events` (
	`event_id` text PRIMARY KEY,
	`type` text NOT NULL,
	`causation_id` text,
	`correlation_id` text NOT NULL,
	`input_version` integer NOT NULL,
	`depth` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "workflow_events_payload_json" CHECK(json_valid("payload")),
	CONSTRAINT "workflow_events_version_positive" CHECK("input_version" > 0),
	CONSTRAINT "workflow_events_depth_nonnegative" CHECK("depth" >= 0)
);
--> statement-breakpoint
CREATE TABLE `workflow_receipts` (
	`event_id` text NOT NULL,
	`subscription` text NOT NULL,
	`workflow_version` integer NOT NULL,
	`input_version` integer NOT NULL,
	`execution_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_workflow_receipts_event_id_workflow_events_event_id_fk` FOREIGN KEY (`event_id`) REFERENCES `workflow_events`(`event_id`),
	CONSTRAINT "workflow_receipts_versions_positive" CHECK("workflow_version" > 0 AND "input_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `workflow_clocks_due_idx` ON `workflow_clocks` (`due_at`);--> statement-breakpoint
CREATE INDEX `workflow_executions_parent_idx` ON `workflow_executions` (`parent_execution_id`);--> statement-breakpoint
CREATE INDEX `workflow_events_order_idx` ON `workflow_events` (`created_at`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_receipts_identity_idx` ON `workflow_receipts` (`event_id`,`subscription`,`workflow_version`,`input_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_receipts_execution_idx` ON `workflow_receipts` (`execution_id`);