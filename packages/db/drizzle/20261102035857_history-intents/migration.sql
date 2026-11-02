CREATE TABLE `conversation_history_intents` (
	`session_id` integer NOT NULL,
	`intent_key` text NOT NULL,
	`request_id` text NOT NULL UNIQUE,
	CONSTRAINT `conversation_history_intents_pk` PRIMARY KEY(`session_id`, `intent_key`),
	CONSTRAINT `fk_conversation_history_intents_request_id_material_history_requests_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_history_requests`(`request_id`)
);
