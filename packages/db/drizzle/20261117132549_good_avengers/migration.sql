CREATE TABLE `message_section_titles` (
	`version_id` integer PRIMARY KEY,
	`title` text NOT NULL,
	CONSTRAINT `fk_message_section_titles_version_id_message_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `message_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "message_section_titles_title_check" CHECK(length(trim("title")) > 0 AND length("title") <= 80)
);
