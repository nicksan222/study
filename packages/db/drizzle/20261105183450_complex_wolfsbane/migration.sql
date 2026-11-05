CREATE TABLE `conversation_question_answers` (
	`version_id` integer PRIMARY KEY,
	`request_id` text NOT NULL UNIQUE,
	`question_guard` integer DEFAULT true NOT NULL,
	`answer_version_id` integer NOT NULL,
	`answer_message_id` integer NOT NULL,
	CONSTRAINT `fk_conversation_question_answers_version_id_message_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `message_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_conversation_question_answers_answer_version_id_message_versions_id_fk` FOREIGN KEY (`answer_version_id`) REFERENCES `message_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_conversation_question_answers_answer_message_id_messages_id_fk` FOREIGN KEY (`answer_message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `question_kind` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `question_origin` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `question_version_id` integer;