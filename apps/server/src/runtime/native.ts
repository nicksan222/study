/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes feature services, RPC handlers, AI capabilities, and durable workflow     │
 * │ layers for one application. This runtime wiring injects shared SQLite and authentication │
 * │ owners while feature behavior remains in feature services.                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports nativeLayers. This runtime wiring injects shared SQLite and authentication     │
 * │   owners while feature behavior remains in feature services.                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Receives feature-owned layers, ServerContext, AuthManager, and lifecycle controls; this  │
 * │ composition supplies dependencies without moving feature policy.                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import {
  AiAdmission,
  admissionLayer,
  makeAdmission,
  withAdmissionSettings,
  Agents,
  ChatGptSession,
  createApiKeyModel,
  createChatGptModel,
  getApiKeyProvider,
  BackupStorage,
  ManagedBackups,
  ModelUpdateNotices,
  Database,
  liveQueriesLayer,
  transaction,
  normalizeError,
  recordAiTokens,
  recordUsageFailure,
  UsageStore,
  observeAgentProgress,
  WorkflowConfiguration,
  WorkflowControl,
  workflowEngineLayer,
  WorkerLifecycle
} from '@study/server';
import type { AuthManager, ServerContext, AiRuntimeAdapters } from '@study/server';
import { VoiceRuntime } from '@study/server';
import type { VoiceRuntimeAdapters } from '@study/server';
import { CryptoHasher } from 'bun';
import { Effect, Layer, Logger } from 'effect';

import { AuthRpcLive } from '#server/features/auth/rpc/index';
import { Auth } from '#server/features/auth/service/index';
import { Integrations } from '#server/features/integrations/index';
import { IntegrationsRpcLive } from '#server/features/integrations/rpc/index';
import { Learning } from '#server/features/learning/index';
import { LearningRpcLive } from '#server/features/learning/rpc/index';
import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { Notes } from '#server/features/notes/index';
import { NotesRpcLive } from '#server/features/notes/rpc/index';
import { Pages } from '#server/features/pages/index';
import { PagesRpcLive } from '#server/features/pages/rpc/index';
import { ProjectsRpcLive } from '#server/features/projects/rpc/index';
import { Projects } from '#server/features/projects/service/index';
import { Recordings } from '#server/features/recordings/index';
import { RecordingsRpcLive } from '#server/features/recordings/rpc/index';
import { SettingsRpcLive } from '#server/features/settings/rpc/index';
import { Settings } from '#server/features/settings/service/index';
import { SourcesRpcLive } from '#server/features/sources/rpc/index';
import { Sources } from '#server/features/sources/service/index';
import { System } from '#server/features/system/index';
import { SystemRpcLive } from '#server/features/system/rpc/index';
import { Themes } from '#server/features/themes/index';
import { ThemesRpcLive } from '#server/features/themes/rpc/index';
import { Voice } from '#server/features/voice/index';
import { VoiceRpcLive } from '#server/features/voice/rpc/index';
import { Workflows } from '#server/features/workflows/index';
import { WorkflowsRpcLive } from '#server/features/workflows/rpc/index';

import { backupPolicy } from './backups.ts';
import { workflowHandlers } from './workflows.ts';

export type NativeOptions = {
  fetch?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
  ai?: AiRuntimeAdapters;
  voice?: VoiceRuntimeAdapters;
  modelUpdateNotices?: boolean;
};

export function nativeLayers(
  store: ServerContext,
  manager: AuthManager,
  issuer: string,
  hostId: string | undefined,
  lifecycle: WorkerLifecycle['Service'],
  control: WorkflowControl['Service'],
  { fetch: request, ai, voice = {}, modelUpdateNotices = true }: NativeOptions
) {
  const admission = admissionLayer(makeAdmission());

  const database = Layer.succeed(Database, { store });

  const backupOwner = new ManagedBackups(store.db, backupPolicy, store.timestampClock);

  const backups = Layer.succeed(BackupStorage, { owner: backupOwner });

  const lifecycleLayer = Layer.succeed(WorkerLifecycle, lifecycle);

  const session = Layer.succeed(ChatGptSession, { manager, issuer, hostId, request });

  const services = Layer.mergeAll(
    Voice.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Settings.layer,
          Layer.succeed(VoiceRuntime, {
            ...voice,
            directory: store.db.path === ':memory:' ? undefined : `${store.db.path}.voice`
          })
        )
      )
    ),
    Sources.layer,
    Workflows.layer,
    Recordings.layer,
    Materials.layer,
    Pages.layer,
    Integrations.layer,
    Materials.deletionParticipantsLayer({ Learning }),
    Notes.mergeMaterialsLayer(Materials.attachInTransaction),
    Notes.layer,
    Learning.layer.pipe(Layer.provide(Layer.mergeAll(Settings.layer, Materials.layer))),
    Projects.layer,
    Settings.layer,
    Themes.layer,
    System.layer
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        database,
        backups,
        session,
        Layer.succeed(ModelUpdateNotices, modelUpdateNotices),
        lifecycleLayer,
        Layer.succeed(WorkflowControl, control)
      )
    )
  );

  const auth = Auth.layer.pipe(Layer.provide(Layer.mergeAll(database, session)));

  const allServices = Layer.mergeAll(services, auth);

  const configuration = Layer.effect(
    WorkflowConfiguration,
    Effect.gen(function* () {
      const settings = yield* Settings;

      const account = yield* Auth;

      return {
        revision: Effect.gen(function* () {
          const llm = yield* settings.llmSettings();

          const publicAccount = yield* account.publicAccount();

          const credentialGeneration = yield* account.credentialGeneration();

          return new CryptoHasher('sha256')
            .update(JSON.stringify({ llm, publicAccount, credentialGeneration }))
            .digest('hex');
        })
      };
    })
  ).pipe(Layer.provide(allServices));

  const agents = Layer.effect(
    Agents,
    Effect.gen(function* () {
      const settings = yield* Settings;
      const auth = yield* Auth;

      const aiAdmission = yield* AiAdmission;

      return {
        observe: observeAgentProgress(store),
        now: () => store.timestampClock.currentTimeMillisUnsafe(),
        recordUsage: (record) =>
          transaction((tx) => tx.store(UsageStore).record(record)).pipe(
            Effect.provideService(Database, { store }),
            Effect.andThen(recordAiTokens(record)),
            Effect.catchCause(() => recordUsageFailure())
          ),
        admission: withAdmissionSettings(aiAdmission, settings.concurrencySettings()),
        language: settings.language(),
        rules: settings.agentRules(),
        executeTool: ai?.executeTool,
        model: (tier, call) =>
          ai?.model
            ? ai.model(tier, call).pipe(Effect.mapError(normalizeError))
            : settings.model(tier, call.definition.requiredProvider).pipe(
                Effect.flatMap((selection): ReturnType<Agents['Service']['model']> =>
                  typeof selection.provider === 'string'
                    ? Effect.sync(() =>
                        createApiKeyModel(
                          getApiKeyProvider(selection.provider),
                          selection.modelId,
                          auth.apiKey(selection.provider),
                          request
                        )
                      )
                    : Effect.try({
                        try: () =>
                          createChatGptModel({
                            auth: manager.credentials(),
                            modelId: selection.modelId,
                            fetch: request
                          }),
                        catch: normalizeError
                      })
                )
              ),
        searchSources: () =>
          Effect.fail(new StudyError('unsupported', 'Source search is not configured'))
      };
    })
  ).pipe(Layer.provide(Layer.mergeAll(allServices, admission)));

  const shared = Layer.mergeAll(allServices, session, agents, configuration, admission).pipe(
    Layer.provideMerge(Layer.succeed(Logger.LogToStderr, true))
  );

  const handlers = Layer.mergeAll(
    VoiceRpcLive,
    SourcesRpcLive,
    WorkflowsRpcLive,
    RecordingsRpcLive,
    MaterialsRpcLive,
    PagesRpcLive,
    IntegrationsRpcLive,
    NotesRpcLive,
    LearningRpcLive,
    ProjectsRpcLive,
    SettingsRpcLive,
    AuthRpcLive,
    ThemesRpcLive,
    SystemRpcLive
  ).pipe(Layer.provide(liveQueriesLayer().pipe(Layer.provide(database))));

  const workflows = workflowHandlers.pipe(Layer.provideMerge(workflowEngineLayer(store)));

  return { handlers, services: shared, workflows, backups: backupOwner };
}
