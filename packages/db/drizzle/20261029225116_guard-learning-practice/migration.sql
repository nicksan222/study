CREATE TRIGGER learning_practice_control_identity
BEFORE UPDATE ON learning_practice_controls
WHEN NEW.project_id IS NOT OLD.project_id
  OR (OLD.enabled = 1 AND NEW.epoch IS NOT OLD.epoch)
  OR (OLD.enabled = 0 AND NEW.enabled = 1 AND NEW.epoch = OLD.epoch)
BEGIN SELECT RAISE(ABORT, 'practice control requires a fresh epoch'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_control_retained
BEFORE DELETE ON learning_practice_controls
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'practice control is retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_capture
BEFORE INSERT ON learning_practice_slots
WHEN NEW.status != 'pending' OR NEW.version_id IS NOT NULL OR NEW.attempt_id IS NOT NULL
  OR NEW.kind IS NOT CASE WHEN NEW.ordinal % 3 = 2 THEN 'open' ELSE 'choice' END
  OR NOT EXISTS (SELECT 1 FROM learning_practice_controls c WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1)
  OR (SELECT COUNT(*) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch AND p.status IN ('pending','ready')) >= 2
  OR NEW.ordinal != (SELECT COALESCE(MAX(p.ordinal) + 1, 0) FROM learning_practice_slots p WHERE p.project_id = NEW.project_id AND p.epoch = NEW.epoch)
  OR json_type(NEW.input_version_ids) IS NOT 'array' OR json_array_length(NEW.input_version_ids) NOT BETWEEN 1 AND 20
  OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.input_version_ids)) != json_array_length(NEW.input_version_ids)
  OR EXISTS (SELECT 1 FROM json_each(NEW.input_version_ids) j WHERE j.type != 'text' OR NOT EXISTS (
    SELECT 1 FROM material_versions v JOIN materials m ON m.id = v.material_id JOIN material_document_versions d ON d.version_id = v.id
    WHERE CAST(v.id AS TEXT) = j.value AND v.project_id = NEW.project_id AND v.kind = 'document' AND v.status = 'published' AND m.archived_at IS NULL
  ))
BEGIN SELECT RAISE(ABORT, 'invalid or unbounded practice slot capture'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_immutable
BEFORE UPDATE ON learning_practice_slots
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.epoch IS NOT OLD.epoch
  OR NEW.ordinal IS NOT OLD.ordinal OR NEW.kind IS NOT OLD.kind OR NEW.input_version_ids IS NOT OLD.input_version_ids
  OR (OLD.version_id IS NOT NULL AND (NEW.version_id IS NOT OLD.version_id OR NEW.attempt_id IS NOT OLD.attempt_id))
  OR (OLD.status IN ('answered','cancelled') AND NEW.status IS NOT OLD.status)
  OR (OLD.status = 'ready' AND NEW.status NOT IN ('ready','answered','cancelled'))
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending','ready','cancelled'))
BEGIN SELECT RAISE(ABORT, 'practice slot intent and receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_publication
BEFORE UPDATE OF version_id,attempt_id,status ON learning_practice_slots
WHEN OLD.version_id IS NULL AND NEW.version_id IS NOT NULL AND (
  NEW.status != 'ready' OR NOT EXISTS (
    SELECT 1 FROM learning_practice_controls c JOIN material_generation_scopes g ON g.id = c.epoch AND g.project_id = c.project_id
    JOIN material_versions v ON v.id = NEW.version_id AND v.project_id = c.project_id
    JOIN material_generation_requests r ON r.id = NEW.id AND r.project_id = c.project_id AND r.result_version_id = v.id
    JOIN material_quiz_attempts a ON a.id = NEW.attempt_id AND a.version_id = v.id
    WHERE c.project_id = NEW.project_id AND c.epoch = NEW.epoch AND c.enabled = 1 AND g.enabled = 1
      AND v.status = 'published' AND v.kind = 'quiz' AND v.generation_request_id = NEW.id
      AND json_extract(r.payload, '$.scopeId') = NEW.epoch
      AND json_extract(r.payload, '$.questionSpec.count') = 1 AND json_extract(r.payload, '$.questionSpec.kind') = NEW.kind
      AND json_extract(r.payload, '$.inputVersionIds') = json(NEW.input_version_ids)
      AND (SELECT COUNT(*) FROM material_quiz_questions q WHERE q.version_id = v.id) = 1
      AND NOT EXISTS (SELECT 1 FROM material_quiz_questions q WHERE q.version_id = v.id AND ((NEW.kind = 'open' AND q.kind != 'open') OR (NEW.kind = 'choice' AND q.kind NOT IN ('single_choice','multiple_choice'))))
  )
)
BEGIN SELECT RAISE(ABORT, 'practice publication does not match its slot'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_answer
BEFORE UPDATE OF status ON learning_practice_slots
WHEN NEW.status = 'answered' AND OLD.status != 'answered' AND NOT EXISTS (
  SELECT 1 FROM material_quiz_responses r WHERE r.attempt_id = NEW.attempt_id AND r.version_id = NEW.version_id
)
BEGIN SELECT RAISE(ABORT, 'practice answer requires a canonical response'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_slot_retained
BEFORE DELETE ON learning_practice_slots
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'practice slot is retained'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_answer_immutable
BEFORE UPDATE OF answer ON material_quiz_responses
WHEN NEW.answer IS NOT OLD.answer AND EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_insert
BEFORE INSERT ON material_quiz_selections
WHEN EXISTS (SELECT 1 FROM learning_practice_slots p WHERE p.attempt_id = NEW.attempt_id AND p.status = 'answered')
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_update
BEFORE UPDATE ON material_quiz_selections
WHEN EXISTS (SELECT 1 FROM learning_practice_slots p WHERE p.attempt_id IN (OLD.attempt_id, NEW.attempt_id) AND p.status = 'answered')
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER learning_practice_selection_delete
BEFORE DELETE ON material_quiz_selections
WHEN EXISTS (
  SELECT 1 FROM learning_practice_slots p JOIN projects owner ON owner.id = p.project_id
  WHERE p.attempt_id = OLD.attempt_id AND p.status = 'answered'
)
BEGIN SELECT RAISE(ABORT, 'committed practice answers are immutable'); END;
