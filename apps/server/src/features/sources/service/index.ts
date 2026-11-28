/** @file Composes sources application operations behind the feature boundary. */

import type {
  ProjectId,
  SourceId,
  exactExtractionInputSchema,
  sourceLinkSchema
} from '@study/contracts';
import { sniff } from '@study/contracts';
import { defineService } from '@study/server';
import type { Transaction } from '@study/server';
import { Option } from 'effect';

import { decodeText } from '#server/features/sources/decoders/text';
import { conversions } from '#server/features/sources/service/conversion/strategies';
import { SourceBackupStore } from '#server/features/sources/store/backup';
import {
  CurrentExtractionStore,
  NoteSourcesStore,
  SourceExtractionsStore
} from '#server/features/sources/store/exact-extraction';
import { SourceStore } from '#server/features/sources/store/index';

import { sourceAcquisitionOperations } from './acquisition.ts';
import { sourceCapabilityOperations } from './capabilities.ts';
import { sourceDeletionOperations } from './deletion.ts';
import { sourceHistoryOperations } from './history.ts';
import { sourceLibraryOperations } from './library.ts';
import { sourceProcessingOperations } from './processing.ts';

export const Sources = defineService(
  'study/Sources',
  function* () {
    return {
      ...sourceCapabilityOperations(),
      ...(yield* sourceLibraryOperations()),
      ...sourceAcquisitionOperations(),
      ...(yield* sourceHistoryOperations()),
      ...sourceDeletionOperations(),
      ...sourceProcessingOperations()
    };
  },
  {
    decodeImportedMarkdown: (bytes: Uint8Array) =>
      decodeText({ bytes, kind: 'text', mime: 'text/markdown' }),
    createImportedInTransaction: (
      tx: Transaction,
      input: { name: string; bytes: Uint8Array; projectId: ProjectId | null }
    ) => {
      const requestId = crypto.randomUUID();
      const detected = sniff(input.name, input.bytes);
      const source = tx
        .store(SourceStore)
        .createSource({ ...input, ...detected, origin: 'import', uri: null, requestId });

      tx.emit({
        type: 'SourceProcessingRequested',
        eventId: crypto.randomUUID(),
        causationId: null,
        correlationId: requestId,
        inputVersion: 1,
        depth: 0,
        sourceId: source.id,
        requestId
      });

      return source;
    },
    currentExtractionInTransaction: (tx: Transaction, id: SourceId) => {
      tx.store(SourceStore).source(id);

      return Option.getOrNull(tx.store(CurrentExtractionStore).findCurrentExtraction({ id }));
    },
    belongsToProjectInTransaction: (tx: Transaction, id: SourceId, projectId: ProjectId) =>
      tx.store(SourceStore).belongsToProject({ id, projectId }),
    sourceInTransaction: (tx: Transaction, id: SourceId) => tx.store(SourceStore).source(id),
    extractionInTransaction: (tx: Transaction, v: typeof exactExtractionInputSchema.Type) => {
      tx.store(SourceStore).source(v.sourceId);

      return tx.store(SourceExtractionsStore).extraction(v);
    },
    archiveNoteInTransaction: (
      tx: Transaction,
      v: typeof sourceLinkSchema.Type & { archivedAt: bigint | null }
    ) => tx.store(NoteSourcesStore).archiveNote(v),
    conversionStrategy: conversions.describe,
    conversionStrategyForInput: conversions.forInput,
    attachInTransaction: (tx: Transaction, v: typeof sourceLinkSchema.Type) => {
      tx.store(SourceStore).source(v.sourceId);
      tx.store(NoteSourcesStore).attachSource(v);
    },
    validateBackup: (tx: Transaction) => tx.store(SourceBackupStore).backupAsset(undefined)
  }
);
