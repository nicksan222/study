CREATE TABLE `session_merges` (
	`intent_key` text PRIMARY KEY,
	`session_ids` text NOT NULL,
	`session_id` integer NOT NULL,
	CONSTRAINT `fk_session_merges_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_merges_ids_json" CHECK(json_valid("session_ids"))
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `archived_at` integer;