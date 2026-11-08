import { definePlugin } from 'vite-plus/lint/plugins';

import architectureRules from './architecture-rules.ts';
import definitionRules from './definition-rules.ts';
import factoryRules from './factory-rules.ts';
import observabilityRules from './observability-rules.ts';
import persistenceRules from './persistence-rules.ts';
import assertionBoundary from './rules/assertion-boundary.ts';
import browserBoundary from './rules/browser-boundary.ts';
import contextIdentity from './rules/context-identity.ts';
import databaseOwnership from './rules/database-ownership.ts';
import decodePersistedJson from './rules/decode-persisted-json.ts';
import definitionGenerators from './rules/definition-generators.ts';
import drizzleBoundary from './rules/drizzle-boundary.ts';
import effectAbortSignal from './rules/effect-abort-signal.ts';
import effectBoundedConcurrency from './rules/effect-bounded-concurrency.ts';
import effectBoundedRetries from './rules/effect-bounded-retries.ts';
import effectNoDiscarded from './rules/effect-no-discarded.ts';
import effectNoNativeTimers from './rules/effect-no-native-timers.ts';
import effectNoOrDie from './rules/effect-no-or-die.ts';
import effectNoSwallowedFailures from './rules/effect-no-swallowed-failures.ts';
import effectNoThrow from './rules/effect-no-throw.ts';
import effectRuntimeBoundary from './rules/effect-runtime-boundary.ts';
import effectScopedFibers from './rules/effect-scoped-fibers.ts';
import effectTryPromise from './rules/effect-try-promise.ts';
import effectV4Api from './rules/effect-v4-api.ts';
import featureOrchestration from './rules/feature-orchestration.ts';
import featurePreviewBoundary from './rules/feature-preview-boundary.ts';
import harnessBoundary from './rules/harness-boundary.ts';
import integrationTestEnvironment from './rules/integration-test-environment.ts';
import metricCardinality from './rules/metric-cardinality.ts';
import nativeClock from './rules/native-clock.ts';
import noDeepRelativeImports from './rules/no-deep-relative-imports.ts';
import noErrorMessageMatching from './rules/no-error-message-matching.ts';
import noLossyIds from './rules/no-lossy-ids.ts';
import noNonNullQueryResults from './rules/no-non-null-query-results.ts';
import notesPagesVocabulary from './rules/notes-pages-vocabulary.ts';
import packageBoundary from './rules/package-boundary.ts';
import parameterizedSql from './rules/parameterized-sql.ts';
import preserveErrorCause from './rules/preserve-error-cause.ts';
import serverFileDescription from './rules/server-file-description.ts';
import serverNoMocks from './rules/server-no-mocks.ts';
import serviceDefinition from './rules/service-definition.ts';
import sharedErrorState from './rules/shared-error-state.ts';
import sharedLoading from './rules/shared-loading.ts';
import sharedUiPatterns from './rules/shared-ui-patterns.ts';
import sharedUiVariants from './rules/shared-ui-variants.ts';
import synchronousTransactions from './rules/synchronous-transactions.ts';
import testClassification from './rules/test-classification.ts';
import testGuardAssertions from './rules/test-guard-assertions.ts';
import themeRule from './rules/theme-colors.ts';
import transactionNoIo from './rules/transaction-no-io.ts';
import webBoundaries from './rules/web-boundaries.ts';
import webPageContract from './rules/web-page-contract.ts';
import webPresentationPurity from './rules/web-presentation-purity.ts';
import webPresentation from './rules/web-presentation.ts';
import webQueryContract from './rules/web-query-contract.ts';
import webRouterLoaders from './rules/web-router-loaders.ts';
import webRouterNavigation from './rules/web-router-navigation.ts';

export default definePlugin({
  meta: { name: 'study' },
  rules: {
    'definition-generators': definitionGenerators,
    'assertion-boundary': assertionBoundary,
    'test-guard-assertions': testGuardAssertions,
    'test-classification': testClassification,
    'shared-loading': sharedLoading,
    'shared-error-state': sharedErrorState,
    'feature-orchestration': featureOrchestration,
    'native-clock': nativeClock,
    'notes-pages-vocabulary': notesPagesVocabulary,
    'metric-cardinality': metricCardinality,
    'context-identity': contextIdentity,
    'service-definition': serviceDefinition,
    'harness-boundary': harnessBoundary,
    ...architectureRules,
    ...definitionRules,
    ...factoryRules,
    ...observabilityRules,
    ...persistenceRules,
    'drizzle-boundary': drizzleBoundary,
    'effect-scoped-fibers': effectScopedFibers,
    'effect-no-native-timers': effectNoNativeTimers,
    'effect-bounded-concurrency': effectBoundedConcurrency,
    'effect-bounded-retries': effectBoundedRetries,
    'effect-abort-signal': effectAbortSignal,

    'effect-no-discarded': effectNoDiscarded,
    'effect-runtime-boundary': effectRuntimeBoundary,
    'effect-try-promise': effectTryPromise,
    'effect-no-throw': effectNoThrow,
    'effect-no-or-die': effectNoOrDie,
    'effect-no-swallowed-failures': effectNoSwallowedFailures,
    'no-lossy-ids': noLossyIds,
    'decode-persisted-json': decodePersistedJson,
    'parameterized-sql': parameterizedSql,
    'no-non-null-query-results': noNonNullQueryResults,
    'synchronous-transactions': synchronousTransactions,
    'transaction-no-io': transactionNoIo,
    'no-error-message-matching': noErrorMessageMatching,
    'preserve-error-cause': preserveErrorCause,

    'server-file-description': serverFileDescription,
    'server-no-mocks': serverNoMocks,
    'database-ownership': databaseOwnership,
    'effect-v4-api': effectV4Api,
    'browser-boundary': browserBoundary,
    'package-boundary': packageBoundary,
    'feature-preview-boundary': featurePreviewBoundary,
    'integration-test-environment': integrationTestEnvironment,
    'no-deep-relative-imports': noDeepRelativeImports,
    'theme-colors': themeRule,
    'shared-ui-variants': sharedUiVariants,
    'shared-ui-patterns': sharedUiPatterns,
    'web-boundaries': webBoundaries,
    'web-page-contract': webPageContract,
    'web-presentation-purity': webPresentationPurity,
    'web-query-contract': webQueryContract,
    'web-router-loaders': webRouterLoaders,
    'web-router-navigation': webRouterNavigation,
    'web-presentation': webPresentation
  }
});
