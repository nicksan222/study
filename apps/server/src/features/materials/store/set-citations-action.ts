/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Replaces the citation links associated with a material version.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Replaces citation rows atomically for the selected version.                            │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { setCitationsInputSchema } from '@study/contracts/materials/rpc';
import { validDocumentTextRange } from '@study/contracts/sources/document';
import { documentTextRangeSchema } from '@study/contracts/sources/schemas';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { makeReads } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeCitations } from './citations.ts';

type Input = typeof setCitationsInputSchema.Type;

const targetCodec = Schema.fromJsonString(Schema.toCodecJson(documentTextRangeSchema));

export function makeSetCitationsAction(resources: StoreResources) {
  const { db: store } = resources;
  const { readCitations } = makeCitations(resources);
  const { versionRow, versionDocumentId, readCanonicalDocument } = makeReads(resources);
  const setCitations = (input: Input) =>
    materialIntegrity(() => {
      versionRow(input.id, true);
      const db = store.orm;
      const inputs = db
        .select()
        .from(s.material_version_inputs)
        .where(eq(s.material_version_inputs.version_id, input.id))
        .all();

      if (
        new Set(input.citations.map((citation) => citation.marker)).size !==
          input.citations.length ||
        input.citations.some(
          (citation) => !inputs.some((row) => row.input_version_id === citation.inputVersionId)
        )
      )
        throw new StudyError(
          'invalid_input',
          'Citations must refer to declared input versions with distinct markers'
        );

      db.delete(s.material_version_citations)
        .where(eq(s.material_version_citations.version_id, input.id))
        .run();

      for (const citation of input.citations) {
        versionRow(citation.inputVersionId);

        if (citation.target) {
          const documentId = versionDocumentId(citation.inputVersionId);

          if (documentId === null)
            throw new StudyError('invalid_input', 'Citation Document is unavailable');

          const document = readCanonicalDocument(documentId);
          const target = citation.target;
          const block = document.blocks.find((item) => item.id === target.blockId);

          if (
            !validDocumentTextRange(
              document,
              { versionId: citation.inputVersionId, documentId },
              target
            ) ||
            !block?.text.slice(target.start, target.end).includes(citation.quote)
          )
            throw new StudyError('invalid_input', 'Citation target does not match input evidence');
        }

        db.insert(s.material_version_citations)
          .values({
            version_id: input.id,
            marker: citation.marker,
            input_version_id: citation.inputVersionId,
            anchor: JSON.stringify(citation.anchor),
            target:
              citation.target === undefined
                ? null
                : Schema.encodeSync(targetCodec)(citation.target),
            quote: citation.quote
          })
          .run();
      }

      return readCitations(input.id);
    });

  return { setCitations };
}
