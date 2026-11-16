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

import { StudyError } from '@study/contracts';
import { materialAidExportSchema, MAX_EXPORT_BYTES } from '@study/contracts';
import type { learningExportFormatSchema, exportOmissionSchema } from '@study/contracts';
import type { materialCitationSchema, MaterialVersionDetailDto } from '@study/contracts';
import { exportBudget } from '@study/server';
import { Schema } from 'effect';

const json = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));

const csvCell = (s: string) =>
  '"' + (/^(?:\s*[=+@-]|[\t\r\n])/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';

function serializeCsv(rows: readonly string[][], provenance: readonly string[]) {
  let body = '';
  let remaining = MAX_EXPORT_BYTES;
  const encoder = new TextEncoder();

  for (const [index, row] of rows.entries()) {
    const metadata = index === 0 ? ['versionId', 'inputs', 'citations'] : provenance;
    const line = [...row, ...metadata].map(csvCell).join(',') + '\r\n';

    remaining -= encoder.encode(line).length;

    if (remaining < 0) throw new StudyError('invalid_input', 'Export exceeds byte limit');

    body += line;
  }

  return body;
}

/** Exports exact canonical material content within the shared byte budget. */
export function serializeMaterialVersion(
  version: MaterialVersionDetailDto,
  format: typeof learningExportFormatSchema.Type,
  citations: readonly (typeof materialCitationSchema.Type)[] = []
) {
  exportBudget().consume({ version, citations });
  const omissions: (typeof exportOmissionSchema.Type)[] = [];
  let body: string;

  if (format === 'aid_json') {
    if (!['quiz', 'flashcards'].includes(version.kind))
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
          'referenceAnswer' in q
            ? q.referenceAnswer
            : json(q.kind === 'ordering' ? q.items : q.kind === 'matching' ? q.pairs : q.choices)
        ])
      ];
    else throw new StudyError('unsupported', 'CSV requires flashcards or quiz content');

    omissions.push({ code: 'csv_structure' });
    body = serializeCsv(rows, [String(version.id), json(version.inputs), json(citations)]);
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
