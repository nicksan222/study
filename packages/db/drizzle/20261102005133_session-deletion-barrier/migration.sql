CREATE TABLE `session_deletion_correlations` (
	`correlation_id` text PRIMARY KEY,
	`session_id` integer NOT NULL,
	CONSTRAINT `fk_session_deletion_correlations_session_id_session_deletions_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session_deletions`(`session_id`)
);
--> statement-breakpoint
CREATE TABLE `session_deletions` (
	`session_id` integer PRIMARY KEY,
	`operation_id` text NOT NULL UNIQUE,
	`status` text NOT NULL,
	`error_kind` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "session_deletion_state_check" CHECK("attempt" >= 1 AND "status" IN ('pending','failed','completed') AND (("status" = 'completed') = ("completed_at" IS NOT NULL)) AND (("status" = 'failed') = ("error_kind" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE `workflow_retired_correlations` (
	`correlation_id` text NOT NULL,
	`event_type` text NOT NULL,
	CONSTRAINT `workflow_retired_correlations_pk` PRIMARY KEY(`correlation_id`, `event_type`)
);
--> statement-breakpoint
CREATE TABLE `workflow_retired_executions` (
	`execution_id` text PRIMARY KEY,
	`correlation_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `retired_document_proposal_receipts` (
	`key` text PRIMARY KEY,
	`intent` text NOT NULL,
	`current_version_id` integer NOT NULL,
	`proposed_version_id` integer NOT NULL,
	`request_id` text NOT NULL,
	`operation` text NOT NULL,
	`outcome` text NOT NULL,
	`base_version_id` integer NOT NULL,
	`result_version_id` integer NOT NULL,
	CONSTRAINT `fk_retired_document_proposal_receipts_result_version_id_material_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `material_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_generation_retirements` (
	`request_id` text PRIMARY KEY,
	`session_id` integer NOT NULL,
	CONSTRAINT `fk_session_generation_retirements_request_id_material_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_generation_requests`(`id`)
);
