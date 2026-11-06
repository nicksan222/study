CREATE TABLE `semantic_search_entries` (
	`key` text PRIMARY KEY,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`fingerprint` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`embedding` blob NOT NULL,
	CONSTRAINT "semantic_search_target_json" CHECK(json_valid("target")),
	CONSTRAINT "semantic_search_vector_size" CHECK("dimensions">0 AND length("embedding")="dimensions"*4)
);
--> statement-breakpoint
CREATE INDEX `semantic_search_model_idx` ON `semantic_search_entries` (`model`,`kind`);