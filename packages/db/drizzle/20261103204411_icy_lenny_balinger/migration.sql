CREATE TABLE `project_documents` (
	`project_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	CONSTRAINT `project_documents_pk` PRIMARY KEY(`project_id`, `document_id`),
	CONSTRAINT `fk_project_documents_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_documents_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `session_documents` (
	`session_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `session_documents_pk` PRIMARY KEY(`session_id`, `document_id`),
	CONSTRAINT `fk_session_documents_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_documents_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_documents_position_check" CHECK(typeof("position") = 'integer' AND "position" >= 0)
);
--> statement-breakpoint
CREATE TABLE `study_document_edit_receipts` (
	`document_id` integer NOT NULL,
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`intent` text NOT NULL,
	`expected_version_id` integer NOT NULL,
	`current_version_id` integer NOT NULL,
	`submitted_version_id` integer NOT NULL,
	`outcome` text NOT NULL,
	CONSTRAINT `study_document_edit_receipts_pk` PRIMARY KEY(`document_id`, `key`),
	CONSTRAINT `fk_study_document_edit_receipts_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`),
	CONSTRAINT `fk_study_document_edit_receipts_expected_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`expected_version_id`,`document_id`) REFERENCES `study_document_versions`(`id`,`document_id`),
	CONSTRAINT `fk_study_document_edit_receipts_current_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`current_version_id`,`document_id`) REFERENCES `study_document_versions`(`id`,`document_id`),
	CONSTRAINT `fk_study_document_edit_receipts_submitted_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`submitted_version_id`,`document_id`) REFERENCES `study_document_versions`(`id`,`document_id`),
	CONSTRAINT "study_document_edit_receipts_intent_check" CHECK(json_valid("intent") AND length("key") BETWEEN 1 AND 200),
	CONSTRAINT "study_document_edit_receipts_outcome_check" CHECK("operation" IN ('save','restore') AND "outcome" IN ('saved','conflict') AND ("outcome" != 'saved' OR "expected_version_id" = "current_version_id"))
);
--> statement-breakpoint
CREATE TABLE `study_document_version_parents` (
	`version_id` integer NOT NULL,
	`parent_version_id` integer NOT NULL,
	`document_id` integer NOT NULL,
	CONSTRAINT `study_document_version_parents_pk` PRIMARY KEY(`version_id`, `parent_version_id`),
	CONSTRAINT `fk_study_document_version_parents_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`version_id`,`document_id`) REFERENCES `study_document_versions`(`id`,`document_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_study_document_version_parents_parent_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`parent_version_id`,`document_id`) REFERENCES `study_document_versions`(`id`,`document_id`),
	CONSTRAINT "study_document_version_parents_distinct_check" CHECK("version_id" != "parent_version_id")
);
--> statement-breakpoint
CREATE TABLE `study_document_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`document_id` integer NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`operation` text DEFAULT 'original' NOT NULL,
	`creator` text DEFAULT 'user' NOT NULL,
	`content_snapshot_id` integer NOT NULL,
	`instruction` text,
	`language` text,
	`created_at` integer NOT NULL,
	`published_at` integer,
	CONSTRAINT `fk_study_document_versions_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`),
	CONSTRAINT `fk_study_document_versions_content_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`content_snapshot_id`) REFERENCES `content_snapshots`(`id`),
	CONSTRAINT "study_document_versions_identity_check" CHECK("id" > 0 AND typeof("number") = 'integer' AND "number" > 0),
	CONSTRAINT "study_document_versions_status_check" CHECK("status" IN ('draft','published') AND (("status" = 'published') = ("published_at" IS NOT NULL))),
	CONSTRAINT "study_document_versions_operation_check" CHECK("operation" IN ('original','edit','summarize','translate','generate','restore')),
	CONSTRAINT "study_document_versions_creator_check" CHECK("creator" IN ('user','agent')),
	CONSTRAINT "study_document_versions_language_check" CHECK("language" IS NULL OR length(trim("language")) BETWEEN 1 AND 64),
	CONSTRAINT "study_document_versions_instruction_check" CHECK("instruction" IS NULL OR length(trim("instruction")) BETWEEN 1 AND 100000),
	CONSTRAINT "study_document_versions_times_check" CHECK(typeof("created_at") = 'integer' AND "created_at" >= 0 AND ("published_at" IS NULL OR (typeof("published_at") = 'integer' AND "published_at" >= "created_at")))
);
--> statement-breakpoint
CREATE TABLE `study_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`title` text NOT NULL,
	`description` text,
	`create_key` text,
	`creation_intent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "study_documents_title_check" CHECK(length(trim("title")) BETWEEN 1 AND 200),
	CONSTRAINT "study_documents_description_check" CHECK("description" IS NULL OR length("description") <= 240),
	CONSTRAINT "study_documents_creation_check" CHECK(("create_key" IS NULL AND "creation_intent" IS NULL) OR (length("create_key") BETWEEN 1 AND 200 AND json_valid("creation_intent"))),
	CONSTRAINT "study_documents_times_check" CHECK("id" > 0 AND typeof("created_at") = 'integer' AND "created_at" >= 0 AND typeof("updated_at") = 'integer' AND "updated_at" >= "created_at" AND ("archived_at" IS NULL OR (typeof("archived_at") = 'integer' AND "archived_at" >= "created_at")))
);
--> statement-breakpoint
CREATE INDEX `project_documents_document_idx` ON `project_documents` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_documents_position_unique` ON `session_documents` (`session_id`,`position`);--> statement-breakpoint
CREATE INDEX `session_documents_document_idx` ON `session_documents` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_edit_receipts_submitted_unique` ON `study_document_edit_receipts` (`submitted_version_id`);--> statement-breakpoint
CREATE INDEX `study_document_version_parents_parent_idx` ON `study_document_version_parents` (`parent_version_id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_versions_number_unique` ON `study_document_versions` (`document_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_versions_owner_unique` ON `study_document_versions` (`id`,`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_versions_content_unique` ON `study_document_versions` (`content_snapshot_id`);--> statement-breakpoint
CREATE INDEX `study_document_versions_heads_idx` ON `study_document_versions` (`document_id`,`status`,"number" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `study_documents_create_key_unique` ON `study_documents` (`create_key`);
--> statement-breakpoint
CREATE TRIGGER study_document_versions_draft_insert BEFORE INSERT ON study_document_versions
WHEN NEW.status != 'draft' BEGIN SELECT RAISE(ABORT, 'document versions must begin as drafts'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_snapshot_owner BEFORE INSERT ON study_document_versions
WHEN NOT EXISTS (SELECT 1 FROM content_snapshots c WHERE c.id=NEW.content_snapshot_id AND c.source_id IS NULL)
 OR EXISTS (SELECT 1 FROM material_document_versions m WHERE m.document_id=NEW.content_snapshot_id)
BEGIN SELECT RAISE(ABORT, 'authored document snapshot ownership is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_sealed_update BEFORE UPDATE ON study_document_versions
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT, 'published document versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_sealed_delete BEFORE DELETE ON study_document_versions
WHEN OLD.status='published' BEGIN SELECT RAISE(ABORT, 'published document versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_publish BEFORE UPDATE OF status ON study_document_versions
WHEN NEW.status='published' AND (
 NOT EXISTS (SELECT 1 FROM blocks WHERE document_id=NEW.content_snapshot_id)
 OR NOT EXISTS (SELECT 1 FROM content_snapshots WHERE id=NEW.content_snapshot_id AND source_id IS NULL)
 OR EXISTS (SELECT 1 FROM material_document_versions WHERE document_id=NEW.content_snapshot_id)
 OR EXISTS (SELECT 1 FROM study_document_version_parents p JOIN study_document_versions v ON v.id=p.parent_version_id
  WHERE p.version_id=NEW.id AND (v.status!='published' OR v.number>=NEW.number OR v.document_id!=NEW.document_id))
) BEGIN SELECT RAISE(ABORT, 'document publication requires complete owned content and published ancestry'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_versions_draft_identity BEFORE UPDATE ON study_document_versions
WHEN NEW.id!=OLD.id OR NEW.document_id!=OLD.document_id OR NEW.number!=OLD.number
 OR NEW.content_snapshot_id!=OLD.content_snapshot_id OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT, 'document version identity is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_parents_insert BEFORE INSERT ON study_document_version_parents
WHEN NOT EXISTS (SELECT 1 FROM study_document_versions child JOIN study_document_versions parent
 ON parent.id=NEW.parent_version_id WHERE child.id=NEW.version_id AND child.status='draft'
 AND parent.status='published' AND child.document_id=NEW.document_id AND parent.document_id=NEW.document_id
 AND parent.number<child.number)
BEGIN SELECT RAISE(ABORT, 'document ancestry requires an earlier published version of the same document'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_parents_update BEFORE UPDATE ON study_document_version_parents
BEGIN SELECT RAISE(ABORT, 'document ancestry cannot be rewritten'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_parents_delete BEFORE DELETE ON study_document_version_parents
WHEN EXISTS (SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published')
BEGIN SELECT RAISE(ABORT, 'published document ancestry is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_edit_receipts_update BEFORE UPDATE ON study_document_edit_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_edit_receipts_delete BEFORE DELETE ON study_document_edit_receipts
BEGIN SELECT RAISE(ABORT, 'document edit receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_content_snapshots_update BEFORE UPDATE ON content_snapshots
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.id OR v.content_snapshot_id=NEW.id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_content_snapshots_delete BEFORE DELETE ON content_snapshots
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_blocks_insert BEFORE INSERT ON blocks
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_blocks_update BEFORE UPDATE ON blocks
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_blocks_delete BEFORE DELETE ON blocks
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_document_assets_insert BEFORE INSERT ON document_assets
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_document_assets_update BEFORE UPDATE ON document_assets
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_document_assets_delete BEFORE DELETE ON document_assets
WHEN EXISTS (SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id))
BEGIN SELECT RAISE(ABORT, 'published document content is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_material_snapshot_insert BEFORE INSERT ON material_document_versions
WHEN EXISTS (SELECT 1 FROM study_document_versions WHERE content_snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT, 'document-owned snapshots cannot be claimed by materials'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_material_snapshot_update BEFORE UPDATE ON material_document_versions
WHEN EXISTS (SELECT 1 FROM study_document_versions WHERE content_snapshot_id=NEW.document_id)
BEGIN SELECT RAISE(ABORT, 'document-owned snapshots cannot be claimed by materials'); END;
