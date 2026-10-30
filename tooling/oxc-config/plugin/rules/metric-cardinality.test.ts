import { test } from 'node:test';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Metric attributes must use bounded literal labels or safeMetricLabels from platform/observability.';

test('checks Effect metric attributes with aliases and shadowing', () => {
  assertDiagnostics(
    'metric-cardinality',
    lintRule('metric-cardinality', {
      'src/features/a/service.ts':
        "import { Metric as M } from 'effect'; const { withAttributes: label } = M; M.counter('x', { attributes: { requestId: 'x' } }); label({ status: value }); M.withAttributes(metric, labels); M.withAttributes({ status: 'ok' }); function f(M: any) { M.withAttributes(labels); }",
      'src/features/a/good.ts':
        "import * as M from 'effect/Metric'; import { safeMetricLabels as safe } from '../../platform/observability'; M.withAttributes(safe(labels)); M.counter('x', { attributes: { status: 'ok' } }); unrelated.withAttributes(labels);"
    }),
    [
      ['src/features/a/service.ts', message],
      ['src/features/a/service.ts', message],
      ['src/features/a/service.ts', message]
    ]
  );
});
test('checks tuple attributes, constructor options and namespace helper', () => {
  assertDiagnostics(
    'metric-cardinality',
    lintRule('metric-cardinality', {
      'src/features/a/service.ts':
        "import * as M from 'effect/Metric'; import * as obs from '../../platform/observability/index'; M.withAttributes([['status', 'ok']]); M.withAttributes([['entity_id', 'x']]); M.histogram('x', opts); M.withAttributes(obs.safeMetricLabels(input));"
    }),
    [
      ['src/features/a/service.ts', message],
      ['src/features/a/service.ts', message]
    ]
  );
});

test('allows bounded enum members and rejects computed identifiers', () => {
  assertDiagnostics(
    'metric-cardinality',
    lintRule('metric-cardinality', {
      'src/features/a/service.ts':
        "import { Metric } from 'effect'; enum Status { Ok = 'ok', Error = 'error' } Metric.withAttributes({ status: Status.Ok }); Metric.withAttributes({ executionId: Status.Ok });"
    }),
    [['src/features/a/service.ts', message]]
  );
});

test('checks contextual Effect metric attributes', () => {
  assertDiagnostics(
    'metric-cardinality',
    lintRule('metric-cardinality', {
      'src/features/a/service.ts':
        "import { Effect, Metric } from 'effect'; Effect.provideService(Metric.CurrentMetricAttributes, labels); Effect.provideService(task, Metric.CurrentMetricAttributes, { status: 'ok' });"
    }),
    [['src/features/a/service.ts', message]]
  );
});
