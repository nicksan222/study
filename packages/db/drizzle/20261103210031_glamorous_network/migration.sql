CREATE TABLE `legacy_document_annotations` (
	`material_annotation_id` integer PRIMARY KEY,
	`annotation_id` integer NOT NULL,
	CONSTRAINT `fk_legacy_document_annotations_annotation_id_study_document_annotations_id_fk` FOREIGN KEY (`annotation_id`) REFERENCES `study_document_annotations`(`id`)
);
--> statement-breakpoint
CREATE TABLE `legacy_document_generations` (
	`request_id` text PRIMARY KEY,
	`document_request_id` text,
	`result_version_id` integer,
	CONSTRAINT `fk_legacy_document_generations_request_id_material_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `material_generation_requests`(`id`),
	CONSTRAINT `fk_legacy_document_generations_document_request_id_study_document_generation_requests_id_fk` FOREIGN KEY (`document_request_id`) REFERENCES `study_document_generation_requests`(`id`),
	CONSTRAINT `fk_legacy_document_generations_result_version_id_study_document_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `study_document_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `legacy_document_materials` (
	`material_id` integer PRIMARY KEY,
	`document_id` integer NOT NULL UNIQUE,
	CONSTRAINT `fk_legacy_document_materials_material_id_materials_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`),
	CONSTRAINT `fk_legacy_document_materials_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`)
);
--> statement-breakpoint
CREATE TABLE `legacy_document_versions` (
	`material_version_id` integer PRIMARY KEY,
	`document_id` integer NOT NULL,
	`document_version_id` integer UNIQUE,
	`old_snapshot_id` integer,
	`new_snapshot_id` integer,
	`retired` integer NOT NULL,
	CONSTRAINT `fk_legacy_document_versions_material_version_id_material_versions_id_fk` FOREIGN KEY (`material_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_legacy_document_versions_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`),
	CONSTRAINT `fk_legacy_document_versions_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`document_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_legacy_document_versions_new_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`new_snapshot_id`) REFERENCES `content_snapshots`(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_sources` (
	`session_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `session_sources_pk` PRIMARY KEY(`session_id`, `source_id`),
	CONSTRAINT `fk_session_sources_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_session_sources_source_id_sources_id_fk` FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`),
	CONSTRAINT "session_sources_position_check" CHECK("position">=0)
);
--> statement-breakpoint
CREATE TABLE `study_document_annotation_revisions` (
	`annotation_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`document_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	`snapshot_id` integer NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `study_document_annotation_revisions_pk` PRIMARY KEY(`annotation_id`, `revision`),
	CONSTRAINT `fk_study_document_annotation_revisions_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`snapshot_id`) REFERENCES `content_snapshots`(`id`),
	CONSTRAINT `fk_study_document_annotation_revisions_annotation_id_document_id_study_document_annotations_id_document_id_fk` FOREIGN KEY (`annotation_id`,`document_id`) REFERENCES `study_document_annotations`(`id`,`document_id`),
	CONSTRAINT `fk_study_document_annotation_revisions_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`version_id`,`document_id`) REFERENCES `study_document_versions`(`id`,`document_id`),
	CONSTRAINT "study_document_annotation_payload" CHECK(json_valid("payload") AND "revision">0)
);
--> statement-breakpoint
CREATE TABLE `study_document_annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`document_id` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `fk_study_document_annotations_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`),
	CONSTRAINT "study_document_annotations_revision" CHECK("revision">0)
);
--> statement-breakpoint
CREATE TABLE `study_document_citations` (
	`version_id` integer NOT NULL,
	`marker` integer NOT NULL,
	`input_id` integer NOT NULL,
	`anchor` text NOT NULL,
	`target` text,
	`quote` text NOT NULL,
	CONSTRAINT `study_document_citations_pk` PRIMARY KEY(`version_id`, `marker`),
	CONSTRAINT `fk_study_document_citations_input_id_version_id_study_document_inputs_id_version_id_fk` FOREIGN KEY (`input_id`,`version_id`) REFERENCES `study_document_inputs`(`id`,`version_id`),
	CONSTRAINT "study_document_citations_anchor" CHECK(CASE WHEN json_valid("anchor") THEN coalesce(
    json_type("anchor") = 'object' AND CASE json_extract("anchor", '$.type')
    WHEN 'authored' THEN 1
    WHEN 'time' THEN json_type("anchor", '$.startMs') = 'integer' AND json_extract("anchor", '$.startMs') >= 0
      AND json_type("anchor", '$.endMs') = 'integer' AND json_extract("anchor", '$.endMs') >= json_extract("anchor", '$.startMs')
    WHEN 'page' THEN json_type("anchor", '$.page') = 'integer' AND json_extract("anchor", '$.page') >= 1
    WHEN 'paragraph' THEN json_type("anchor", '$.index') = 'integer' AND json_extract("anchor", '$.index') >= 0
    WHEN 'slide' THEN json_type("anchor", '$.index') = 'integer' AND json_extract("anchor", '$.index') >= 0
    WHEN 'url' THEN json_type("anchor", '$.url') = 'text' AND length(trim(json_extract("anchor", '$.url'))) > 0
      AND json_type("anchor", '$.fragment') IN ('null', 'text')
    WHEN 'text' THEN json_type("anchor", '$.lineStart') = 'integer' AND json_extract("anchor", '$.lineStart') >= 0
      AND json_type("anchor", '$.lineEnd') = 'integer' AND json_extract("anchor", '$.lineEnd') >= json_extract("anchor", '$.lineStart')
      AND json_type("anchor", '$.start') = 'integer' AND json_extract("anchor", '$.start') >= 0
      AND json_type("anchor", '$.end') = 'integer' AND json_extract("anchor", '$.end') >= json_extract("anchor", '$.start')
    ELSE 0 END, 0) ELSE 0 END),
	CONSTRAINT "study_document_citations_value" CHECK("marker" BETWEEN 1 AND 4294967295 AND length(trim("quote"))>0 AND ("target" IS NULL OR json_valid("target")))
);
--> statement-breakpoint
CREATE TABLE `study_document_deletions` (
	`document_id` integer PRIMARY KEY,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_study_document_deletions_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`)
);
--> statement-breakpoint
CREATE TABLE `study_document_generation_requests` (
	`id` text PRIMARY KEY,
	`document_id` integer NOT NULL,
	`expected_version_id` integer NOT NULL,
	`session_id` integer,
	`intent_hash` text NOT NULL,
	`result_version_id` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_study_document_generation_requests_document_id_study_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `study_documents`(`id`),
	CONSTRAINT `fk_study_document_generation_requests_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_study_document_generation_requests_result_version_id_study_document_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_generation_requests_expected_version_id_document_id_study_document_versions_id_document_id_fk` FOREIGN KEY (`expected_version_id`,`document_id`) REFERENCES `study_document_versions`(`id`,`document_id`),
	CONSTRAINT "study_document_generation_hash" CHECK(length("intent_hash")=64)
);
--> statement-breakpoint
CREATE TABLE `study_document_inputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`version_id` integer,
	`request_id` text,
	`position` integer NOT NULL,
	`document_version_id` integer,
	`source_id` integer,
	`source_revision` integer,
	`source_snapshot_id` integer,
	`message_version_id` integer,
	`legacy_material_version_id` integer,
	CONSTRAINT `fk_study_document_inputs_version_id_study_document_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_request_id_study_document_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `study_document_generation_requests`(`id`),
	CONSTRAINT `fk_study_document_inputs_document_version_id_study_document_versions_id_fk` FOREIGN KEY (`document_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_source_snapshot_id_content_snapshots_id_fk` FOREIGN KEY (`source_snapshot_id`) REFERENCES `content_snapshots`(`id`),
	CONSTRAINT `fk_study_document_inputs_message_version_id_message_versions_id_fk` FOREIGN KEY (`message_version_id`) REFERENCES `message_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_legacy_material_version_id_material_versions_id_fk` FOREIGN KEY (`legacy_material_version_id`) REFERENCES `material_versions`(`id`),
	CONSTRAINT `fk_study_document_inputs_source_id_source_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`source_revision`) REFERENCES `source_snapshots`(`source_id`,`revision`),
	CONSTRAINT "study_document_inputs_exact_target" CHECK(("version_id" IS NOT NULL) != ("request_id" IS NOT NULL) AND "position">=0 AND
 (("document_version_id" IS NOT NULL)+("source_id" IS NOT NULL)+("message_version_id" IS NOT NULL)+("legacy_material_version_id" IS NOT NULL))=1 AND
 (("source_id" IS NULL)=("source_revision" IS NULL)) AND ("source_snapshot_id" IS NULL OR "source_id" IS NOT NULL) AND ("source_revision" IS NULL OR "source_revision">0))
);
--> statement-breakpoint
CREATE TABLE `study_document_proposal_receipts` (
	`key` text PRIMARY KEY,
	`request_id` text NOT NULL,
	`operation` text NOT NULL,
	`intent` text NOT NULL,
	`outcome` text NOT NULL,
	`current_version_id` integer NOT NULL,
	`result_version_id` integer,
	CONSTRAINT `fk_study_document_proposal_receipts_request_id_study_document_proposals_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `study_document_proposals`(`request_id`),
	CONSTRAINT `fk_study_document_proposal_receipts_current_version_id_study_document_versions_id_fk` FOREIGN KEY (`current_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_proposal_receipts_result_version_id_study_document_versions_id_fk` FOREIGN KEY (`result_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT "study_document_proposal_receipt" CHECK(json_valid("intent") AND (("outcome"='conflict' AND "operation"='apply' AND "result_version_id" IS NULL) OR ("outcome"='applied' AND "operation"='apply' AND "result_version_id" IS NOT NULL) OR ("outcome"='kept' AND "operation"='keep' AND "result_version_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE `study_document_proposals` (
	`request_id` text PRIMARY KEY,
	`base_version_id` integer NOT NULL,
	`proposed_version_id` integer NOT NULL UNIQUE,
	CONSTRAINT `fk_study_document_proposals_request_id_study_document_generation_requests_id_fk` FOREIGN KEY (`request_id`) REFERENCES `study_document_generation_requests`(`id`),
	CONSTRAINT `fk_study_document_proposals_base_version_id_study_document_versions_id_fk` FOREIGN KEY (`base_version_id`) REFERENCES `study_document_versions`(`id`),
	CONSTRAINT `fk_study_document_proposals_proposed_version_id_study_document_versions_id_fk` FOREIGN KEY (`proposed_version_id`) REFERENCES `study_document_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `study_document_retirements` (
	`version_id` integer PRIMARY KEY,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_study_document_retirements_version_id_study_document_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `study_document_versions`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_sources_position` ON `session_sources` (`session_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_annotations_owner` ON `study_document_annotations` (`id`,`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_owner` ON `study_document_inputs` (`id`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_version_position` ON `study_document_inputs` (`version_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_inputs_request_position` ON `study_document_inputs` (`request_id`,`position`);
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
INSERT INTO legacy_document_materials(material_id,document_id)
SELECT m.id, (SELECT coalesce(max(id),0) FROM study_documents)+row_number() OVER(ORDER BY m.id)
FROM materials m WHERE m.kind='document' AND NOT EXISTS(SELECT 1 FROM material_imports i WHERE i.material_id=m.id);
--> statement-breakpoint
INSERT INTO study_documents(id,title,description,create_key,creation_intent,created_at,updated_at,archived_at)
SELECT x.document_id,m.title,m.description,m.create_key,m.creation_intent,m.created_at,m.updated_at,m.archived_at
FROM materials m JOIN legacy_document_materials x ON x.material_id=m.id;
--> statement-breakpoint
INSERT INTO legacy_document_versions(material_version_id,document_id,document_version_id,old_snapshot_id,new_snapshot_id,retired)
SELECT v.id,x.document_id,
 CASE WHEN c.id IS NOT NULL THEN (SELECT coalesce(max(id),0) FROM study_document_versions)+row_number() OVER(ORDER BY v.id) END,
 c.id,CASE WHEN c.id IS NOT NULL THEN (SELECT coalesce(max(id),0) FROM content_snapshots)+row_number() OVER(ORDER BY v.id) END,
 c.id IS NULL
FROM material_versions v JOIN legacy_document_materials x ON x.material_id=v.material_id
LEFT JOIN material_document_versions d ON d.version_id=v.id LEFT JOIN content_snapshots c ON c.id=d.document_id;
--> statement-breakpoint
INSERT INTO content_snapshots(id,source_id,extractor,extractor_version,meta,created_at)
SELECT x.new_snapshot_id,NULL,c.extractor,c.extractor_version,c.meta,c.created_at FROM legacy_document_versions x JOIN content_snapshots c ON c.id=x.old_snapshot_id;
--> statement-breakpoint
INSERT INTO blocks(document_id,ordinal,kind,editing_id,content,text,anchor)
SELECT x.new_snapshot_id,b.ordinal,b.kind,b.editing_id,b.content,b.text,b.anchor FROM legacy_document_versions x JOIN blocks b ON b.document_id=x.old_snapshot_id;
--> statement-breakpoint
INSERT INTO document_assets(document_id,block_id,source_id,revision)
SELECT x.new_snapshot_id,a.block_id,a.source_id,a.revision FROM legacy_document_versions x JOIN document_assets a ON a.document_id=x.old_snapshot_id;
--> statement-breakpoint
INSERT INTO study_document_versions(id,document_id,number,status,operation,creator,content_snapshot_id,instruction,language,created_at)
SELECT x.document_version_id,x.document_id,v.number,'draft',
 CASE WHEN v.operation IN ('extract','transcribe') THEN 'original' ELSE v.operation END,
 CASE WHEN v.creator='import' THEN 'user' ELSE v.creator END,x.new_snapshot_id,v.instruction,v.language,v.created_at
FROM legacy_document_versions x JOIN material_versions v ON v.id=x.material_version_id WHERE x.document_version_id IS NOT NULL;
--> statement-breakpoint
DROP TRIGGER study_document_parents_insert;
--> statement-breakpoint
DROP TRIGGER study_document_versions_publish;
--> statement-breakpoint
INSERT INTO study_document_version_parents(version_id,parent_version_id,document_id)
SELECT c.document_version_id,p.document_version_id,c.document_id FROM material_version_parents a JOIN legacy_document_versions c ON c.material_version_id=a.version_id JOIN legacy_document_versions p ON p.material_version_id=a.parent_version_id WHERE c.document_version_id IS NOT NULL AND p.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO study_document_inputs(version_id,position,document_version_id,source_id,source_revision,source_snapshot_id,legacy_material_version_id)
SELECT c.document_version_id,row_number() OVER(PARTITION BY c.document_version_id ORDER BY i.input_version_id)-1,
 p.document_version_id,CASE WHEN p.document_version_id IS NULL THEN ss.source_id END,CASE WHEN p.document_version_id IS NULL THEN ss.revision END,CASE WHEN p.document_version_id IS NULL THEN ss.document_id END,
 CASE WHEN p.document_version_id IS NULL AND ss.source_id IS NULL THEN i.input_version_id END
FROM material_version_inputs i JOIN legacy_document_versions c ON c.material_version_id=i.version_id
LEFT JOIN legacy_document_versions p ON p.material_version_id=i.input_version_id LEFT JOIN material_source_snapshots ss ON ss.version_id=i.input_version_id WHERE c.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO study_document_citations(version_id,marker,input_id,anchor,target,quote)
SELECT c.document_version_id,ci.marker,ni.id,ci.anchor,ci.target,ci.quote FROM material_version_citations ci JOIN legacy_document_versions c ON c.material_version_id=ci.version_id
JOIN material_version_inputs oi ON oi.version_id=ci.version_id AND oi.input_version_id=ci.input_version_id
JOIN study_document_inputs ni ON ni.version_id=c.document_version_id AND ni.position=(SELECT count(*) FROM material_version_inputs z WHERE z.version_id=ci.version_id AND z.input_version_id<ci.input_version_id);
--> statement-breakpoint
UPDATE study_document_versions SET status='published',published_at=(SELECT v.published_at FROM legacy_document_versions x JOIN material_versions v ON v.id=x.material_version_id WHERE x.document_version_id=study_document_versions.id)
WHERE id IN (SELECT x.document_version_id FROM legacy_document_versions x JOIN material_versions v ON v.id=x.material_version_id WHERE v.status='published');
--> statement-breakpoint
CREATE TRIGGER study_document_parents_insert BEFORE INSERT ON study_document_version_parents
WHEN NOT EXISTS (SELECT 1 FROM study_document_versions child JOIN study_document_versions parent
 ON parent.id=NEW.parent_version_id WHERE child.id=NEW.version_id AND child.status='draft'
 AND parent.status='published' AND child.document_id=NEW.document_id AND parent.document_id=NEW.document_id
 AND parent.number<child.number)
BEGIN SELECT RAISE(ABORT, 'document ancestry requires an earlier published version of the same document'); END;
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
INSERT INTO project_documents(project_id,document_id) SELECT p.project_id,x.document_id FROM project_materials p JOIN legacy_document_materials x ON x.material_id=p.material_id;
--> statement-breakpoint
INSERT INTO session_documents(session_id,document_id,position) SELECT p.session_id,x.document_id,p.position FROM session_materials p JOIN legacy_document_materials x ON x.material_id=p.material_id;
--> statement-breakpoint
INSERT INTO session_sources(session_id,source_id,position) SELECT sm.session_id,i.source_id,row_number() OVER(PARTITION BY sm.session_id ORDER BY sm.position)-1 FROM session_materials sm JOIN material_imports i ON i.material_id=sm.material_id;
--> statement-breakpoint
INSERT INTO study_document_edit_receipts(document_id,key,operation,intent,expected_version_id,current_version_id,submitted_version_id,outcome)
SELECT m.document_id,r.key,CASE WHEN r.operation='undo' THEN 'restore' ELSE r.operation END,r.intent,e.document_version_id,c.document_version_id,s.document_version_id,r.outcome
FROM document_edit_receipts r JOIN legacy_document_materials m ON m.material_id=r.material_id JOIN legacy_document_versions e ON e.material_version_id=r.expected_version_id JOIN legacy_document_versions c ON c.material_version_id=r.current_version_id JOIN legacy_document_versions s ON s.material_version_id=r.submitted_version_id
WHERE e.document_version_id IS NOT NULL AND c.document_version_id IS NOT NULL AND s.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO legacy_document_annotations(material_annotation_id,annotation_id)
SELECT a.id,(SELECT coalesce(max(id),0) FROM study_document_annotations)+row_number() OVER(ORDER BY a.id) FROM material_annotations a JOIN legacy_document_materials m ON m.material_id=a.material_id;
--> statement-breakpoint
INSERT INTO study_document_annotations(id,document_id,revision) SELECT x.annotation_id,m.document_id,a.revision FROM legacy_document_annotations x JOIN material_annotations a ON a.id=x.material_annotation_id JOIN legacy_document_materials m ON m.material_id=a.material_id;
--> statement-breakpoint
INSERT INTO study_document_annotation_revisions(annotation_id,revision,document_id,version_id,snapshot_id,payload)
SELECT a.annotation_id,r.revision,v.document_id,v.document_version_id,v.new_snapshot_id,r.payload FROM material_annotation_revisions r JOIN legacy_document_annotations a ON a.material_annotation_id=r.annotation_id JOIN legacy_document_versions v ON v.material_version_id=r.version_id WHERE v.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO study_document_generation_requests(id,document_id,expected_version_id,session_id,intent_hash,result_version_id,created_at)
SELECT g.id,b.document_id,b.document_version_id,CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE id=p.session_id) THEN p.session_id END,coalesce(g.result_hash,printf('%064d',0)),r.document_version_id,g.created_at
FROM document_proposals p JOIN material_generation_requests g ON g.id=p.request_id JOIN legacy_document_versions b ON b.material_version_id=p.base_version_id LEFT JOIN legacy_document_versions r ON r.material_version_id=g.result_version_id
WHERE b.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO study_document_proposals(request_id,base_version_id,proposed_version_id) SELECT p.request_id,b.document_version_id,v.document_version_id FROM document_proposals p JOIN study_document_generation_requests g ON g.id=p.request_id JOIN legacy_document_versions b ON b.material_version_id=p.base_version_id JOIN legacy_document_versions v ON v.material_version_id=p.proposed_version_id WHERE b.document_version_id IS NOT NULL AND v.document_version_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO study_document_proposal_receipts(key,request_id,operation,intent,outcome,current_version_id,result_version_id)
SELECT r.key,r.request_id,r.operation,r.intent,r.outcome,c.document_version_id,v.document_version_id FROM document_proposal_receipts r JOIN study_document_proposals p ON p.request_id=r.request_id JOIN legacy_document_versions c ON c.material_version_id=r.current_version_id LEFT JOIN legacy_document_versions v ON v.material_version_id=r.result_version_id WHERE c.document_version_id IS NOT NULL AND (r.result_version_id IS NULL OR v.document_version_id IS NOT NULL);
--> statement-breakpoint
INSERT INTO legacy_document_generations(request_id,document_request_id,result_version_id)
SELECT g.id,d.id,v.document_version_id FROM material_generation_requests g LEFT JOIN study_document_generation_requests d ON d.id=g.id LEFT JOIN legacy_document_versions v ON v.material_version_id=g.result_version_id WHERE d.id IS NOT NULL OR v.document_id IS NOT NULL OR json_extract(g.payload,'$.kind')='document' OR json_extract(g.payload,'$.content.kind')='document';
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_insert BEFORE INSERT ON study_document_inputs WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_update BEFORE UPDATE ON study_document_inputs WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') OR EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_inputs_delete BEFORE DELETE ON study_document_inputs WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_insert BEFORE INSERT ON study_document_citations WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_update BEFORE UPDATE ON study_document_citations WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=NEW.version_id AND status='published') OR EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citations_delete BEFORE DELETE ON study_document_citations WHEN EXISTS(SELECT 1 FROM study_document_versions WHERE id=OLD.version_id AND status='published') BEGIN SELECT RAISE(ABORT,'published document evidence is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_source_input BEFORE INSERT ON study_document_inputs
WHEN NEW.source_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM content_snapshots WHERE id=NEW.source_snapshot_id AND source_id=NEW.source_id)
BEGIN SELECT RAISE(ABORT,'source snapshot must belong to exact source'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retirements_update BEFORE UPDATE ON study_document_retirements BEGIN SELECT RAISE(ABORT,'document retirement is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_retirements_delete BEFORE DELETE ON study_document_retirements BEGIN SELECT RAISE(ABORT,'document retirement is permanent'); END;
--> statement-breakpoint
DROP TRIGGER study_document_content_snapshots_update;
--> statement-breakpoint
CREATE TRIGGER study_document_content_snapshots_update BEFORE UPDATE ON content_snapshots WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.id OR v.content_snapshot_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_content_snapshots_delete;
--> statement-breakpoint
CREATE TRIGGER study_document_content_snapshots_delete BEFORE DELETE ON content_snapshots WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_blocks_update;
--> statement-breakpoint
CREATE TRIGGER study_document_blocks_update BEFORE UPDATE ON blocks WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_blocks_delete;
--> statement-breakpoint
CREATE TRIGGER study_document_blocks_delete BEFORE DELETE ON blocks WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_document_assets_update;
--> statement-breakpoint
CREATE TRIGGER study_document_document_assets_update BEFORE UPDATE ON document_assets WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id OR v.content_snapshot_id=NEW.document_id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
--> statement-breakpoint
DROP TRIGGER study_document_document_assets_delete;
--> statement-breakpoint
CREATE TRIGGER study_document_document_assets_delete BEFORE DELETE ON document_assets WHEN EXISTS(SELECT 1 FROM study_document_versions v WHERE v.status='published' AND (v.content_snapshot_id=OLD.document_id) AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)) BEGIN SELECT RAISE(ABORT,'published document content is immutable'); END;
