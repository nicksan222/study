CREATE TRIGGER message_parts_project_insert BEFORE INSERT ON message_parts
WHEN NEW.source_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM sources src JOIN messages m ON m.id = NEW.message_id
  JOIN sessions s ON s.id = m.session_id
  WHERE src.id = NEW.source_id AND src.project_id IS NOT s.project_id
)
BEGIN SELECT RAISE(ABORT, 'attachment source project mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER message_parts_project_update BEFORE UPDATE OF source_id, message_id ON message_parts
WHEN NEW.source_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM sources src JOIN messages m ON m.id = NEW.message_id
  JOIN sessions s ON s.id = m.session_id
  WHERE src.id = NEW.source_id AND src.project_id IS NOT s.project_id
)
BEGIN SELECT RAISE(ABORT, 'attachment source project mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER messages_attachment_project_update BEFORE UPDATE OF session_id ON messages
WHEN EXISTS (
  SELECT 1 FROM message_parts p JOIN sources src ON src.id = p.source_id
  JOIN sessions s ON s.id = NEW.session_id
  WHERE p.message_id = OLD.id AND src.project_id IS NOT s.project_id
)
BEGIN SELECT RAISE(ABORT, 'attachment source project mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER sessions_attachment_project_update BEFORE UPDATE OF project_id ON sessions
WHEN EXISTS (
  SELECT 1 FROM messages m JOIN message_parts p ON p.message_id = m.id
  JOIN sources src ON src.id = p.source_id
  WHERE m.session_id = OLD.id AND src.project_id IS NOT NEW.project_id
)
BEGIN SELECT RAISE(ABORT, 'attachment source project mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER sources_attachment_project_update BEFORE UPDATE OF project_id ON sources
WHEN EXISTS (
  SELECT 1 FROM message_parts p JOIN messages m ON m.id = p.message_id
  JOIN sessions s ON s.id = m.session_id
  WHERE p.source_id = OLD.id AND NEW.project_id IS NOT s.project_id
)
BEGIN SELECT RAISE(ABORT, 'attachment source project mismatch'); END;
