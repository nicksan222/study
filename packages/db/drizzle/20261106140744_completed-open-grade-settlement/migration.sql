DROP TRIGGER material_quiz_responses_completed_update;
--> statement-breakpoint
CREATE TRIGGER material_quiz_responses_completed_update BEFORE UPDATE ON material_quiz_responses
WHEN (EXISTS(SELECT 1 FROM material_quiz_attempts WHERE id=OLD.attempt_id AND status='completed')
 OR EXISTS(SELECT 1 FROM material_quiz_attempts WHERE id=NEW.attempt_id AND status='completed'))
 AND NOT (
   OLD.question_kind='open' AND OLD.score IS NULL AND NEW.score IS NOT NULL
   AND NEW.score BETWEEN 0 AND 1
   AND NEW.attempt_id IS OLD.attempt_id
   AND NEW.version_id IS OLD.version_id
   AND NEW.question_id IS OLD.question_id
   AND NEW.question_kind IS OLD.question_kind
   AND NEW.answer IS OLD.answer
 )
BEGIN SELECT RAISE(ABORT, 'completed quiz answers are immutable'); END;
