import { sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';

/** SQLite counterpart of the canonical anchored-document shape. */
export function validAnchor(a: SQLWrapper): SQL {
  return sql`CASE WHEN json_valid(${a}) THEN coalesce(
    json_type(${a}) = 'object' AND CASE json_extract(${a}, '$.type')
    WHEN 'time' THEN json_type(${a}, '$.startMs') = 'integer' AND json_extract(${a}, '$.startMs') >= 0
      AND json_type(${a}, '$.endMs') = 'integer' AND json_extract(${a}, '$.endMs') >= json_extract(${a}, '$.startMs')
    WHEN 'page' THEN json_type(${a}, '$.page') = 'integer' AND json_extract(${a}, '$.page') >= 1
    WHEN 'paragraph' THEN json_type(${a}, '$.index') = 'integer' AND json_extract(${a}, '$.index') >= 0
    WHEN 'slide' THEN json_type(${a}, '$.index') = 'integer' AND json_extract(${a}, '$.index') >= 0
    WHEN 'url' THEN json_type(${a}, '$.url') = 'text' AND length(trim(json_extract(${a}, '$.url'))) > 0
      AND json_type(${a}, '$.fragment') IN ('null', 'text')
    WHEN 'text' THEN json_type(${a}, '$.lineStart') = 'integer' AND json_extract(${a}, '$.lineStart') >= 0
      AND json_type(${a}, '$.lineEnd') = 'integer' AND json_extract(${a}, '$.lineEnd') >= json_extract(${a}, '$.lineStart')
      AND json_type(${a}, '$.start') = 'integer' AND json_extract(${a}, '$.start') >= 0
      AND json_type(${a}, '$.end') = 'integer' AND json_extract(${a}, '$.end') >= json_extract(${a}, '$.start')
    ELSE 0 END, 0) ELSE 0 END`;
}

/** Published document metadata can be decoded without optional-shape guessing. */
export function validDocumentMeta(m: SQLWrapper): SQL {
  return sql`CASE WHEN json_valid(${m}) THEN coalesce(
    json_type(${m}) = 'object'
    AND json_type(${m}, '$.extractor') IN ('null','text')
    AND json_type(${m}, '$.extractorVersion') = 'integer' AND json_extract(${m}, '$.extractorVersion') >= 0
    AND json_type(${m}, '$.provider') IN ('null','text')
    AND (json_type(${m}, '$.durationMs') = 'null' OR (json_type(${m}, '$.durationMs') = 'integer' AND json_extract(${m}, '$.durationMs') >= 0))
    AND (json_type(${m}, '$.pageCount') = 'null' OR (json_type(${m}, '$.pageCount') = 'integer' AND json_extract(${m}, '$.pageCount') >= 0))
    AND json_type(${m}, '$.corrected') IN ('true','false')
    AND json_type(${m}, '$.refiners') = 'array'
    AND json_type(${m}, '$.waitingFor') = 'array'
    AND NOT EXISTS(SELECT 1 FROM json_each(${m}, '$.waitingFor') w WHERE w.type != 'text')
    AND NOT EXISTS(SELECT 1 FROM json_each(${m}, '$.refiners') r WHERE CASE WHEN r.type = 'object' THEN coalesce(
      json_type(r.value, '$.refiner') = 'text' AND length(trim(json_extract(r.value, '$.refiner'))) > 0
      AND json_type(r.value, '$.version') = 'integer' AND json_extract(r.value, '$.version') >= 0, 0) ELSE 0 END = 0)
    , 0) ELSE 0 END`;
}
