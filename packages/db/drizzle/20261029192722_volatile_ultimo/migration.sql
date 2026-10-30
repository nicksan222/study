CREATE TABLE `conversation_reply_requests` (
	`request_id` text PRIMARY KEY,
	`session_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`snapshot` text NOT NULL,
	CONSTRAINT `fk_conversation_reply_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_conversation_reply_requests_version_id_message_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `message_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "conversation_reply_requests_snapshot_json" CHECK(json_valid("snapshot"))
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `context_revision` integer DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_reply_requests_version_idx` ON `conversation_reply_requests` (`version_id`);