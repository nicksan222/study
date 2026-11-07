DROP INDEX IF EXISTS `message_versions_unfinished_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `message_versions_active_idx` ON `message_versions` (`message_id`) WHERE status IN ('pending', 'writing');
--> statement-breakpoint
INSERT INTO codes_message_status (code) VALUES ('failed');
