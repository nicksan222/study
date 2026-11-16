/** @file Owns library within this feature. */

import type * as input from '@study/contracts';

import {
  MaterialCitationsStore,
  MaterialVersionsStore,
  MaterialsStore
} from '#server/features/materials/store/index';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { assertContentCitation, assertContentInputs } from './content-inputs.ts';
import { published } from './publication.ts';

export function* materialLibraryOperations() {
  const materials = yield* useStore(MaterialsStore),
    versions = yield* useStore(MaterialVersionsStore),
    citations = yield* useStore(MaterialCitationsStore);

  return {
    material: materials.material,
    findMaterial: materials.findMaterial,
    materials: materials.materials,
    count: materials.count,
    materialVersion: versions.materialVersion,
    findMaterialVersion: versions.findMaterialVersion,
    materialVersions: versions.materialVersions,
    citations: citations.citations,
    create: (value: typeof input.createInputSchema.Type) =>
      transaction((tx) => {
        assertContentInputs(tx, value.inputs ?? [], value.projectId);
        const result = tx.store(MaterialsStore).create(value);

        published(tx, result.version);

        return result;
      }),
    createVersion: (value: typeof input.createVersionInputSchema.Type) =>
      transaction((tx) => {
        assertContentInputs(tx, value.inputs ?? []);
        const result = tx.store(MaterialsStore).createVersion(value);

        published(tx, result);

        return result;
      }),
    archive: (value: typeof input.archiveInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).archive(value);

        return result;
      }),
    unarchive: (value: typeof input.unarchiveInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).unarchive(value);

        return result;
      }),
    updateDescription: (value: typeof input.updateDescriptionInputSchema.Type) =>
      transaction((tx) => tx.store(MaterialsStore).updateDescription(value)),
    rename: (value: typeof input.renameInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).rename(value);

        return result;
      }),
    deleteDraft: (value: typeof input.deleteDraftInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).deleteDraft(value);

        return result;
      }),
    publishVersion: (value: typeof input.publishVersionInputSchema.Type) =>
      transaction((tx) => {
        const pending = tx.store(MaterialVersionsStore).materialVersion({ id: value.id });

        assertContentInputs(tx, pending.inputs);
        const result = tx.store(MaterialsStore).publishVersion(value);

        published(tx, result);

        return result;
      }),
    replaceDraft: (value: typeof input.replaceDraftInputSchema.Type) =>
      transaction((tx) => {
        assertContentInputs(tx, value.inputs ?? []);
        const result = tx.store(MaterialsStore).replaceDraft(value);

        return result;
      }),
    setCitations: (value: typeof input.setCitationsInputSchema.Type) =>
      transaction((tx) => {
        for (const citation of value.citations) assertContentCitation(tx, citation);

        const result = tx.store(MaterialsStore).setCitations(value);

        return result;
      }),
    attach: (value: typeof input.attachInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).attach(value);

        return result;
      }),
    detach: (value: typeof input.detachInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).detach(value);

        return result;
      }),
    reorder: (value: typeof input.reorderInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(MaterialsStore).reorder(value);

        return result;
      })
  };
}
