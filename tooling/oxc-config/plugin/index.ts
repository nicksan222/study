import { definePlugin } from 'vite-plus/lint/plugins';

import architectureRules from './architecture-rules.ts';
import definitionRules from './definition-rules.ts';
import factoryRules from './factory-rules.ts';
import observabilityRules from './observability-rules.ts';
import persistenceRules from './persistence-rules.ts';
import browserBoundary from './rules/browser-boundary.ts';
import contextIdentity from './rules/context-identity.ts';
import databaseOwnership from './rules/database-ownership.ts';
import decodePersistedJson from './rules/decode-persisted-json.ts';
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
import harnessBoundary from './rules/harness-boundary.ts';
import metricCardinality from './rules/metric-cardinality.ts';
import nativeClock from './rules/native-clock.ts';
import noErrorMessageMatching from './rules/no-error-message-matching.ts';
import noLossyIds from './rules/no-lossy-ids.ts';
import noNonNullQueryResults from './rules/no-non-null-query-results.ts';
import packageBoundary from './rules/package-boundary.ts';
import parameterizedSql from './rules/parameterized-sql.ts';
import preserveErrorCause from './rules/preserve-error-cause.ts';
import serverNoMocks from './rules/server-no-mocks.ts';
import serviceDefinition from './rules/service-definition.ts';
import sharedLoading from './rules/shared-loading.ts';
import sharedUiVariants from './rules/shared-ui-variants.ts';
import synchronousTransactions from './rules/synchronous-transactions.ts';
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
    'shared-loading': sharedLoading,
    'feature-orchestration': featureOrchestration,
    'native-clock': nativeClock,
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

    'server-no-mocks': serverNoMocks,
    'database-ownership': databaseOwnership,
    'effect-v4-api': effectV4Api,
    'browser-boundary': browserBoundary,
    'package-boundary': packageBoundary,
    'theme-colors': themeRule,
    'shared-ui-variants': sharedUiVariants,
    'web-boundaries': webBoundaries,
    'web-page-contract': webPageContract,
    'web-presentation-purity': webPresentationPurity,
    'web-query-contract': webQueryContract,
    'web-router-loaders': webRouterLoaders,
    'web-router-navigation': webRouterNavigation,
    'web-presentation': webPresentation
  }
});
