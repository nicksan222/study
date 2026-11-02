/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retains guarded canonical Document edits and structural comparisons.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Publishes revisions or retains conflicting rich alternatives atomically.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Materials owns persistence; callers compose synchronous transactions.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { MaterialVersionId } from '@study/contracts/ids';
import * as contract from '@study/contracts/materials/editing';
import {
  materialContentInputSchema,
  materialDetailSchema
} from '@study/contracts/materials/schemas';
import type { materialDocumentSchema } from '@study/contracts/materials/schemas';
import { and, eq, inArray } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { canonicalJson } from '#server/features/materials/decoders/edit-intent';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeDocumentRevisions } from './document-revisions.ts';
import { required } from './reads.ts';
import { materialIntegrity } from './transactions.ts';

type Document = typeof materialDocumentSchema.Type;

type PositionedBlock = { block: Document['blocks'][number]; ordinal: number };

function differenceKind(a: PositionedBlock | undefined, b: PositionedBlock | undefined) {
  if (!a) return 'inserted' as const;

  if (!b) return 'removed' as const;

  const equal = Schema.toEquivalence(contract.documentBlockDifferenceSchema.fields.before);

  if (!equal(a.block, b.block)) return 'changed' as const;

  if (a.ordinal !== b.ordinal) return 'moved' as const;

  return null;
}

/** Structural comparison only: position and exact canonical rich block value, never factual support. */
function documentDifferences(
  before: Document,
  after: Document
): (typeof contract.documentBlockDifferenceSchema.Type)[] {
  const left = new Map(before.blocks.map((block, ordinal) => [block.id, { block, ordinal }]));

  const right = new Map(after.blocks.map((block, ordinal) => [block.id, { block, ordinal }]));

  return [...new Set([...left.keys(), ...right.keys()])].flatMap((id) => {
    const a = left.get(id),
      b = right.get(id);

    const kind = differenceKind(a, b);

    const previous = a ?? { block: null, ordinal: null };

    const next = b ?? { block: null, ordinal: null };

    return kind === null
      ? []
      : [
          {
            kind,
            blockId: id,
            beforeOrdinal: previous.ordinal,
            afterOrdinal: next.ordinal,
            before: previous.block,
            after: next.block
          }
        ];
  });
}

function makeDocumentEditing(resources: StoreResources) {
  const { db } = resources;

  const {
    reads,
    insertVersion,
    publish,
    createMaterial,
    readCitations,
    setCitations,
    documentVersion,
    head
  } = makeDocumentRevisions(resources);

  function editIntent(
    value: typeof contract.saveDocumentInputSchema.Type,
    operation: 'save' | 'undo',
    restoreVersionId: MaterialVersionId | undefined
  ) {
    // Schema codecs retain bigint identity; canonical ordering ignores object property order.
    const encoded =
      operation === 'save'
        ? Schema.encodeSync(
            Schema.fromJsonString(Schema.toCodecJson(contract.saveDocumentInputSchema))
          )(value)
        : Schema.encodeSync(
            Schema.fromJsonString(Schema.toCodecJson(contract.undoDocumentInputSchema))
          )({
            materialId: value.materialId,
            expectedVersionId: value.expectedVersionId,
            undoKey: value.saveKey,
            restoreVersionId: required(restoreVersionId)
          });

    return canonicalJson(encoded);
  }

  function findEditReceipt(
    value: typeof contract.saveDocumentInputSchema.Type,
    operation: 'save' | 'undo',
    intent: string
  ) {
    const previous = db.orm
      .select()
      .from(s.document_edit_receipts)
      .where(
        and(
          eq(s.document_edit_receipts.material_id, value.materialId),
          eq(s.document_edit_receipts.key, value.saveKey)
        )
      )
      .get();

    if (previous) {
      if (previous.operation !== operation || previous.intent !== intent)
        throw new StudyError('invalid_input', 'Edit key already has a different intent');

      return {
        replayed: true,
        outcome: previous.outcome,
        expectedVersionId: previous.expected_version_id,
        currentVersionId: previous.current_version_id,
        submittedVersionId: previous.submitted_version_id
      };
    }
  }

  function editableBase(value: typeof contract.saveDocumentInputSchema.Type) {
    const base = documentVersion(value.expectedVersionId);

    if (base.material_id !== value.materialId || base.status !== 'published')
      throw new StudyError(
        'invalid_input',
        'Expected published Document does not belong to target'
      );

    if (base.creator === 'import')
      throw new StudyError('invalid_input', 'Imported Documents require an authored derivative');

    return base;
  }

  function assertEditingOwnership(value: typeof contract.saveDocumentInputSchema.Type) {
    const submittedIds = value.document.blocks.map((block) => block.id);

    const existingOwners = submittedIds.length
      ? db.orm
          .select({ materialId: s.material_versions.material_id })
          .from(s.blocks)
          .innerJoin(
            s.material_document_versions,
            eq(s.blocks.document_id, s.material_document_versions.document_id)
          )
          .innerJoin(
            s.material_versions,
            eq(s.material_document_versions.version_id, s.material_versions.id)
          )
          .where(inArray(s.blocks.editing_id, submittedIds))
          .all()
      : [];

    if (existingOwners.some((owner) => owner.materialId !== value.materialId))
      throw new StudyError('invalid_input', 'Editing identities belong to another Document');
  }

  function restorationSource(
    base: ReturnType<typeof documentVersion>,
    restoreVersionId: MaterialVersionId | undefined
  ) {
    const source = restoreVersionId === undefined ? base : documentVersion(restoreVersionId);

    if (source.material_id !== base.material_id || source.status !== 'published')
      throw new StudyError('invalid_input', 'Restoration must use published target history');

    return source;
  }

  function relevantInputsUnchanged(base: ReturnType<typeof documentVersion>) {
    return base.inputs.every((id) => {
      // Retirement leaves provenance identities, not live inputs that undo must refresh.
      const retiredVersion = db.orm
        .select()
        .from(s.material_history_members)
        .where(eq(s.material_history_members.version_id, id))
        .get();
      const retiredMaterial = db.orm
        .select()
        .from(s.material_versions)
        .innerJoin(
          s.material_deletion_members,
          eq(s.material_deletion_members.material_id, s.material_versions.material_id)
        )
        .where(eq(s.material_versions.id, id))
        .get();

      if (retiredVersion || retiredMaterial) return true;

      const input = required(reads.readVersion(id));

      return input.material_id === base.material_id || head(input.material_id).id === id;
    });
  }

  function save(
    value: typeof contract.saveDocumentInputSchema.Type,
    operation: 'save' | 'undo' = 'save',
    restoreVersionId?: MaterialVersionId
  ) {
    return materialIntegrity(() => {
      const intent = editIntent(value, operation, restoreVersionId);

      const previous = findEditReceipt(value, operation, intent);

      if (previous) return previous;

      const base = editableBase(value);

      if (operation === 'save') assertEditingOwnership(value);

      const current = head(value.materialId);

      const source = restorationSource(base, restoreVersionId);

      const inputs = source.inputs;

      const content = Schema.decodeUnknownSync(materialContentInputSchema)({
        kind: 'document',
        ...value.document
      });

      const submittedVersionId = insertVersion(
        value.materialId,
        {
          content,
          operation: 'edit',
          parents: [...new Set([base.id, source.id])],
          inputs,
          language: source.language,
          publish: false
        },
        undefined,
        source.id
      );

      setCitations({ id: submittedVersionId, citations: readCitations(source.id) }, source.id);

      const relevantUnchanged = operation !== 'undo' || relevantInputsUnchanged(base);
      const outcome =
        current.id === base.id && relevantUnchanged ? ('saved' as const) : ('conflict' as const);

      if (outcome === 'saved') publish(submittedVersionId, false, source.id);

      db.orm
        .insert(s.document_edit_receipts)
        .values({
          material_id: value.materialId,
          key: value.saveKey,
          operation,
          intent,
          expected_version_id: base.id,
          current_version_id: current.id,
          submitted_version_id: submittedVersionId,
          outcome
        })
        .run();

      return {
        replayed: false,
        outcome,
        expectedVersionId: base.id,
        currentVersionId: current.id,
        submittedVersionId
      };
    });
  }

  return {
    create: (value: typeof contract.createManualDocumentSchema.Type) =>
      materialIntegrity(() => {
        const ids = value.document.blocks.map((block) => block.id);

        if (
          ids.length &&
          db.orm.select().from(s.blocks).where(inArray(s.blocks.editing_id, ids)).get()
        )
          throw new StudyError(
            'invalid_input',
            'Independent Document blocks require fresh identities'
          );

        const input =
          value.inputVersionId === undefined
            ? undefined
            : required(reads.readVersion(value.inputVersionId));

        const result = createMaterial({
          title: value.title,
          content: { kind: 'document', ...value.document },
          inputs: input === undefined ? [] : [...new Set([input.id, ...input.inputs])],
          projectId: value.projectId,
          sessionId: value.sessionId,
          operation: input === undefined ? 'original' : 'edit',
          publish: false
        });

        if (input) setCitations({ id: result.version.id, citations: readCitations(input.id) });

        publish(result.version.id);

        return required(reads.readMaterial(result.id));
      }),
    save,
    undo: (value: typeof contract.undoDocumentInputSchema.Type) =>
      save(
        {
          materialId: value.materialId,
          expectedVersionId: value.expectedVersionId,
          saveKey: value.undoKey,
          document: documentVersion(value.restoreVersionId).content
        },
        'undo',
        value.restoreVersionId
      ),
    compare: (value: typeof contract.compareDocumentInputSchema.Type) => {
      const before = documentVersion(value.beforeVersionId),
        proposed = documentVersion(value.proposedVersionId),
        current = documentVersion(value.currentVersionId);

      if (new Set([before.material_id, proposed.material_id, current.material_id]).size !== 1)
        throw new StudyError('invalid_input', 'Comparison versions must belong to one Document');

      return {
        ...value,
        before,
        proposed,
        current,
        proposedChanges: documentDifferences(before.content, proposed.content),
        currentChanges: documentDifferences(before.content, current.content),
        evidence: 'structural_only' as const
      };
    }
  };
}

export const DocumentEditingStore = defineStore({
  name: 'study/DocumentEditingStore',
  entity: { singular: 'documentComparison', plural: 'documentComparisons' },
  make: (resources) => {
    const editing = makeDocumentEditing(resources);

    return {
      queries: {
        documentComparison: storeQuery({
          role: 'required',
          input: contract.compareDocumentInputSchema,
          output: contract.documentComparisonSchema,
          run: editing.compare
        })
      },
      mutations: {
        createManualDocument: storeMutation({
          input: contract.createManualDocumentSchema,
          output: materialDetailSchema,
          run: editing.create
        }),
        saveDocument: storeMutation({
          input: contract.saveDocumentInputSchema,
          output: contract.documentEditOutcomeSchema,
          run: editing.save
        }),
        undoDocument: storeMutation({
          input: contract.undoDocumentInputSchema,
          output: contract.documentEditOutcomeSchema,
          run: editing.undo
        })
      }
    };
  }
});
