/** @file Owns acquisition within this feature. */

import type { NoteId, ProjectId, SourceId } from '@study/contracts';
import { StudyError, sniff } from '@study/contracts';
import { Option } from 'effect';

import { SourceStore } from '#server/features/sources/store/index';
import { RecordingImportStore } from '#server/features/sources/store/recording';
import { publicationTransaction, transaction } from '#server/platform/definitions/define-store';
import { validateLink } from '#server/platform/http/index';

import { requested } from './processing-events.ts';

export function sourceAcquisitionOperations() {
  return {
    createSource: (input: { name: string; bytes: Uint8Array; projectId: ProjectId | null }) =>
      transaction((tx) => {
        const requestId = crypto.randomUUID();

        const detected = sniff(input.name, input.bytes);

        const source = tx
          .store(SourceStore)
          .createSource({ ...input, ...detected, origin: 'attachment', uri: null, requestId });

        requested(tx, source.id, 1, requestId);

        return source;
      }),
    addLink: (input: { url: string; projectId: ProjectId | null; name?: string }) =>
      transaction((tx) => {
        const uri = validateLink(input.url);

        const requestId = crypto.randomUUID();

        const source = tx.store(SourceStore).createSource({
          name: input.name ?? uri,
          bytes: new TextEncoder().encode(uri),
          kind: 'link',
          mime: 'text/uri-list',
          origin: 'web',
          projectId: input.projectId,
          uri,
          requestId
        });

        requested(tx, source.id, 1, requestId);

        return source;
      }),
    importRecording: (input: {
      requestId: string;

      projectId: ProjectId | null;

      noteId: NoteId;

      name: string;

      bytes: Uint8Array;

      durationMs: number;
    }) =>
      publicationTransaction((tx) => {
        const imports = tx.store(RecordingImportStore);

        const hash = imports.validateRecordingImport(input);

        const receipt = imports.findRecordingImport(input.requestId);

        if (Option.isSome(receipt)) {
          if (!Buffer.from(receipt.value.hash).equals(Buffer.from(hash)))
            throw new StudyError('invalid_input', 'recording request differs from its receipt');

          const source = tx.store(SourceStore).findSource(receipt.value.sourceId);

          if (Option.isNone(source))
            throw new StudyError('invalid_input', 'recording source was deleted');

          return source.value;
        }

        const source = tx.store(SourceStore).createSource({
          ...input,
          kind: 'audio',
          mime: 'audio/wav',
          origin: 'recording',
          uri: null
        });

        imports.saveRecordingImport({ ...input, sourceId: source.id, hash });

        requested(tx, source.id, 1, input.requestId, input.requestId);

        return source;
      }),
    replaceSource: (input: {
      id: SourceId;

      expectedRevision: number;

      name: string;

      bytes: Uint8Array;
    }) =>
      transaction((tx) => {
        const requestId = crypto.randomUUID();

        const detected = sniff(input.name.trim(), input.bytes);

        const result = tx
          .store(SourceStore)
          .replaceSourceInput({ ...input, ...detected, requestId });

        requested(tx, input.id, result.revision, requestId);

        return result;
      })
  };
}
