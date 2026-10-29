import { definePlugin } from 'vite-plus/lint/plugins';

import browserBoundary from './rules/browser-boundary.ts';
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
import noErrorMessageMatching from './rules/no-error-message-matching.ts';
import noLossyIds from './rules/no-lossy-ids.ts';
import noNonNullQueryResults from './rules/no-non-null-query-results.ts';
import packageBoundary from './rules/package-boundary.ts';
import parameterizedSql from './rules/parameterized-sql.ts';
import preserveErrorCause from './rules/preserve-error-cause.ts';
import procedureContract from './rules/procedure-contract.ts';
import procedureTest from './rules/procedure-test.ts';
import serverNoMocks from './rules/server-no-mocks.ts';
import sharedUiVariants from './rules/shared-ui-variants.ts';
import synchronousTransactions from './rules/synchronous-transactions.ts';
import themeRule from './rules/theme-colors.ts';
import transactionNoIo from './rules/transaction-no-io.ts';

export default definePlugin({
  meta: { name: 'study' },
  rules: {
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
    'procedure-contract': procedureContract,
    'procedure-test': procedureTest,
    'browser-boundary': browserBoundary,
    'package-boundary': packageBoundary,
    'theme-colors': themeRule,
    'shared-ui-variants': sharedUiVariants
  }
});
