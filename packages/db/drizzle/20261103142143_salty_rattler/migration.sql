ALTER TABLE `messages` ADD `capture_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_session_capture_key_unique` ON `messages` (`session_id`,`capture_key`);