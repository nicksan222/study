CREATE TABLE `assistant_tool_receipts` (
	`version_id` integer NOT NULL,
	`name` text NOT NULL,
	`ordinal` integer NOT NULL,
	`input` text NOT NULL,
	`result` text,
	CONSTRAINT `assistant_tool_receipts_pk` PRIMARY KEY(`version_id`, `name`, `ordinal`),
	CONSTRAINT `fk_assistant_tool_receipts_version_id_message_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `message_versions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "assistant_tool_input_json" CHECK(json_valid("input")),
	CONSTRAINT "assistant_tool_result_json" CHECK("result" IS NULL OR json_valid("result"))
);
