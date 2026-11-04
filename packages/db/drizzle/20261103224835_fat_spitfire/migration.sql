PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_sources` (
	`session_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `session_sources_pk` PRIMARY KEY(`session_id`, `source_id`),
	CONSTRAINT `fk_session_sources_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_sources_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_sources_position_check" CHECK("position">=0)
);
--> statement-breakpoint
INSERT INTO `__new_session_sources`(`session_id`, `source_id`, `position`) SELECT `session_id`, `source_id`, `position` FROM `session_sources`;--> statement-breakpoint
DROP TABLE `session_sources`;--> statement-breakpoint
ALTER TABLE `__new_session_sources` RENAME TO `session_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `session_sources_position` ON `session_sources` (`session_id`,`position`);