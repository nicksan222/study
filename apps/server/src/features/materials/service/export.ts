/** @file Owns export within this feature. */

import type { exportMaterialVersionInputSchema } from '@study/contracts';

import { MaterialExportCitationsStore } from '#server/features/materials/store/export';
import { MaterialVersionsStore } from '#server/features/materials/store/index';
import { exportBudget } from '#server/platform/content-export/budget';
import { transaction } from '#server/platform/definitions/define-store';

import { serializeMaterialVersion } from './export-serializer.ts';

export function materialExportOperations() {
  return {
    exportMaterialVersion: (value: typeof exportMaterialVersionInputSchema.Type) =>
      transaction((tx) => {
        const version = tx.store(MaterialVersionsStore).materialVersion({ id: value.id });

        exportBudget().consume(version);
        const budget = exportBudget();

        budget.consume({ version, citations: [] });
        const exportedCitations = tx.store(MaterialExportCitationsStore).exportCitationSnapshot({
          id: value.id,
          budget: budget.remaining()
        }).citations;

        return serializeMaterialVersion(version, value.format, exportedCitations);
      })
  };
}
