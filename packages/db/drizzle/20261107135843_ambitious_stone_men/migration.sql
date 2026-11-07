CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY,
	`runId` text NOT NULL,
	`agent` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`timestamp` integer NOT NULL,
	`input` integer NOT NULL,
	`cacheRead` integer NOT NULL,
	`cacheWrite` integer NOT NULL,
	`output` integer NOT NULL,
	`reasoning` integer NOT NULL,
	`incomplete` integer NOT NULL,
	CONSTRAINT "ai_usage_counts" CHECK("input" >= 0 AND "cacheRead" >= 0 AND "cacheWrite" >= 0 AND "output" >= 0 AND "reasoning" >= 0 AND "cacheRead" + "cacheWrite" <= "input" AND "reasoning" <= "output")
);
--> statement-breakpoint
CREATE INDEX `ai_usage_timestamp` ON `ai_usage` (`timestamp`);