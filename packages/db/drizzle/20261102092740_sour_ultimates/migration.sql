DROP TRIGGER message_fts_ad;
--> statement-breakpoint
DROP TRIGGER message_fts_ai;
--> statement-breakpoint
DROP TRIGGER message_fts_finish;
--> statement-breakpoint
DROP TRIGGER conversation_recording_posts_validate_insert;
--> statement-breakpoint
DROP TRIGGER material_deletion_reply_publication;
--> statement-breakpoint
DROP TRIGGER history_reply_publication;
--> statement-breakpoint
DROP TRIGGER conversation_history_intents_update;
--> statement-breakpoint
DROP TRIGGER conversation_history_intents_delete;
--> statement-breakpoint
DROP TRIGGER conversation_history_intents_valid;
--> statement-breakpoint
DROP TRIGGER session_history_intent_insert;
--> statement-breakpoint
CREATE TABLE ask_message_sequence (seq INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO ask_message_sequence SELECT seq FROM sqlite_sequence WHERE name='message_versions';
--> statement-breakpoint
ALTER TABLE `message_versions` ADD `generation_request_id` text;--> statement-breakpoint
ALTER TABLE `conversation_history_intents` ADD `deletion_request_id` text REFERENCES material_deletion_requests(request_id);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_conversation_history_intents` (
	`session_id` integer NOT NULL,
	`intent_key` text NOT NULL,
	`request_id` text UNIQUE,
	`deletion_request_id` text UNIQUE,
	CONSTRAINT `conversation_history_intents_pk` PRIMARY KEY(`session_id`, `intent_key`),
	CONSTRAINT `fk_conversation_history_intents_request_id_material_history_requests_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_history_requests`(`request_id`),
	CONSTRAINT `fk_conversation_history_intents_deletion_request_id_material_deletion_requests_request_id_fk` FOREIGN KEY (`deletion_request_id`) REFERENCES `material_deletion_requests`(`request_id`),
	CONSTRAINT "conversation_intent_retirement_owner" CHECK(("request_id" IS NOT NULL) != ("deletion_request_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_conversation_history_intents`(`session_id`, `intent_key`, `request_id`) SELECT `session_id`, `intent_key`, `request_id` FROM `conversation_history_intents`;--> statement-breakpoint
DROP TABLE `conversation_history_intents`;--> statement-breakpoint
ALTER TABLE `__new_conversation_history_intents` RENAME TO `conversation_history_intents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`message_id` integer NOT NULL,
	`number` integer NOT NULL,
	`origin` text NOT NULL,
	`instruction` text,
	`generation_request_id` text UNIQUE,
	`status` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`based_on` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_message_versions_message_id_messages_id_fk` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_message_versions_origin_codes_version_origin_code_fk` FOREIGN KEY (`origin`) REFERENCES `codes_version_origin`(`code`),
	CONSTRAINT `fk_message_versions_status_codes_message_status_code_fk` FOREIGN KEY (`status`) REFERENCES `codes_message_status`(`code`),
	CONSTRAINT `fk_message_versions_based_on_message_versions_id_fk` FOREIGN KEY (`based_on`) REFERENCES `message_versions`(`id`) ON DELETE SET NULL,
	CONSTRAINT "message_versions_check_1" CHECK(number >= 1),
	CONSTRAINT "message_versions_check_2" CHECK((origin = 'instruction') = (instruction IS NOT NULL)),
	CONSTRAINT "message_versions_check_3" CHECK(status = 'complete' OR text = ''),
	CONSTRAINT "message_versions_instruction_check" CHECK(instruction IS NULL OR (
        length(trim(instruction, char(9, 10, 11, 12, 13, 32, 160, 5760,
          8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202,
          8232, 8233, 8239, 8287, 12288, 65279))) > 0
        AND length(instruction) <= 100000
      ))
);
--> statement-breakpoint
INSERT INTO `__new_message_versions`(`id`, `message_id`, `number`, `origin`, `instruction`, `status`, `text`, `based_on`, `created_at`) SELECT `id`, `message_id`, `number`, `origin`, `instruction`, `status`, `text`, `based_on`, `created_at` FROM `message_versions`;--> statement-breakpoint
DROP TABLE `message_versions`;--> statement-breakpoint
ALTER TABLE `__new_message_versions` RENAME TO `message_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `message_versions_unfinished_idx` ON `message_versions` (`message_id`) WHERE status != 'complete';--> statement-breakpoint
CREATE INDEX `message_versions_based_on_idx` ON `message_versions` (`based_on`) WHERE based_on IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `message_versions_message_id_number_unique` ON `message_versions` (`message_id`,`number`);