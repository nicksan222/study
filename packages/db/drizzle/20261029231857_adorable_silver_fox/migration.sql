ALTER TABLE `learning_practice_slots` ADD `generation_attempt` integer DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `learning_practice_slots` ADD `failure_kind` text;