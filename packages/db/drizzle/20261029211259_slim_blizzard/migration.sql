CREATE TABLE `conversation_recording_posts` (
	`request_id` text PRIMARY KEY,
	`session_id` integer NOT NULL,
	`input_hash` text NOT NULL,
	`message_id` integer NOT NULL,
	CONSTRAINT `fk_conversation_recording_posts_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "conversation_recording_posts_request_check" CHECK(length(trim("request_id")) > 0),
	CONSTRAINT "conversation_recording_posts_hash_check" CHECK(length("input_hash") = 64 AND "input_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "conversation_recording_posts_message_check" CHECK("message_id" > 0)
);
--> statement-breakpoint
CREATE TABLE `source_recording_imports` (
	`request_id` text PRIMARY KEY,
	`project_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`input_hash` blob NOT NULL,
	`duration_ms` integer NOT NULL,
	CONSTRAINT `fk_source_recording_imports_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "source_recording_imports_request_check" CHECK(length(request_id) > 0),
	CONSTRAINT "source_recording_imports_hash_check" CHECK(length(input_hash) = 32),
	CONSTRAINT "source_recording_imports_duration_check" CHECK(duration_ms >= 0)
);
--> statement-breakpoint
CREATE TABLE `recording_posts` (
	`request_id` text PRIMARY KEY,
	`recording_id` integer NOT NULL,
	`session_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`wav` blob NOT NULL,
	`duration_ms` integer NOT NULL,
	`source_id` integer,
	`message_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_recording_posts_recording_id_recordings_id_fk` FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_recording_posts_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_recording_posts_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "recording_posts_request_check" CHECK(length(trim("request_id")) > 0),
	CONSTRAINT "recording_posts_name_check" CHECK(length(trim("name")) BETWEEN 1 AND 255),
	CONSTRAINT "recording_posts_wav_check" CHECK(length("wav") BETWEEN 46 AND 115200044),
	CONSTRAINT "recording_posts_duration_check" CHECK("duration_ms" BETWEEN 0 AND 3600000),
	CONSTRAINT "recording_posts_result_pair_check" CHECK(("source_id" IS NULL) = ("message_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_recording_posts_message_idx` ON `conversation_recording_posts` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recording_posts_recording_unique` ON `recording_posts` (`recording_id`);