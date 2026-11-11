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

import { StudyError } from '@study/contracts/errors';
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
import { Workflows } from '#server/features/workflows/index';
import { WorkflowsRpcLive } from '#server/features/workflows/rpc/index';
import {
  AiAdmission,
  admissionLayer,
  makeAdmission,
  withAdmissionSettings
} from '#server/platform/ai/admission';
import { Agents } from '#server/platform/ai/agents';
import type { AuthManager } from '#server/platform/ai/auth/index';
import { ChatGptSession } from '#server/platform/ai/auth/service';
import { createApiKeyModel } from '#server/platform/ai/providers/api-key-model';
import { createChatGptModel } from '#server/platform/ai/providers/chatgpt/model';
import { getApiKeyProvider } from '#server/platform/ai/providers/registry';
import { adaptCredentialReader } from '#server/platform/ai/tool-adapter';
import { BackupStorage, ManagedBackups } from '#server/platform/database/backups';
import type { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';
import { recordAiTokens, recordUsageFailure } from '#server/platform/observability/index';
import { UsageStore } from '#server/platform/observability/usage-store';
import { observeAgentProgress } from '#server/platform/workflows/agent-progress';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { WorkflowControl } from '#server/platform/workflows/control';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { WorkerLifecycle } from '#server/platform/workflows/lifecycle';

import { backupPolicy } from './backups.ts';
import { workflowHandlers } from './workflows.ts';

export function nativeLayers(
  store: ServerContext,
  manager: AuthManager,
  issuer: string,
  hostId: string | undefined,
  lifecycle: WorkerLifecycle['Service'],
  control: WorkflowControl['Service'],
  request?: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
) {
  const admission = admissionLayer(makeAdmission());

  const database = Layer.succeed(Database, { store });

  const backupOwner = new ManagedBackups(store.db, backupPolicy, store.clock);

  const backups = Layer.succeed(BackupStorage, { owner: backupOwner });

  const lifecycleLayer = Layer.succeed(WorkerLifecycle, lifecycle);

  const services = Layer.mergeAll(
    Sources.layer,
    Workflows.layer,
    Recordings.layer,
    Materials.layer,
    Pages.layer,
    Integrations.layer,
    Materials.deletionParticipantsLayer({ Learning }),
    Notes.layer,
    Learning.layer.pipe(Layer.provide(Layer.mergeAll(Settings.layer, Materials.layer))),
    Projects.layer,
    Settings.layer,
    Themes.layer,
    System.layer
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(database, backups, lifecycleLayer, Layer.succeed(WorkflowControl, control))
    )
  );

  const session = Layer.succeed(ChatGptSession, { manager, issuer, hostId, request });

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
        now: () => store.clock.currentTimeMillisUnsafe(),
        recordUsage: (record) =>
          transaction((tx) => tx.store(UsageStore).record(record)).pipe(
            Effect.provideService(Database, { store }),
            Effect.andThen(recordAiTokens(record)),
            Effect.catchCause(() => recordUsageFailure())
          ),
        admission: withAdmissionSettings(aiAdmission, settings.concurrencySettings()),
        language: settings.language(),
        rules: settings.agentRules(),
        model: (tier) =>
          settings.model(tier).pipe(
            Effect.flatMap(({ provider, modelId }): ReturnType<Agents['Service']['model']> =>
              typeof provider === 'string'
                ? Effect.try({
                    try: () =>
                      createApiKeyModel(
                        getApiKeyProvider(provider),
                        modelId,
                        adaptCredentialReader(auth.apiKey(provider)),
                        request
                      ),
                    catch: () => new StudyError('config', 'Could not initialize AI provider')
                  })
                : Effect.succeed(createChatGptModel({ auth: manager, modelId, fetch: request }))
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
  );

  const workflows = workflowHandlers.pipe(Layer.provideMerge(workflowEngineLayer(store)));

  return { handlers, services: shared, workflows, backups: backupOwner };
}
