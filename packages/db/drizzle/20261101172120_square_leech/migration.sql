CREATE TABLE `session_run_contexts` (
	`request_id` text PRIMARY KEY,
	`session_id` integer NOT NULL,
	`intent_key` text NOT NULL,
	`intent` text NOT NULL,
	`snapshot` text NOT NULL,
	CONSTRAINT `fk_session_run_contexts_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_run_contexts_json" CHECK(json_valid("snapshot") AND json_valid("intent"))
);
--> statement-breakpoint
ALTER TABLE `citations` ADD `material_version_id` integer REFERENCES material_versions(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `citations` ADD `document_id` integer REFERENCES documents(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `citations` ADD `block_id` text;--> statement-breakpoint
ALTER TABLE `citations` ADD `range_start` integer;--> statement-breakpoint
ALTER TABLE `citations` ADD `range_end` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `selection_revision` integer DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `selection` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `session_run_contexts_intent_unique` ON `session_run_contexts` (`session_id`,`intent_key`);