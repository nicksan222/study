/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Serializes exact learning versions using bounded canonical export representations. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Serializes exact learning versions using bounded canonical export representations.     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature policy coordinates public services and private stores within caller-owned        │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { materialAidExportSchema, MAX_EXPORT_BYTES } from '@study/contracts/materials/export';
import type {
  learningExportFormatSchema,
  exportOmissionSchema
} from '@study/contracts/materials/export';
import type {
  materialCitationSchema,
  MaterialVersionDetailDto
} from '@study/contracts/materials/schemas';
import { Schema } from 'effect';

import { exportBudget } from '#server/platform/content-export/budget';

const json = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));

const csvCell = (s: string) =>
  '"' + (/^(?:\s*[=+@-]|[\t\r\n])/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';

export function serializeMaterialVersion(
  version: MaterialVersionDetailDto,
  format: typeof learningExportFormatSchema.Type,
  citations: readonly (typeof materialCitationSchema.Type)[] = []
) {
  exportBudget().consume({ version, citations });
  const omissions: (typeof exportOmissionSchema.Type)[] = [];
  let body: string;

  if (format === 'aid_json') {
    if (!['quiz', 'flashcards', 'diagram'].includes(version.kind))
      throw new StudyError('unsupported', 'Typed aid export requires an aid');

    body = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(materialAidExportSchema)))({
      schemaVersion: 1,
      version,
      citations
    });
  } else {
    const content = version.content;
    let rows: string[][];

    if (content.kind === 'flashcards')
      rows = [
        ['cardId', 'front', 'back'],
        ...content.cards.map((c) => [String(c.cardId), c.front, c.back])
      ];
    else if (content.kind === 'quiz')
      rows = [
        ['questionId', 'kind', 'prompt', 'explanation', 'answer'],
        ...content.questions.map((q) => [
          String(q.id),
          q.kind,
          q.prompt,
          q.explanation,
          q.kind === 'open' ? q.referenceAnswer : json(q.choices)
        ])
      ];
    else throw new StudyError('unsupported', 'CSV requires flashcards or quiz content');

    omissions.push({ code: 'csv_structure' });
    body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  const bytes = new TextEncoder().encode(body);

  if (bytes.length > MAX_EXPORT_BYTES)
    throw new StudyError('invalid_input', 'Export exceeds byte limit');

  return {
    versionId: version.id,
    format,
    filename: `material-${version.id}.${format === 'csv' ? 'csv' : 'json'}`,
    mediaType:
      format === 'csv' ? ('text/csv; charset=utf-8' as const) : ('application/json' as const),
    bytes,
    omissions
  };
}
