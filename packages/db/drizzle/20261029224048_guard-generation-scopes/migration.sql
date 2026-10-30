CREATE TRIGGER material_generation_scope_immutable
BEFORE UPDATE ON material_generation_scopes
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.created_at IS NOT OLD.created_at OR (OLD.enabled = 0 AND NEW.enabled != 0)
BEGIN SELECT RAISE(ABORT, 'generation scope identity and closure are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_scope_retained
BEFORE DELETE ON material_generation_scopes
WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
BEGIN SELECT RAISE(ABORT, 'generation scope cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_request_scope
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM material_generation_scopes s
  WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for this project'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_receipt_scope
BEFORE UPDATE OF result_version_id ON material_generation_requests
WHEN OLD.result_version_id IS NULL AND NEW.result_version_id IS NOT NULL
  AND json_extract(NEW.payload, '$.scopeId') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM material_generation_scopes s
    WHERE s.id = json_extract(NEW.payload, '$.scopeId') AND s.project_id = NEW.project_id AND s.enabled = 1
  )
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_publication_scope
BEFORE UPDATE OF status ON material_versions
WHEN NEW.status = 'published' AND OLD.status != 'published' AND EXISTS (
  SELECT 1 FROM material_generation_requests r
  WHERE r.id = NEW.generation_request_id AND json_extract(r.payload, '$.scopeId') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM material_generation_scopes s
      WHERE s.id = json_extract(r.payload, '$.scopeId') AND s.project_id = r.project_id AND s.enabled = 1)
)
BEGIN SELECT RAISE(ABORT, 'generation scope is not active for publication'); END;
--> statement-breakpoint
CREATE TRIGGER material_generation_question_specification
BEFORE INSERT ON material_generation_requests
WHEN json_extract(NEW.payload, '$.questionSpec') IS NOT NULL AND (
  json_type(NEW.payload, '$.questionSpec') IS NOT 'object'
  OR json_extract(NEW.payload, '$.kind') IS NOT 'quiz'
  OR json_extract(NEW.payload, '$.questionSpec.count') IS NOT 1
  OR json_extract(NEW.payload, '$.questionSpec.kind') IS NULL
  OR json_extract(NEW.payload, '$.questionSpec.kind') NOT IN ('choice', 'open')
)
BEGIN SELECT RAISE(ABORT, 'invalid generation question specification'); END;
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
