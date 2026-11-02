import type { MaterialId, MaterialVersionId } from '@study/contracts/ids';
import type {
  evidenceReferenceSchema,
  evidenceTargetSchema
} from '@study/contracts/materials/evidence';
import { validDocumentTextRange } from '@study/contracts/sources/document';
import { queryOptions } from '@tanstack/react-query';

import { request } from '../../lib/study-client/request';

type Target = typeof evidenceTargetSchema.Type;

export const annotationDocumentOptions = (materialId: MaterialId, version: MaterialVersionId) =>
  queryOptions({
    queryKey: ['materials', 'annotationDocument', String(materialId), String(version)],
    queryFn: async ({ signal }) => {
      const owner = await request(
        (rpc) => rpc['materials.materialVersion']({ id: version }),
        signal
      );

      if (owner.material_id !== materialId) return null;

      return request((rpc) => rpc['materials.materialVersionDocument']({ id: version }), signal);
    }
  });

export const resolvedEvidenceOptions = (
  reference: typeof evidenceReferenceSchema.Type,
  open: boolean
) =>
  queryOptions({
    queryKey: [
      'materials',
      'resolvedEvidence',
      reference.kind === 'range'
        ? [
            reference.target.materialId,
            reference.target.range.versionId,
            reference.target.range.documentId,
            reference.target.range.blockId,
            reference.target.range.start,
            reference.target.range.end
          ].join(':')
        : [reference.versionId, JSON.stringify(reference.anchor), reference.quote].join(':')
    ],
    enabled: open,
    queryFn: ({ signal }) => request((rpc) => rpc['materials.resolveEvidence'](reference), signal)
  });

export const retainedRangeOptions = (target: Target) =>
  queryOptions({
    queryKey: [
      'materials',
      'retainedRange',
      [
        target.materialId,
        target.range.versionId,
        target.range.documentId,
        target.range.blockId,
        target.range.start,
        target.range.end
      ].join(':')
    ],
    queryFn: async ({ signal }) => {
      const owner = await request(
        (rpc) => rpc['materials.materialVersion']({ id: target.range.versionId }),
        signal
      );

      if (owner.material_id !== target.materialId) return null;

      const value = await request(
        (rpc) => rpc['materials.materialVersionDocument']({ id: target.range.versionId }),
        signal
      );

      if (
        !validDocumentTextRange(
          value.document,
          { versionId: target.range.versionId, documentId: value.id },
          target.range
        )
      )
        return null;

      return value.document.blocks.find((block) => block.id === target.range.blockId)?.text ?? null;
    }
  });
