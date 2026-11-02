-- Annotation deletion is a revision tombstone; retained targets and judgments stay recoverable.
CREATE TRIGGER material_annotation_revision_immutable BEFORE UPDATE ON material_annotation_revisions
BEGIN SELECT RAISE(ABORT, 'annotation revisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_annotation_revision_retained BEFORE DELETE ON material_annotation_revisions
BEGIN SELECT RAISE(ABORT, 'annotation revisions are retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_annotation_retained BEFORE DELETE ON material_annotations
BEGIN SELECT RAISE(ABORT, 'annotation identities are retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_annotation_head_valid BEFORE UPDATE ON material_annotations
WHEN NEW.id != OLD.id OR NEW.material_id != OLD.material_id OR NEW.revision != OLD.revision + 1
  OR NOT EXISTS (SELECT 1 FROM material_annotation_revisions r WHERE r.annotation_id = NEW.id AND r.revision = NEW.revision)
BEGIN SELECT RAISE(ABORT, 'annotation head requires the next retained revision'); END;
--> statement-breakpoint
CREATE TRIGGER material_annotation_revision_valid BEFORE INSERT ON material_annotation_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM material_annotations a JOIN material_versions v ON v.id = NEW.version_id
  WHERE a.id = NEW.annotation_id AND v.material_id = a.material_id AND v.status = 'published'
    AND (NEW.revision = a.revision + 1 OR (NEW.revision = 1 AND a.revision = 1))
    AND CAST(json_extract(NEW.payload, '$.id') AS INTEGER) = NEW.annotation_id
    AND CAST(json_extract(NEW.payload, '$.revision') AS INTEGER) = NEW.revision
    AND CAST(json_extract(NEW.payload, '$.target.materialId') AS INTEGER) = a.material_id
    AND CAST(json_extract(NEW.payload, '$.target.range.versionId') AS INTEGER) = NEW.version_id
    AND CAST(json_extract(NEW.payload, '$.target.range.documentId') AS INTEGER) = NEW.document_id
    AND (EXISTS (SELECT 1 FROM material_document_versions d WHERE d.version_id = v.id AND d.document_id = NEW.document_id)
      OR EXISTS (SELECT 1 FROM material_source_snapshots d WHERE d.version_id = v.id AND d.document_id = NEW.document_id))
)
BEGIN SELECT RAISE(ABORT, 'annotation revision requires exact published ownership'); END;
--> statement-breakpoint
CREATE TRIGGER material_citation_assessment_immutable BEFORE UPDATE ON material_citation_assessments
BEGIN SELECT RAISE(ABORT, 'citation assessments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER material_citation_assessment_retained BEFORE DELETE ON material_citation_assessments
BEGIN SELECT RAISE(ABORT, 'citation assessments are retained'); END;
--> statement-breakpoint
CREATE TRIGGER material_citation_assessment_valid BEFORE INSERT ON material_citation_assessments
WHEN NOT EXISTS (
  SELECT 1 FROM material_versions c JOIN material_versions e ON e.id = NEW.evidence_version_id
  JOIN material_version_citations r ON r.version_id = c.id AND r.marker = NEW.marker
  WHERE c.id = NEW.claim_version_id AND c.status = 'published' AND e.status = 'published'
    AND r.input_version_id = e.id AND r.target IS NOT NULL
    AND CAST(json_extract(NEW.payload, '$.claim.range.versionId') AS INTEGER) = c.id
    AND CAST(json_extract(NEW.payload, '$.evidence.range.versionId') AS INTEGER) = e.id
    AND CAST(json_extract(NEW.payload, '$.marker') AS INTEGER) = NEW.marker
    AND json_extract(NEW.payload, '$.suppliedBy') = 'user'
    AND json_extract(NEW.payload, '$.independentVerification') = 0
)
BEGIN SELECT RAISE(ABORT, 'assessment requires an exact published citation'); END;
