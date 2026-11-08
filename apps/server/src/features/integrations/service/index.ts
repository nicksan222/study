/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates provider plans and durable external content import operations.         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Stages validated inputs and controls import lifecycle.                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Publication uses existing feature services within the same database transaction.         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { ErrorKind } from '@study/contracts/errors';
import {
  integrationImportIdSchema,
  previewIntegrationInputSchema
} from '@study/contracts/integrations/schemas';
import type {
  integrationImportKeySchema,
  integrationImportSchema,
  startIntegrationImportSchema
} from '@study/contracts/integrations/schemas';
import { integrationProvider, integrationProviders } from '@study/integrations';
import { Effect, Schema } from 'effect';

import { IntegrationImportsStore } from '#server/features/integrations/store/index';
import { defineService } from '#server/platform/definitions/define-service';
import {
  transaction,
  publicationTransaction,
  useStore
} from '#server/platform/definitions/define-store';
import type { Transaction } from '#server/platform/definitions/define-store';

import { publishImportItem, reserveImport, importFingerprints } from './publication.ts';

type State = typeof integrationImportSchema.Type;

type Key = typeof integrationImportKeySchema.Type;

type Attempt = Key & { attempt: number };

function requestImport(tx: Transaction, state: State) {
  tx.store(IntegrationImportsStore).progress(state);
  const eventId = randomUUID();

  tx.emit({
    type: 'IntegrationImportRequested',
    eventId,
    causationId: null,
    correlationId: state.id,
    inputVersion: state.attempt,
    depth: 0,
    importId: state.id,
    attempt: state.attempt
  });

  return state;
}

function advanceImport(tx: Transaction, input: Attempt, change: (state: State) => State) {
  const state = tx.store(IntegrationImportsStore).integrationImport(input.id);

  if (state.status !== 'running' || state.attempt !== input.attempt) return state;

  const next = change(state);

  tx.store(IntegrationImportsStore).progress(next);

  return next;
}

function beginImport(tx: Transaction, input: typeof startIntegrationImportSchema.Type) {
  const state = tx.store(IntegrationImportsStore).integrationImport(input.id);
  const excluded = new Set(input.excludedKeys);

  if (input.excludedKeys.some((key) => !state.items.some((item) => item.key === key)))
    throw new StudyError('invalid_input', 'Unknown excluded import item');

  if (state.status !== 'preview') {
    const sameSelection = state.items.every(
      (item) => (item.status === 'excluded') === excluded.has(item.key)
    );

    if (state.projectId !== (input.projectId ?? null) || !sameSelection)
      throw new StudyError('invalid_input', 'Import request differs from its receipt');

    return state;
  }

  return requestImport(tx, {
    ...state,
    projectId: input.projectId ?? null,
    attempt: 1,
    status: 'running',
    items: state.items.map((item) =>
      excluded.has(item.key) ? { ...item, status: 'excluded' } : item
    )
  });
}

export const Integrations = defineService('study/Integrations', function* () {
  const imports = yield* useStore(IntegrationImportsStore);

  return {
    providers: () => Effect.sync(integrationProviders),
    previewImport: Effect.fnUntraced(function* (input: typeof previewIntegrationInputSchema.Type) {
      const parsed = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(previewIntegrationInputSchema)(input),
        catch: (cause) => new StudyError('invalid_input', 'Invalid integration import', { cause })
      });
      const plan = yield* Effect.try({
        try: () => {
          const capability = integrationProvider(parsed.providerId).capabilities.import;

          if (!capability) throw new StudyError('unsupported', 'Provider does not support import');

          return capability.plan(parsed);
        },
        catch: (cause) =>
          cause instanceof StudyError
            ? cause
            : new StudyError('invalid_input', 'Invalid integration content', { cause })
      });
      const state: State = {
        id: Schema.decodeUnknownSync(integrationImportIdSchema)(randomUUID()),
        providerId: parsed.providerId,
        sourceKey: parsed.sourceKey,
        status: 'preview',
        projectId: null,
        attempt: 0,
        warnings: plan.warnings,
        errorKind: null,
        items: plan.notes.map((note) => ({
          key: note.key,
          title: note.title,
          status: 'pending',
          noteId: null,
          errorKind: null
        }))
      };

      const fingerprints = importFingerprints(plan);

      yield* transaction((tx) =>
        tx.store(IntegrationImportsStore).stage({ state, plan, fingerprints })
      );

      return state;
    }),
    import: (input: Key) => imports.integrationImport(input.id),
    imports: (input: { limit: number }) => imports.integrationImports(input),
    startImport: (input: typeof startIntegrationImportSchema.Type) =>
      transaction((tx) => beginImport(tx, input)),
    cancelImport: (input: Key) =>
      transaction((tx) => {
        const state = tx.store(IntegrationImportsStore).integrationImport(input.id);
        const next: State = ['preview', 'running', 'failed'].includes(state.status)
          ? { ...state, status: 'cancelled' }
          : state;

        tx.store(IntegrationImportsStore).progress(next);

        return next;
      }),
    retryImport: (input: Key) =>
      transaction((tx) => {
        const state = tx.store(IntegrationImportsStore).integrationImport(input.id);

        if ((state.status !== 'failed' && state.status !== 'cancelled') || state.attempt === 0)
          throw new StudyError('invalid_input', 'Import is not retryable');

        return requestImport(tx, {
          ...state,
          status: 'running',
          errorKind: null,
          attempt: state.attempt + 1,
          items: state.items.map((item) =>
            item.status === 'failed' ? { ...item, status: 'pending', errorKind: null } : item
          )
        });
      }),
    reserveImport: (input: Attempt) =>
      publicationTransaction((tx) => advanceImport(tx, input, (state) => reserveImport(tx, state))),
    publishImportItem: (input: Attempt & { key: string }) =>
      publicationTransaction((tx) =>
        advanceImport(tx, input, (state) => publishImportItem(tx, state, input.key))
      ),
    settleImport: (input: Attempt & { errorKind: ErrorKind | null; key?: string }) =>
      publicationTransaction((tx) => {
        const state = tx.store(IntegrationImportsStore).integrationImport(input.id);

        if (state.status !== 'running' || state.attempt !== input.attempt) return state;

        const next: State = {
          ...state,
          status: input.errorKind ? 'failed' : 'completed',
          errorKind: input.errorKind,
          items: state.items.map((item) =>
            item.key === input.key
              ? { ...item, status: 'failed', errorKind: input.errorKind }
              : item
          )
        };

        tx.store(IntegrationImportsStore).progress(next);

        return next;
      })
  };
});
