CREATE TRIGGER study_document_citation_assessments_retained BEFORE DELETE ON study_document_citation_assessments
WHEN NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=OLD.version_id)
BEGIN SELECT RAISE(ABORT,'user judgments require explicit body retirement'); END;
--> statement-breakpoint
CREATE TRIGGER study_document_citation_assessments_exact_user_insert BEFORE INSERT ON study_document_citation_assessments
WHEN json_type(NEW.payload,'$.independentVerification') IS NOT 'false'
 OR json_extract(NEW.payload,'$.suppliedBy') IS NOT 'user'
 OR json_type(NEW.payload,'$.note') IS NOT 'text'
 OR json_type(NEW.payload,'$.judgment') IS NOT 'text'
 OR json_type(NEW.payload,'$.evidenceRange') IS NOT 'object'
 OR json_extract(NEW.payload,'$.judgment') NOT IN('supports','contradicts','uncertain')
 OR NOT EXISTS(SELECT 1 FROM study_document_versions v
 JOIN study_document_citations c ON c.version_id=v.id AND c.marker=NEW.marker
 JOIN study_document_inputs i ON i.id=c.input_id AND i.version_id=v.id
 WHERE v.id=NEW.version_id AND v.status='published'
 AND NOT EXISTS(SELECT 1 FROM study_document_retirements r WHERE r.version_id=v.id)
 AND CAST(json_extract(NEW.payload,'$.claim.documentId') AS INTEGER)=v.document_id
 AND CAST(json_extract(NEW.payload,'$.claim.range.versionId') AS INTEGER)=v.id
 AND CAST(json_extract(NEW.payload,'$.claim.range.snapshotId') AS INTEGER)=v.content_snapshot_id
 AND json_extract(NEW.payload,'$.claim.range.start')>=0 AND json_extract(NEW.payload,'$.claim.range.end')>json_extract(NEW.payload,'$.claim.range.start')
 AND EXISTS(SELECT 1 FROM blocks b WHERE b.document_id=v.content_snapshot_id AND b.editing_id=json_extract(NEW.payload,'$.claim.range.blockId'))
 AND json_extract(NEW.payload,'$.marker')=NEW.marker AND json_extract(NEW.payload,'$.citation.marker')=NEW.marker
 AND json_extract(NEW.payload,'$.citation.quote') IS c.quote
 AND json_extract(c.target,'$.blockId') IS NOT NULL
 AND json_extract(NEW.payload,'$.citation.target.blockId') IS json_extract(c.target,'$.blockId')
 AND json_extract(NEW.payload,'$.citation.target.start') IS json_extract(c.target,'$.start')
 AND json_extract(NEW.payload,'$.citation.target.end') IS json_extract(c.target,'$.end')
 AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(json_extract(NEW.payload,'$.citation.anchor')) EXCEPT SELECT fullkey,type,atom FROM json_tree(c.anchor))
 AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(c.anchor) EXCEPT SELECT fullkey,type,atom FROM json_tree(json_extract(NEW.payload,'$.citation.anchor')))

 AND json_extract(NEW.payload,'$.evidenceRange.blockId') IS json_extract(c.target,'$.blockId')
 AND json_extract(NEW.payload,'$.evidenceRange.start') IS json_extract(c.target,'$.start')
 AND json_extract(NEW.payload,'$.evidenceRange.end') IS json_extract(c.target,'$.end')
 AND ((i.document_version_id IS NOT NULL AND json_extract(NEW.payload,'$.evidence.kind')='document'
   AND CAST(json_extract(NEW.payload,'$.evidence.versionId') AS INTEGER)=i.document_version_id
   AND json_extract(NEW.payload,'$.citation.input.kind')='document'
   AND CAST(json_extract(NEW.payload,'$.citation.input.versionId') AS INTEGER)=i.document_version_id)
 OR (i.source_id IS NOT NULL AND i.source_snapshot_id IS NOT NULL AND json_extract(NEW.payload,'$.evidence.kind')='source'
   AND CAST(json_extract(NEW.payload,'$.evidence.sourceId') AS INTEGER)=i.source_id
   AND CAST(json_extract(NEW.payload,'$.evidence.revision') AS INTEGER)=i.source_revision
   AND CAST(json_extract(NEW.payload,'$.evidence.snapshotId') AS INTEGER)=i.source_snapshot_id
   AND json_extract(NEW.payload,'$.citation.input.kind')='source'
   AND CAST(json_extract(NEW.payload,'$.citation.input.sourceId') AS INTEGER)=i.source_id
   AND CAST(json_extract(NEW.payload,'$.citation.input.revision') AS INTEGER)=i.source_revision
   AND CAST(json_extract(NEW.payload,'$.citation.input.snapshotId') AS INTEGER)=i.source_snapshot_id)))
BEGIN SELECT RAISE(ABORT,'judgments require an exact declared citation and remain user supplied'); END;
