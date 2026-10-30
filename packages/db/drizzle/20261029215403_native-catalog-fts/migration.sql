DELETE FROM catalog_fts WHERE kind IN ('material','question');
--> statement-breakpoint
INSERT INTO catalog_fts SELECT m.title,'material',m.id,m.project_id FROM materials m WHERE m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
--> statement-breakpoint
INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,m.project_id FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_update AFTER UPDATE OF title,archived_at,project_id ON materials BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,m.project_id FROM materials m WHERE m.id=new.id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,m.project_id FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_insert AFTER INSERT ON material_versions BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,m.project_id FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,m.project_id FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_update AFTER UPDATE OF status,number ON material_versions BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=new.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=new.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,m.project_id FROM materials m WHERE m.id=new.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,m.project_id FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=new.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_version_delete AFTER DELETE ON material_versions BEGIN
 DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.material_id;
 DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.material_id);
 INSERT INTO catalog_fts SELECT m.title,'material',m.id,m.project_id FROM materials m WHERE m.id=old.material_id AND m.archived_at IS NULL AND EXISTS (SELECT 1 FROM material_versions v WHERE v.material_id=m.id AND v.status='published');
 INSERT INTO catalog_fts SELECT q.prompt,'question',q.id,m.project_id FROM materials m JOIN material_versions v ON v.material_id=m.id JOIN material_quiz_questions q ON q.version_id=v.id WHERE m.id=old.material_id AND m.archived_at IS NULL AND v.status='published' AND v.number=(SELECT max(h.number) FROM material_versions h WHERE h.material_id=m.id AND h.status='published');
END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_question_delete BEFORE DELETE ON material_quiz_questions BEGIN DELETE FROM catalog_fts WHERE kind='question' AND target_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER catalog_native_material_delete BEFORE DELETE ON materials BEGIN DELETE FROM catalog_fts WHERE kind='material' AND target_id=old.id; DELETE FROM catalog_fts WHERE kind='question' AND target_id IN (SELECT q.id FROM material_quiz_questions q JOIN material_versions v ON v.id=q.version_id WHERE v.material_id=old.id); END;
