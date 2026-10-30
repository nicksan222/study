ALTER TABLE `source_snapshots` ADD `kind` text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `source_snapshots` ADD `mime` text DEFAULT 'application/octet-stream' NOT NULL;