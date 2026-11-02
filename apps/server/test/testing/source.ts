/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds unregistered acquisition fixtures for lower-level source deletion tests.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates canonical source rows and processing requests without library registration.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Only tests use this fixture; public imports always register library identity atomically. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { ProjectId } from '@study/contracts/ids';
import { sniff } from '@study/contracts/sources/sniff';

import { SourceStore } from '#server/features/sources/store/index';
import { transaction } from '#server/platform/definitions/define-store';

export const createUnregisteredSource = (input: {
  name: string;
  bytes: Uint8Array;
  projectId: ProjectId | null;
}) =>
  transaction((tx) => {
    const requestId = randomUUID();
    const source = tx.store(SourceStore).createSource({
      ...input,
      ...sniff(input.name, input.bytes),
      origin: 'attachment',
      uri: null,
      requestId
    });

    tx.emit({
      type: 'SourceProcessingRequested',
      eventId: randomUUID(),
      causationId: null,
      correlationId: requestId,
      inputVersion: 1,
      depth: 0,
      sourceId: source.id,
      requestId
    });

    return source;
  });
