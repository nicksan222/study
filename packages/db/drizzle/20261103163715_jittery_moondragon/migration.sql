CREATE TABLE `session_sidebar_preferences` (
	`session_id` integer PRIMARY KEY,
	`settled` integer NOT NULL,
	CONSTRAINT `fk_session_sidebar_preferences_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_sidebar_preferences_settled_check" CHECK("settled" IN (0, 1))
);
