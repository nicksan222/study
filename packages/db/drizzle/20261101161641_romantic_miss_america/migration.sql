CREATE TABLE `document_assets` (
	`document_id` integer NOT NULL,
	`block_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT `document_assets_pk` PRIMARY KEY(`document_id`, `block_id`),
	CONSTRAINT `fk_document_assets_document_id_block_id_blocks_document_id_editing_id_fk` FOREIGN KEY (`document_id`,`block_id`) REFERENCES `blocks`(`document_id`,`editing_id`) ON DELETE CASCADE,
	CONSTRAINT `fk_document_assets_source_id_revision_source_snapshots_source_id_revision_fk` FOREIGN KEY (`source_id`,`revision`) REFERENCES `source_snapshots`(`source_id`,`revision`)
);
--> statement-breakpoint
ALTER TABLE `blocks` ADD `editing_id` text NOT NULL;
--> statement-breakpoint
ALTER TABLE `blocks` ADD `content` text NOT NULL CONSTRAINT blocks_content_json CHECK(json_valid(content));
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_document_editing_id_unique` ON `blocks` (`document_id`,`editing_id`);
--> statement-breakpoint
DROP TRIGGER material_document_canonical_shape;
--> statement-breakpoint
CREATE TRIGGER material_document_canonical_shape BEFORE UPDATE OF status ON material_versions WHEN new.status='published' AND new.kind='document' AND (EXISTS(SELECT 1 FROM material_document_versions c JOIN blocks b ON b.document_id=c.document_id WHERE c.version_id=new.id AND NOT (CASE WHEN json_valid(b.anchor) THEN coalesce(
    json_type(b.anchor) = 'object' AND CASE json_extract(b.anchor, '$.type')
    WHEN 'authored' THEN 1
    WHEN 'time' THEN json_type(b.anchor, '$.startMs') = 'integer' AND json_extract(b.anchor, '$.startMs') >= 0
      AND json_type(b.anchor, '$.endMs') = 'integer' AND json_extract(b.anchor, '$.endMs') >= json_extract(b.anchor, '$.startMs')
    WHEN 'page' THEN json_type(b.anchor, '$.page') = 'integer' AND json_extract(b.anchor, '$.page') >= 1
    WHEN 'paragraph' THEN json_type(b.anchor, '$.index') = 'integer' AND json_extract(b.anchor, '$.index') >= 0
    WHEN 'slide' THEN json_type(b.anchor, '$.index') = 'integer' AND json_extract(b.anchor, '$.index') >= 0
    WHEN 'url' THEN json_type(b.anchor, '$.url') = 'text' AND length(trim(json_extract(b.anchor, '$.url'))) > 0
      AND json_type(b.anchor, '$.fragment') IN ('null', 'text')
    WHEN 'text' THEN json_type(b.anchor, '$.lineStart') = 'integer' AND json_extract(b.anchor, '$.lineStart') >= 0
      AND json_type(b.anchor, '$.lineEnd') = 'integer' AND json_extract(b.anchor, '$.lineEnd') >= json_extract(b.anchor, '$.lineStart')
      AND json_type(b.anchor, '$.start') = 'integer' AND json_extract(b.anchor, '$.start') >= 0
      AND json_type(b.anchor, '$.end') = 'integer' AND json_extract(b.anchor, '$.end') >= json_extract(b.anchor, '$.start')
    ELSE 0 END, 0) ELSE 0 END)) OR EXISTS(SELECT 1 FROM material_document_versions c JOIN documents d ON d.id=c.document_id WHERE c.version_id=new.id AND NOT (CASE WHEN json_valid(d.meta) THEN coalesce(
    json_type(d.meta) = 'object'
    AND json_type(d.meta, '$.extractor') IN ('null','text')
    AND json_type(d.meta, '$.extractorVersion') = 'integer' AND json_extract(d.meta, '$.extractorVersion') >= 0
    AND json_type(d.meta, '$.provider') IN ('null','text')
    AND (json_type(d.meta, '$.durationMs') = 'null' OR (json_type(d.meta, '$.durationMs') = 'integer' AND json_extract(d.meta, '$.durationMs') >= 0))
    AND (json_type(d.meta, '$.pageCount') = 'null' OR (json_type(d.meta, '$.pageCount') = 'integer' AND json_extract(d.meta, '$.pageCount') >= 0))
    AND json_type(d.meta, '$.corrected') IN ('true','false')
    AND json_type(d.meta, '$.refiners') = 'array'
    AND json_type(d.meta, '$.waitingFor') = 'array'
    AND NOT EXISTS(SELECT 1 FROM json_each(d.meta, '$.waitingFor') w WHERE w.type != 'text')
    AND NOT EXISTS(SELECT 1 FROM json_each(d.meta, '$.refiners') r WHERE CASE WHEN r.type = 'object' THEN coalesce(
      json_type(r.value, '$.refiner') = 'text' AND length(trim(json_extract(r.value, '$.refiner'))) > 0
      AND json_type(r.value, '$.version') = 'integer' AND json_extract(r.value, '$.version') >= 0, 0) ELSE 0 END = 0)
    , 0) ELSE 0 END))) BEGIN SELECT RAISE(ABORT, 'published documents require canonical anchors and metadata'); END;
--> statement-breakpoint
DROP TRIGGER material_import_document_canonical_shape;
--> statement-breakpoint
CREATE TRIGGER material_import_document_canonical_shape BEFORE UPDATE OF status ON material_versions WHEN new.status='published' AND new.kind IN ('file','audio','video','image','link') AND (EXISTS(SELECT 1 FROM material_source_snapshots c JOIN blocks b ON b.document_id=c.document_id WHERE c.version_id=new.id AND NOT (CASE WHEN json_valid(b.anchor) THEN coalesce(
    json_type(b.anchor) = 'object' AND CASE json_extract(b.anchor, '$.type')
    WHEN 'authored' THEN 1
    WHEN 'time' THEN json_type(b.anchor, '$.startMs') = 'integer' AND json_extract(b.anchor, '$.startMs') >= 0
      AND json_type(b.anchor, '$.endMs') = 'integer' AND json_extract(b.anchor, '$.endMs') >= json_extract(b.anchor, '$.startMs')
    WHEN 'page' THEN json_type(b.anchor, '$.page') = 'integer' AND json_extract(b.anchor, '$.page') >= 1
    WHEN 'paragraph' THEN json_type(b.anchor, '$.index') = 'integer' AND json_extract(b.anchor, '$.index') >= 0
    WHEN 'slide' THEN json_type(b.anchor, '$.index') = 'integer' AND json_extract(b.anchor, '$.index') >= 0
    WHEN 'url' THEN json_type(b.anchor, '$.url') = 'text' AND length(trim(json_extract(b.anchor, '$.url'))) > 0
      AND json_type(b.anchor, '$.fragment') IN ('null', 'text')
    WHEN 'text' THEN json_type(b.anchor, '$.lineStart') = 'integer' AND json_extract(b.anchor, '$.lineStart') >= 0
      AND json_type(b.anchor, '$.lineEnd') = 'integer' AND json_extract(b.anchor, '$.lineEnd') >= json_extract(b.anchor, '$.lineStart')
      AND json_type(b.anchor, '$.start') = 'integer' AND json_extract(b.anchor, '$.start') >= 0
      AND json_type(b.anchor, '$.end') = 'integer' AND json_extract(b.anchor, '$.end') >= json_extract(b.anchor, '$.start')
    ELSE 0 END, 0) ELSE 0 END)) OR EXISTS(SELECT 1 FROM material_source_snapshots c JOIN documents d ON d.id=c.document_id WHERE c.version_id=new.id AND NOT (CASE WHEN json_valid(d.meta) THEN coalesce(
    json_type(d.meta) = 'object'
    AND json_type(d.meta, '$.extractor') IN ('null','text')
    AND json_type(d.meta, '$.extractorVersion') = 'integer' AND json_extract(d.meta, '$.extractorVersion') >= 0
    AND json_type(d.meta, '$.provider') IN ('null','text')
    AND (json_type(d.meta, '$.durationMs') = 'null' OR (json_type(d.meta, '$.durationMs') = 'integer' AND json_extract(d.meta, '$.durationMs') >= 0))
    AND (json_type(d.meta, '$.pageCount') = 'null' OR (json_type(d.meta, '$.pageCount') = 'integer' AND json_extract(d.meta, '$.pageCount') >= 0))
    AND json_type(d.meta, '$.corrected') IN ('true','false')
    AND json_type(d.meta, '$.refiners') = 'array'
    AND json_type(d.meta, '$.waitingFor') = 'array'
    AND NOT EXISTS(SELECT 1 FROM json_each(d.meta, '$.waitingFor') w WHERE w.type != 'text')
    AND NOT EXISTS(SELECT 1 FROM json_each(d.meta, '$.refiners') r WHERE CASE WHEN r.type = 'object' THEN coalesce(
      json_type(r.value, '$.refiner') = 'text' AND length(trim(json_extract(r.value, '$.refiner'))) > 0
      AND json_type(r.value, '$.version') = 'integer' AND json_extract(r.value, '$.version') >= 0, 0) ELSE 0 END = 0)
    , 0) ELSE 0 END))) BEGIN SELECT RAISE(ABORT, 'published documents require canonical anchors and metadata'); END;
--> statement-breakpoint
INSERT INTO codes_block_kind(code) VALUES ('math'),('image'),('reference');
--> statement-breakpoint
DROP TRIGGER material_publish_document;
--> statement-breakpoint
CREATE TRIGGER material_publish_document BEFORE UPDATE OF status ON material_versions
WHEN new.status='published' AND new.kind='document' AND NOT EXISTS(
SELECT 1 FROM material_document_versions c JOIN blocks b ON b.document_id=c.document_id WHERE c.version_id=new.id)
BEGIN SELECT RAISE(ABORT, 'published documents require structural content'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_insert AFTER INSERT ON blocks WHEN new.kind='image'
BEGIN
INSERT INTO document_assets(document_id,block_id,source_id,revision)
SELECT new.document_id,new.editing_id,CAST(json_extract(new.content,'$.sourceId') AS INTEGER),json_extract(new.content,'$.revision');
END;
--> statement-breakpoint
CREATE TRIGGER document_asset_update AFTER UPDATE OF content,kind,editing_id,document_id ON blocks
BEGIN
DELETE FROM document_assets WHERE document_id=old.document_id AND block_id=old.editing_id;
INSERT INTO document_assets(document_id,block_id,source_id,revision)
SELECT new.document_id,new.editing_id,CAST(json_extract(new.content,'$.sourceId') AS INTEGER),json_extract(new.content,'$.revision') WHERE new.kind='image';
END;
--> statement-breakpoint
CREATE TRIGGER document_asset_kind BEFORE INSERT ON document_assets
WHEN NOT EXISTS(SELECT 1 FROM blocks b WHERE b.document_id=new.document_id AND b.editing_id=new.block_id AND b.kind='image' AND CAST(json_extract(b.content,'$.sourceId') AS INTEGER)=new.source_id AND json_extract(b.content,'$.revision')=new.revision) OR NOT EXISTS(SELECT 1 FROM source_snapshots ss WHERE ss.source_id=new.source_id AND ss.revision=new.revision AND ss.kind='image' AND lower(ss.mime) LIKE 'image/%')
BEGIN SELECT RAISE(ABORT, 'managed image revision is unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_update_forbidden BEFORE UPDATE ON document_assets
BEGIN SELECT RAISE(ABORT, 'asset associations follow canonical blocks'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_delete_frozen BEFORE DELETE ON document_assets
WHEN EXISTS(SELECT 1 FROM material_document_versions c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=old.document_id AND v.status='published')
OR EXISTS(SELECT 1 FROM material_source_snapshots c JOIN material_versions v ON v.id=c.version_id WHERE c.document_id=old.document_id AND v.status='published')
BEGIN SELECT RAISE(ABORT, 'published document assets are immutable'); END;

--> statement-breakpoint
CREATE TRIGGER document_asset_snapshot_update BEFORE UPDATE ON source_snapshots
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.source_id=old.source_id AND a.revision=old.revision)
BEGIN SELECT RAISE(ABORT, 'retained document asset is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_asset_snapshot_delete BEFORE DELETE ON source_snapshots
WHEN EXISTS(SELECT 1 FROM document_assets a WHERE a.source_id=old.source_id AND a.revision=old.revision)
BEGIN SELECT RAISE(ABORT, 'retained document asset is immutable'); END;
