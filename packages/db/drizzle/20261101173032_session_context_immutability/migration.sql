-- Logical contexts are captured once. Session deletion may remove their copied content.
CREATE TRIGGER session_run_contexts_immutable
BEFORE UPDATE ON session_run_contexts
BEGIN
  SELECT RAISE(ABORT, 'captured session context is immutable');
END;
