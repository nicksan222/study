CREATE TABLE `reactive_generation` (
	`singleton` integer PRIMARY KEY,
	`generation` text NOT NULL,
	CONSTRAINT "reactive_generation_singleton" CHECK("singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `reactive_revisions` (
	`scope` text PRIMARY KEY,
	`revision` integer NOT NULL,
	CONSTRAINT "reactive_revision_positive" CHECK("revision" > 0)
);
