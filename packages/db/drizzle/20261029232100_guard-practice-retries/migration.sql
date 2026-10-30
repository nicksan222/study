CREATE TRIGGER learning_practice_retry_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.generation_attempt != 0 OR NEW.failure_kind IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'practice slots start with an unfailed first generation'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_retry_transition
BEFORE UPDATE OF generation_attempt ON learning_practice_slots
WHEN NEW.generation_attempt IS NOT OLD.generation_attempt AND (
  OLD.status != 'pending' OR NEW.status != 'pending'
  OR OLD.failure_kind IS NULL OR NEW.failure_kind IS NOT NULL
  OR typeof(NEW.generation_attempt) != 'integer'
  OR NEW.generation_attempt != OLD.generation_attempt + 1
  OR NEW.generation_attempt > 9007199254740991
)
BEGIN SELECT RAISE(ABORT, 'practice retry must advance a failed generation exactly once'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_failure_clear
BEFORE UPDATE OF failure_kind ON learning_practice_slots
WHEN OLD.failure_kind IS NOT NULL AND NEW.failure_kind IS NULL
  AND NEW.generation_attempt = OLD.generation_attempt
  AND NEW.status = 'pending'
BEGIN SELECT RAISE(ABORT, 'practice failures require an explicit retry'); END;
