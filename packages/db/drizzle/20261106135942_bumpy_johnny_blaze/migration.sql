CREATE TABLE `material_quiz_attempt_choices` (
	`attempt_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`choice_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `material_quiz_attempt_choices_pk` PRIMARY KEY(`attempt_id`, `choice_id`),
	CONSTRAINT `fk_material_quiz_attempt_choices_attempt_id_question_id_material_quiz_attempt_questions_attempt_id_question_id_fk` FOREIGN KEY (`attempt_id`,`question_id`) REFERENCES `material_quiz_attempt_questions`(`attempt_id`,`question_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT `fk_material_quiz_attempt_choices_choice_id_question_id_material_quiz_choices_id_question_id_fk` FOREIGN KEY (`choice_id`,`question_id`) REFERENCES `material_quiz_choices`(`id`,`question_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_attempt_choices_position_check" CHECK(typeof(position) = 'integer' AND position >= 0)
);
--> statement-breakpoint
CREATE TABLE `material_quiz_attempt_questions` (
	`attempt_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `material_quiz_attempt_questions_pk` PRIMARY KEY(`attempt_id`, `question_id`),
	CONSTRAINT `fk_material_quiz_attempt_questions_attempt_id_version_id_material_quiz_attempts_id_version_id_fk` FOREIGN KEY (`attempt_id`,`version_id`) REFERENCES `material_quiz_attempts`(`id`,`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT `fk_material_quiz_attempt_questions_question_id_version_id_material_quiz_questions_id_version_id_fk` FOREIGN KEY (`question_id`,`version_id`) REFERENCES `material_quiz_questions`(`id`,`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_attempt_questions_position_check" CHECK(typeof(position) = 'integer' AND position >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_attempt_choices_position` ON `material_quiz_attempt_choices` (`attempt_id`,`question_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_attempt_questions_position` ON `material_quiz_attempt_questions` (`attempt_id`,`position`);