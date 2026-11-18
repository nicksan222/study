/** @file Shared server capabilities for feature declarations and runtime composition.
 * Platform implementations import their dependencies directly to keep this entry point acyclic.
 */

export {
  AiAdmission,
  admissionLayer,
  makeAdmission,
  withAdmissionSettings
} from './ai/admission.ts';
export { AgentOutputError, Agents, generateAgent, layer as agentsLayer } from './ai/agents.ts';
export type { AgentsConfig } from './ai/agents.ts';
export {
  AuthManager,
  SignIn,
  acquireSignIn,
  decodeAccount,
  encodeAccount,
  signInCallbackPage
} from './ai/auth/index.ts';
export type { AccessSeed, Account } from './ai/auth/index.ts';
export { ChatGptSession } from './ai/auth/service.ts';
export { sourcesTool } from './ai/captured-sources-tool.ts';
export { defineContextPreparation } from './ai/context-preparation/index.ts';
export type { ContextPreparation } from './ai/context-preparation/index.ts';
export { planSourcePassages } from './ai/context-preparation/planner.ts';
export { createEvidenceCatalog } from './ai/evidence.ts';
export { createApiKeyModel } from './ai/providers/api-key-model.ts';
export { createChatGptModel } from './ai/providers/chatgpt/model.ts';
export { getApiKeyProvider, providerCatalog } from './ai/providers/registry.ts';
export { makeAgentToolkit } from './ai/tool-adapter.ts';
export { webSearchTool } from './ai/web-search-tool.ts';
export { exportBudget } from './content-export/budget.ts';
export { BackupStorage, ManagedBackups } from './database/backups.ts';
export type { SnapshotPolicy } from './database/backups.ts';
export { decodeStoredBlock } from './database/content-block.ts';
export { contentInputColumns } from './database/content-input.ts';
export { ServerContext } from './database/context.ts';
export { Database, databaseChanges } from './database/database.ts';
export { liveQueriesLayer } from './database/live-queries.ts';
export { acquireDatabaseOwnership } from './database/ownership.ts';
export { requireRow } from './database/rows.ts';
export {
  defineActivity,
  publicationActivity,
  resumableActivity
} from './definitions/define-activity.ts';
export { defineAgent, defineTool } from './definitions/define-agent.ts';
export type {
  AgentDefinition,
  AgentEnvironment,
  AiRuntimeAdapters,
  ToolWiki
} from './definitions/define-agent.ts';
export { defineProcedure, runProcedure, procedureTool } from './definitions/define-procedure.ts';
export { defineRpc } from './definitions/define-rpc.ts';
export { defineService } from './definitions/define-service.ts';
export {
  defineStore,
  publicationTransaction,
  storeMutation,
  storeQuery,
  transaction,
  transactionDatabase,
  useStore
} from './definitions/define-store.ts';
export type { StoreResources, Transaction } from './definitions/define-store.ts';
export { defineWorkflow } from './definitions/define-workflow.ts';
export { defineWorkflowHandler } from './definitions/define-workflow-handler.ts';
export { impactToken } from './definitions/impact-token.ts';
export { pageById } from './definitions/page-by-id.ts';
export { validatedMutation } from './definitions/validated-mutation.ts';
export { classifyError, normalizeError } from './errors/classify-error.ts';
export { invalid } from './errors/domain-error.ts';
export { posixPaths } from './filesystem/index.ts';
export { fetchPage, validateLink } from './http/index.ts';
export {
  observeOperation,
  recordAiTokens,
  recordAuthCallbackRejection,
  recordUsageFailure,
  safeMetadata
} from './observability/index.ts';
export { UsageStore } from './observability/usage-store.ts';
export { cursorPage } from './pagination.ts';
export { serveRpc } from './rpc/bun.ts';
export { newMemory, reviewMemory } from './scheduling/fsrs.ts';
export type { Memory } from './scheduling/fsrs.ts';
export { unixSeconds } from './time/index.ts';
export {
  agentProgressSnapshot,
  discardInterruptedAgentProgress,
  observeAgentProgress
} from './workflows/agent-progress.ts';
export { reconcileCancellation } from './workflows/cancellation.ts';
export { cleanupActivity } from './workflows/cleanup.ts';
export { WorkflowConfiguration, notifyConfigurationChanged } from './workflows/configuration.ts';
export { WorkflowControl, cancelExecution } from './workflows/control.ts';
export { initializeWorkflowInfrastructure, workflowEngineLayer } from './workflows/engine.ts';
export { decodeEvent, emitEvent, encodeEvent } from './workflows/events.ts';
export { WorkerLifecycle } from './workflows/lifecycle.ts';
export { withPublicationGuard } from './workflows/publication.ts';
export type { PublicationGuard } from './workflows/publication.ts';
export { WorkflowRetirementStore } from './workflows/retirement.ts';
export { retryResumableActivity, settleWorkflowFailure } from './workflows/retry.ts';
export { workflowStore } from './workflows/store.ts';
export {
  admitPending,
  dispatchPending,
  refreshExecutionSnapshots,
  triggeredExecutionId
} from './workflows/triggers.ts';

export { VoiceModels } from './speech/models.ts';
export type { SpeechAsset } from './speech/models.ts';
export { VoiceRuntime, transcribeInProcess } from './speech/runtime.ts';
export type { VoiceRuntimeAdapters, VoiceRecognitionInput } from './speech/runtime.ts';
