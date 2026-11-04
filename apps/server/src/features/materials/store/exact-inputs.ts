import { StudyError } from '@study/contracts/errors';
import type { MaterialVersionId } from '@study/contracts/ids';
/** Learning-owned exact references; canonical bodies stay with Documents and Sources. */
import { contentInputKey, contentInputSchema } from '@study/contracts/inputs';
import type { ContentInput } from '@study/contracts/inputs';
import { learningCitationSchema } from '@study/contracts/materials/inputs';
import { and, asc, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { contentInputColumns } from '#server/platform/database/content-input';
import type { StoreResources } from '#server/platform/definitions/define-store';

const citationCodec = Schema.fromJsonString(Schema.toCodecJson(learningCitationSchema));
type Owner = { kind: 'version'; id: MaterialVersionId } | { kind: 'request'; id: string };
function materialInputValue(row: typeof s.material_evidence_inputs.$inferSelect): ContentInput {
  return Schema.decodeUnknownSync(contentInputSchema)(
    row.document_version_id !== null
      ? { kind: 'document', versionId: row.document_version_id }
      : {
          kind: 'source',
          sourceId: row.source_id,
          revision: row.source_revision,
          snapshotId: row.source_snapshot_id
        }
  );
}
export function makeExactInputs({ db }: StoreResources) {
  const orm = db.orm;
  function ownerFilter(owner: Owner) {
    return owner.kind === 'version'
      ? eq(s.material_evidence_inputs.version_id, owner.id)
      : eq(s.material_evidence_inputs.request_id, owner.id);
  }
  function rows(owner: Owner) {
    return orm
      .select()
      .from(s.material_evidence_inputs)
      .where(ownerFilter(owner))
      .orderBy(asc(s.material_evidence_inputs.position))
      .all();
  }
  function inputs(owner: Owner) {
    return rows(owner).map(materialInputValue);
  }
  function insertInputs(owner: Owner, references: readonly ContentInput[]) {
    if (new Set(references.map(contentInputKey)).size !== references.length)
      throw new StudyError('invalid_input', 'Duplicate exact learning inputs');
    for (const [position, input] of references.entries())
      orm
        .insert(s.material_evidence_inputs)
        .values({
          version_id: owner.kind === 'version' ? owner.id : null,
          request_id: owner.kind === 'request' ? owner.id : null,
          position: BigInt(position),
          ...contentInputColumns(input)
        })
        .run();
  }
  function citationValue(row: typeof s.material_evidence_citations.$inferSelect) {
    const reference = orm
      .select()
      .from(s.material_evidence_inputs)
      .where(
        and(
          eq(s.material_evidence_inputs.id, row.input_id),
          eq(s.material_evidence_inputs.version_id, row.version_id)
        )
      )
      .get();
    if (!reference)
      throw new StudyError('not_found', 'Exact learning citation input is unavailable');
    return Schema.decodeUnknownSync(learningCitationSchema)({
      marker: row.marker,
      input: materialInputValue(reference),
      anchor: JSON.parse(row.anchor),
      target: row.target === null ? undefined : JSON.parse(row.target),
      quote: row.quote
    });
  }
  function citations(versionId: MaterialVersionId) {
    return orm
      .select()
      .from(s.material_evidence_citations)
      .where(eq(s.material_evidence_citations.version_id, versionId))
      .orderBy(asc(s.material_evidence_citations.marker))
      .all()
      .map(citationValue);
  }
  function replaceCitations(
    versionId: MaterialVersionId,
    values: readonly (typeof learningCitationSchema.Type)[]
  ) {
    const references = new Map(
      rows({ kind: 'version', id: versionId }).map((row) => [
        contentInputKey(materialInputValue(row)),
        row.id
      ])
    );
    if (new Set(values.map((value) => value.marker)).size !== values.length)
      throw new StudyError('invalid_input', 'Duplicate learning citation markers');
    orm
      .delete(s.material_evidence_citations)
      .where(eq(s.material_evidence_citations.version_id, versionId))
      .run();
    for (const value of values) {
      const inputId = references.get(contentInputKey(value.input));
      if (inputId === undefined)
        throw new StudyError('invalid_input', 'Citation is outside exact learning inputs');
      const encoded = JSON.parse(Schema.encodeSync(citationCodec)(value));
      orm
        .insert(s.material_evidence_citations)
        .values({
          version_id: versionId,
          marker: value.marker,
          input_id: inputId,
          anchor: JSON.stringify(encoded.anchor),
          target: value.target === undefined ? null : JSON.stringify(encoded.target),
          quote: value.quote
        })
        .run();
    }
    return citations(versionId);
  }
  function releaseInputs(owner: Owner) {
    orm.delete(s.material_evidence_inputs).where(ownerFilter(owner)).run();
  }
  return { rows, inputs, insertInputs, citations, replaceCitations, releaseInputs, citationValue };
}
