-- Preserve publication, history, search and answer guards across the generated table rebuilds.
DROP TRIGGER "catalog_native_material_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_material_update";
--> statement-breakpoint
DROP TRIGGER "catalog_native_question_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_delete";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_insert";
--> statement-breakpoint
DROP TRIGGER "catalog_native_version_update";
--> statement-breakpoint
DROP TRIGGER "learning_practice_answer_immutable";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_answer";
--> statement-breakpoint
DROP TRIGGER "learning_practice_slot_publication";
--> statement-breakpoint
DROP TRIGGER "material_attempt_complete_answers";
--> statement-breakpoint
DROP TRIGGER "material_deletion_search";
--> statement-breakpoint
DROP TRIGGER "material_generation_question_publication";
--> statement-breakpoint
DROP TRIGGER "material_publish_quiz";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_choices_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_open_answers_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_delete_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_deletion_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_history_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_history_update";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_insert_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_questions_update_draft";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_delete";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_insert";
--> statement-breakpoint
DROP TRIGGER "material_quiz_responses_completed_update";
--> statement-breakpoint
DROP TRIGGER "material_selection_single_insert";
--> statement-breakpoint
DROP TRIGGER "material_selection_single_update";
--> statement-breakpointALTER TABLE `material_quiz_attempt_questions` ADD `matching_order` text;--> statement-breakpoint
ALTER TABLE `material_quiz_questions` ADD `matching_pairs` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_material_quiz_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`explanation` text NOT NULL,
	`matching_pairs` text,
	CONSTRAINT `fk_material_quiz_questions_version_id_material_quiz_versions_version_id_fk` FOREIGN KEY (`version_id`) REFERENCES `material_quiz_versions`(`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_questions_values" CHECK(typeof(position) = 'integer' AND typeof(position) = 'integer' AND position >= 0 AND kind IN ('single_choice','multiple_choice','true_false','open','fill_blank','matching') AND length(trim(prompt)) > 0 AND length(trim(explanation)) > 0 AND ((kind = 'matching' AND matching_pairs IS NOT NULL AND json_valid(matching_pairs) AND json_array_length(matching_pairs) BETWEEN 2 AND 8) OR (kind != 'matching' AND matching_pairs IS NULL)) AND (kind != 'fill_blank' OR (instr(prompt, '_____') = 0 AND length(prompt) - length(replace(prompt, '____', '')) = 4)))
);
--> statement-breakpoint
INSERT INTO `__new_material_quiz_questions`(`id`, `version_id`, `position`, `kind`, `prompt`, `explanation`) SELECT `id`, `version_id`, `position`, `kind`, `prompt`, `explanation` FROM `material_quiz_questions`;--> statement-breakpoint
DROP TABLE `material_quiz_questions`;--> statement-breakpoint
ALTER TABLE `__new_material_quiz_questions` RENAME TO `material_quiz_questions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_material_quiz_responses` (
	`attempt_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`question_kind` text NOT NULL,
	`answer` text,
	`score` real,
	`feedback` text,
	CONSTRAINT `material_quiz_responses_pk` PRIMARY KEY(`attempt_id`, `question_id`),
	CONSTRAINT `fk_material_quiz_responses_attempt_id_version_id_material_quiz_attempts_id_version_id_fk` FOREIGN KEY (`attempt_id`,`version_id`) REFERENCES `material_quiz_attempts`(`id`,`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT `fk_material_quiz_responses_question_id_version_id_material_quiz_questions_id_version_id_fk` FOREIGN KEY (`question_id`,`version_id`) REFERENCES `material_quiz_questions`(`id`,`version_id`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT `fk_material_quiz_responses_question_id_question_kind_material_quiz_questions_id_kind_fk` FOREIGN KEY (`question_id`,`question_kind`) REFERENCES `material_quiz_questions`(`id`,`kind`) ON UPDATE RESTRICT ON DELETE CASCADE,
	CONSTRAINT "material_quiz_responses_values" CHECK(question_kind IN ('single_choice','multiple_choice','true_false','open','fill_blank','matching') AND (score IS NULL OR score BETWEEN 0 AND 1) AND ((question_kind IN ('open','fill_blank') AND answer IS NOT NULL AND length(trim(answer)) > 0) OR (question_kind = 'matching' AND answer IS NOT NULL AND json_valid(answer) AND json_array_length(answer) BETWEEN 2 AND 8) OR (question_kind IN ('single_choice','multiple_choice','true_false') AND answer IS NULL)))
);
--> statement-breakpoint
INSERT INTO `__new_material_quiz_responses`(`attempt_id`, `version_id`, `question_id`, `question_kind`, `answer`, `score`, `feedback`) SELECT `attempt_id`, `version_id`, `question_id`, `question_kind`, `answer`, `score`, `feedback` FROM `material_quiz_responses`;--> statement-breakpoint
DROP TABLE `material_quiz_responses`;--> statement-breakpoint
ALTER TABLE `__new_material_quiz_responses` RENAME TO `material_quiz_responses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_questions_position` ON `material_quiz_questions` (`version_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_questions_version` ON `material_quiz_questions` (`id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_quiz_questions_kind` ON `material_quiz_questions` (`id`,`kind`);--> statement-breakpoint
CREATE INDEX `material_quiz_responses_question_version_fk` ON `material_quiz_responses` (`question_id`,`version_id`);--> statement-breakpoint
CREATE INDEX `material_quiz_responses_question_kind_fk` ON `material_quiz_responses` (`question_id`,`question_kind`);
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_delete BEFORE DELETE ON materials BEGIN DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.id; DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.id); END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_update AFTER UPDATE OF title,archived_at ON materials WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_question_delete BEFORE DELETE ON material_quiz_questions BEGIN DELETE FROM catalog_fts WHERE kind='question' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_delete AFTER DELETE ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=OLD.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=old.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=old.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_insert AFTER INSERT ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_update AFTER UPDATE OF status,number ON material_versions WHEN NOT EXISTS(SELECT 1 FROM material_deletion_members WHERE material_id=NEW.material_id)
BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,NULL FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,NULL FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_answer_immutable
BEFORE UPDATE OF answer ON material_quiz_responses
WHEN NEW.answer IS NOT OLD.answer AND EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_answer
BEFORE UPDATE OF status ON learning_practice_slots
WHEN NEW.status = 'answered' AND OLD.status != 'answered' AND NOT EXISTS (
  SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id = NEW.attempt_id AND r.version_id = NEW.version_id
)
BEGIN SELECT RAISE(ABORT, 'practice answer requires a canonical response'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_publication
BEFORE UPDATE OF version_id,attempt_id,status ON learning_practice_slots
WHEN OLD.version_id IS NULL AND NEW.version_id IS NOT NULL AND (
  NEW.status != 'ready' OR NOT EXISTS (
    SELECT 1 FROM learning_practice_controls c JOIN material_generation_scopes g ON g.id = c.epoch AND g.project_id = c.project_id
    JOIN material_versions v ON v.id = NEW.version_id AND EXISTS(SELECT 1 FROM project_materials pm WHERE pm.material_id=v.material_id AND pm.project_id=c.project_id)
    JOIN material_generation_requests r ON r.id = NEW.id AND r.project_id = c.project_id AND r.result_version_id = v.id
    JOIN material_quiz_attempts a ON a.id = NEW.attempt_id AND a.version_id = v.id
    WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1 AND g.enabled = 1
      AND v.status = 'published' AND v.kind = 'quiz' AND v.generation_request_id = NEW.id
      AND json_extract(r.payload, '$.scopeId') = NEW.epoch
      AND json_extract(r.payload, '$.questionSpec.count') = 1 AND json_extract(r.payload, '$.questionSpec.kind') = NEW.kind
      AND json_extract(r.payload, '$.inputs') = json(NEW.inputs)
      AND (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = v.id) = 1
      AND NOT EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = v.id AND ((NEW.kind = 'open' AND q.kind != 'open') OR (NEW.kind = 'choice' AND q.kind NOT IN ('single_choice','multiple_choice'))))
  )
)
BEGIN SELECT RAISE(ABORT, 'practice publication does not match its slot'); END;
--> statement-breakpoint
CREATE TRIGGER material_attempt_complete_answers BEFORE UPDATE OF status ON material_quiz_attempts
WHEN new.status='completed' AND EXISTS(SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id=new.id AND r.question_kind IN ('single_choice','multiple_choice','true_false') AND NOT EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=r.attempt_id AND s.question_id=r.question_id))
BEGIN SELECT RAISE(ABORT, 'choice responses require a selection before completion'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_search AFTER INSERT ON material_deletion_members BEGIN DELETE FROM catalog_fts WHERE (kind='material' AND target_id=NEW.material_id) OR (kind='question' AND target_id IN(SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=NEW.material_id)); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_question_publication
BEFORE UPDATE OF status ON material_versions
WHEN NEW.status = 'published' AND OLD.status != 'published' AND EXISTS (
  SELECT 1 FROM material_generation_requests r WHERE r.id = NEW.generation_request_id
    AND json_extract(r.payload, '$.questionSpec') IS NOT NULL AND (
      NEW.kind != 'quiz'
      OR (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = NEW.id) != 1
      OR EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = NEW.id AND (
        (json_extract(r.payload, '$.questionSpec.kind') = 'open' AND q.kind != 'open')
        OR (json_extract(r.payload, '$.questionSpec.kind') = 'choice' AND q.kind NOT IN ('single_choice', 'multiple_choice'))
      ))
    )
)
BEGIN SELECT RAISE(ABORT, 'generated quiz does not match its captured question specification'); END;
--> statement-breakpoint
CREATE TRIGGER material_publish_quiz BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='quiz' AND (
      NOT EXISTS(SELECT 1 FROM material_quiz_questions WHERE version_id=new.id)
      OR EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.version_id=new.id AND (
        (q.kind='true_false' AND ((SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id) != 2 OR NOT EXISTS(SELECT 1 FROM material_quiz_choices c WHERE c.question_id=q.id AND c.text='true') OR NOT EXISTS(SELECT 1 FROM material_quiz_choices c WHERE c.question_id=q.id AND c.text='false')))
        OR (q.kind IN ('open','fill_blank') AND NOT EXISTS(SELECT 1 FROM material_quiz_open_answers a WHERE a.question_id=q.id))
        OR (q.kind IN ('single_choice','multiple_choice','true_false') AND (
          (SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id) NOT BETWEEN 2 AND 100
          OR (q.kind IN ('single_choice','true_false') AND (SELECT count(*) FROM material_quiz_choices c WHERE c.question_id=q.id AND c.is_correct=1) != 1)
          OR (q.kind='multiple_choice' AND NOT EXISTS(SELECT 1 FROM material_quiz_choices c WHERE c.question_id=q.id AND c.is_correct=1))
        ))
      )))
BEGIN SELECT RAISE(ABORT, 'published quizzes require complete questions and correct answers'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_delete_draft BEFORE DELETE ON material_quiz_choices
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_insert_draft BEFORE INSERT ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_choices_update_draft BEFORE UPDATE ON material_quiz_choices
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_delete_draft BEFORE DELETE ON material_quiz_open_answers
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id)) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=(SELECT version_id FROM material_quiz_questions WHERE id=OLD.question_id) AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_insert_draft BEFORE INSERT ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_open_answers_update_draft BEFORE UPDATE ON material_quiz_open_answers
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=old.question_id) AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=(SELECT version_id FROM material_quiz_questions WHERE id=new.question_id) AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_delete_draft BEFORE DELETE ON material_quiz_questions
WHEN ((EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members h JOIN material_history_prunes p ON p.operation_id=h.operation_id WHERE h.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_deletion_insert BEFORE INSERT ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_versions v JOIN material_deletion_members d ON d.material_id=v.material_id WHERE v.id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'deleted Material cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_history_insert BEFORE INSERT ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_history_update BEFORE UPDATE ON material_quiz_questions WHEN EXISTS(SELECT 1 FROM material_history_members WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'pruned version cannot restore content'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_insert_draft BEFORE INSERT ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_questions_update_draft BEFORE UPDATE ON material_quiz_questions
WHEN EXISTS(SELECT 1 FROM material_versions v WHERE v.id=old.version_id AND v.status='published') OR EXISTS(SELECT 1 FROM material_versions v WHERE v.id=new.version_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published material content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_delete BEFORE DELETE ON material_quiz_responses
WHEN ((EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=old.attempt_id AND a.status='completed')) AND NOT (EXISTS(SELECT 1 FROM material_deletion_members dm JOIN material_deletions d ON d.material_id=dm.deletion_id WHERE dm.material_id=(SELECT material_id FROM material_versions WHERE id=OLD.version_id) AND d.status IN ('pending','failed')))) AND NOT (EXISTS(SELECT 1 FROM material_history_members m JOIN material_history_prunes p ON p.operation_id=m.operation_id WHERE m.version_id=OLD.version_id AND p.status IN ('pending','failed')))
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_insert BEFORE INSERT ON material_quiz_responses
WHEN EXISTS(SELECT 1 FROM material_quiz_attempts a JOIN material_versions v ON v.id=a.version_id WHERE a.id=new.attempt_id AND a.status='completed')
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_update BEFORE UPDATE ON material_quiz_responses
WHEN (EXISTS(SELECT 1 FROM material_quiz_attempts WHERE id=OLD.attempt_id AND status='completed')
 OR EXISTS(SELECT 1 FROM material_quiz_attempts WHERE id=NEW.attempt_id AND status='completed'))
 AND NOT (
   OLD.question_kind IN ('open','fill_blank') AND OLD.score IS NULL AND NEW.score IS NOT NULL
   AND NEW.score BETWEEN 0 AND 1
   AND NEW.attempt_id IS OLD.attempt_id
   AND NEW.version_id IS OLD.version_id
   AND NEW.question_id IS OLD.question_id
   AND NEW.question_kind IS OLD.question_kind
   AND NEW.answer IS OLD.answer
 )
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_selection_single_insert BEFORE INSERT ON material_quiz_selections
WHEN (SELECT question_kind FROM material_quiz_responses WHERE attempt_id=new.attempt_id AND question_id=new.question_id) IN ('single_choice','true_false')
          AND EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=new.attempt_id AND s.question_id=new.question_id )
BEGIN SELECT RAISE(ABORT, 'single choice answers may select exactly one choice'); END;
--> statement-breakpoint
CREATE TRIGGER material_selection_single_update BEFORE UPDATE ON material_quiz_selections
WHEN (SELECT question_kind FROM material_quiz_responses WHERE attempt_id=new.attempt_id AND question_id=new.question_id) IN ('single_choice','true_false')
          AND EXISTS(SELECT 1 FROM material_quiz_selections s WHERE s.attempt_id=new.attempt_id AND s.question_id=new.question_id AND (s.attempt_id != old.attempt_id OR s.question_id != old.question_id OR s.choice_id != old.choice_id))
BEGIN SELECT RAISE(ABORT, 'single choice answers may select exactly one choice'); END;

--> statement-breakpoint
CREATE TRIGGER material_matching_pairs_insert BEFORE INSERT ON material_quiz_questions
WHEN NEW.kind='matching' AND (
  json_type(NEW.matching_pairs) != 'array'
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_pairs) p WHERE
    coalesce(json_type(p.value,'$.termId'),'') != 'text' OR length(json_extract(p.value,'$.termId')) != 36
    OR coalesce(json_type(p.value,'$.definitionId'),'') != 'text' OR length(json_extract(p.value,'$.definitionId')) != 36
    OR coalesce(json_type(p.value,'$.term'),'') != 'text' OR length(trim(json_extract(p.value,'$.term'))) = 0
    OR coalesce(json_type(p.value,'$.definition'),'') != 'text' OR length(trim(json_extract(p.value,'$.definition'))) = 0)
  OR (SELECT count(DISTINCT json_extract(value,'$.termId')) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT json_extract(value,'$.definitionId')) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT lower(trim(json_extract(value,'$.term')))) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT lower(trim(json_extract(value,'$.definition')))) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_pairs) t JOIN json_each(NEW.matching_pairs) d ON json_extract(t.value,'$.termId')=json_extract(d.value,'$.definitionId'))
)
BEGIN SELECT RAISE(ABORT, 'matching pairs require distinct identities, terms and definitions'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_answer_insert BEFORE INSERT ON material_quiz_responses
WHEN NEW.question_kind='matching' AND (
  NOT EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.id=NEW.question_id AND q.kind='matching' AND json_array_length(q.matching_pairs)=json_array_length(NEW.answer))
  OR json_type(NEW.answer) != 'array'
  OR (SELECT count(DISTINCT json_extract(value,'$.termId')) FROM json_each(NEW.answer)) != json_array_length(NEW.answer)
  OR (SELECT count(DISTINCT json_extract(value,'$.definitionId')) FROM json_each(NEW.answer)) != json_array_length(NEW.answer)
  OR EXISTS(SELECT 1 FROM json_each(NEW.answer) a WHERE
    NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.termId')=json_extract(a.value,'$.termId'))
    OR NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.definitionId')=json_extract(a.value,'$.definitionId')))
)
BEGIN SELECT RAISE(ABORT, 'matching answers require a complete question-owned permutation'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_order_insert BEFORE INSERT ON material_quiz_attempt_questions
WHEN (SELECT kind FROM material_quiz_questions WHERE id=NEW.question_id)='matching' AND (
  NEW.matching_order IS NULL OR NOT json_valid(NEW.matching_order)
  OR json_type(NEW.matching_order) != 'array'
  OR json_array_length(NEW.matching_order) != (SELECT json_array_length(matching_pairs) FROM material_quiz_questions WHERE id=NEW.question_id)
  OR (SELECT count(DISTINCT value) FROM json_each(NEW.matching_order)) != json_array_length(NEW.matching_order)
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_order) o WHERE NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.definitionId')=o.value))
)
BEGIN SELECT RAISE(ABORT, 'matching attempt order must contain every definition exactly once'); END;

--> statement-breakpoint
CREATE TRIGGER material_matching_pairs_update BEFORE UPDATE ON material_quiz_questions
WHEN NEW.kind='matching' AND (
  json_type(NEW.matching_pairs) != 'array'
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_pairs) p WHERE
    coalesce(json_type(p.value,'$.termId'),'') != 'text' OR length(json_extract(p.value,'$.termId')) != 36
    OR coalesce(json_type(p.value,'$.definitionId'),'') != 'text' OR length(json_extract(p.value,'$.definitionId')) != 36
    OR coalesce(json_type(p.value,'$.term'),'') != 'text' OR length(trim(json_extract(p.value,'$.term'))) = 0
    OR coalesce(json_type(p.value,'$.definition'),'') != 'text' OR length(trim(json_extract(p.value,'$.definition'))) = 0)
  OR (SELECT count(DISTINCT json_extract(value,'$.termId')) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT json_extract(value,'$.definitionId')) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT lower(trim(json_extract(value,'$.term')))) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR (SELECT count(DISTINCT lower(trim(json_extract(value,'$.definition')))) FROM json_each(NEW.matching_pairs)) != json_array_length(NEW.matching_pairs)
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_pairs) t JOIN json_each(NEW.matching_pairs) d ON json_extract(t.value,'$.termId')=json_extract(d.value,'$.definitionId'))
)
BEGIN SELECT RAISE(ABORT, 'matching pairs require distinct identities, terms and definitions'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_answer_update BEFORE UPDATE ON material_quiz_responses
WHEN NEW.question_kind='matching' AND (
  NOT EXISTS(SELECT 1 FROM material_quiz_questions q WHERE q.id=NEW.question_id AND q.kind='matching' AND json_array_length(q.matching_pairs)=json_array_length(NEW.answer))
  OR json_type(NEW.answer) != 'array'
  OR (SELECT count(DISTINCT json_extract(value,'$.termId')) FROM json_each(NEW.answer)) != json_array_length(NEW.answer)
  OR (SELECT count(DISTINCT json_extract(value,'$.definitionId')) FROM json_each(NEW.answer)) != json_array_length(NEW.answer)
  OR EXISTS(SELECT 1 FROM json_each(NEW.answer) a WHERE
    NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.termId')=json_extract(a.value,'$.termId'))
    OR NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.definitionId')=json_extract(a.value,'$.definitionId')))
)
BEGIN SELECT RAISE(ABORT, 'matching answers require a complete question-owned permutation'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_order_update BEFORE UPDATE ON material_quiz_attempt_questions
WHEN (SELECT kind FROM material_quiz_questions WHERE id=NEW.question_id)='matching' AND (
  NEW.matching_order IS NULL OR NOT json_valid(NEW.matching_order)
  OR json_type(NEW.matching_order) != 'array'
  OR json_array_length(NEW.matching_order) != (SELECT json_array_length(matching_pairs) FROM material_quiz_questions WHERE id=NEW.question_id)
  OR (SELECT count(DISTINCT value) FROM json_each(NEW.matching_order)) != json_array_length(NEW.matching_order)
  OR EXISTS(SELECT 1 FROM json_each(NEW.matching_order) o WHERE NOT EXISTS(SELECT 1 FROM material_quiz_questions q, json_each(q.matching_pairs) p WHERE q.id=NEW.question_id AND json_extract(p.value,'$.definitionId')=o.value))
)
BEGIN SELECT RAISE(ABORT, 'matching attempt order must contain every definition exactly once'); END;
--> statement-breakpoint
CREATE TRIGGER material_matching_order_immutable BEFORE UPDATE OF matching_order ON material_quiz_attempt_questions
WHEN OLD.matching_order IS NOT NULL AND NEW.matching_order IS NOT OLD.matching_order
BEGIN SELECT RAISE(ABORT, 'matching attempt definition order is immutable'); END;
