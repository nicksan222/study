CREATE TABLE `session_retired_intents` (
	`session_id` integer NOT NULL,
	`intent_key` text NOT NULL,
	`request_id` text NOT NULL UNIQUE,
	`reason` text NOT NULL,
	CONSTRAINT `session_retired_intents_pk` PRIMARY KEY(`session_id`, `intent_key`)
);

--> statement-breakpoint
INSERT OR IGNORE INTO session_retired_intents(session_id,intent_key,request_id,reason)
SELECT session_id,intent_key,coalesce(request_id,deletion_request_id),'input_retired' FROM conversation_history_intents;
--> statement-breakpoint
CREATE TRIGGER session_retired_intents_owner BEFORE INSERT ON session_retired_intents
WHEN NOT EXISTS(SELECT 1 FROM session_run_contexts c WHERE c.request_id=NEW.request_id AND c.session_id=NEW.session_id AND c.intent_key=NEW.intent_key)
BEGIN SELECT RAISE(ABORT,'retired intent requires its exact captured identity'); END;
--> statement-breakpoint
CREATE TRIGGER session_retired_intents_update BEFORE UPDATE ON session_retired_intents BEGIN SELECT RAISE(ABORT,'retired intent identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER session_retired_intents_delete BEFORE DELETE ON session_retired_intents BEGIN SELECT RAISE(ABORT,'retired intent identity is retained'); END;
--> statement-breakpoint
CREATE TRIGGER session_retired_intent_recapture BEFORE INSERT ON session_run_contexts
WHEN EXISTS(SELECT 1 FROM session_retired_intents r WHERE r.session_id=NEW.session_id AND r.intent_key=NEW.intent_key)
BEGIN SELECT RAISE(ABORT,'retired intent cannot capture newer content'); END;
