CREATE TABLE `assistant_chat_starts` (
	`key` text PRIMARY KEY,
	`session_id` integer NOT NULL UNIQUE,
	CONSTRAINT `fk_assistant_chat_starts_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `assistant_memory` (
	`session_id` integer PRIMARY KEY,
	`through_message_id` integer NOT NULL,
	`summary` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT `fk_assistant_memory_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_assistant_memory_through_message_id_messages_id_fk` FOREIGN KEY (`through_message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT "assistant_memory_summary_check" CHECK(length("summary") BETWEEN 1 AND 16000)
);
--> statement-breakpoint
DROP INDEX IF EXISTS `sessions_assistant_unique`;