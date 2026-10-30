CREATE TABLE retirement_message_sequence (seq INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO retirement_message_sequence SELECT seq FROM sqlite_sequence WHERE name = 'message_versions';
--> statement-breakpoint
DELETE FROM catalog_fts WHERE kind IN ('material', 'question');

--> statement-breakpoint
DROP TRIGGER conversation_recording_posts_validate_insert;
