INSERT INTO sqlite_sequence(name,seq) SELECT 'message_versions',coalesce(max(seq),0) FROM ask_message_sequence WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='message_versions') HAVING count(*) > 0;
--> statement-breakpoint
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT max(seq) FROM ask_message_sequence),0)) WHERE name='message_versions';
--> statement-breakpoint
DROP TABLE ask_message_sequence;
--> statement-breakpoint
CREATE TRIGGER message_fts_ad AFTER DELETE ON message_versions WHEN old.status = 'complete' BEGIN
    INSERT INTO message_fts (message_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER message_fts_ai AFTER INSERT ON message_versions WHEN new.status = 'complete' BEGIN
    INSERT INTO message_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER message_fts_finish AFTER UPDATE OF status ON message_versions
WHEN old.status != 'complete' AND new.status = 'complete' BEGIN
    INSERT INTO message_fts (rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER conversation_recording_posts_validate_insert BEFORE INSERT ON conversation_recording_posts
WHEN NOT EXISTS (
 SELECT 1 FROM messages m JOIN sessions s ON s.id=m.session_id
 JOIN message_versions v ON v.id=m.active_version_id AND v.message_id=m.id
 JOIN message_parts p ON p.message_id=m.id AND p.ordinal=0 JOIN sources src ON src.id=p.source_id
 WHERE m.id=NEW.message_id AND m.session_id=NEW.session_id AND m.role='user' AND m.recording_ms IS NOT NULL AND m.recorded_in=src.id AND v.origin='typed' AND v.status='complete' AND v.text='' AND src.origin='recording' AND src.kind='audio' AND src.mime LIKE 'audio/%'
)
BEGIN SELECT RAISE(ABORT,'invalid conversation recording post'); END;
--> statement-breakpoint
CREATE TRIGGER material_deletion_reply_publication BEFORE UPDATE OF status,text ON message_versions
WHEN EXISTS(SELECT 1 FROM conversation_reply_requests r JOIN material_deletion_requests d ON d.request_id=r.request_id WHERE r.version_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER history_reply_publication BEFORE UPDATE OF status,text ON message_versions WHEN EXISTS(SELECT 1 FROM conversation_reply_requests r JOIN material_history_requests h ON h.request_id=r.request_id WHERE r.version_id=NEW.id) BEGIN SELECT RAISE(ABORT,'retired reply cannot publish'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_history_intents_update BEFORE UPDATE ON conversation_history_intents BEGIN SELECT RAISE(ABORT,'retired capture intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_history_intents_delete BEFORE DELETE ON conversation_history_intents BEGIN SELECT RAISE(ABORT,'retired capture intent is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER conversation_history_intents_valid BEFORE INSERT ON conversation_history_intents
WHEN NOT EXISTS(SELECT 1 FROM session_run_contexts c WHERE c.session_id=NEW.session_id AND c.intent_key=NEW.intent_key AND (
 (c.request_id=NEW.request_id AND EXISTS(SELECT 1 FROM material_history_requests r WHERE r.request_id=c.request_id AND r.kind='context')) OR
 (c.request_id=NEW.deletion_request_id AND EXISTS(SELECT 1 FROM material_deletion_requests r WHERE r.request_id=c.request_id AND r.kind='context'))))
BEGIN SELECT RAISE(ABORT,'retired intent requires exact captured context'); END;
--> statement-breakpoint
CREATE TRIGGER session_history_intent_insert BEFORE INSERT ON session_run_contexts
WHEN EXISTS(SELECT 1 FROM conversation_history_intents WHERE session_id=NEW.session_id AND intent_key=NEW.intent_key)
BEGIN SELECT RAISE(ABORT,'pruned run intent cannot capture newer content'); END;
