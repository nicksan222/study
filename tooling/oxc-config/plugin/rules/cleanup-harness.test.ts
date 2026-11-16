import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use cleanupActivity for unsafe workflow retirement so cancellation precedes guarded cleanup and failure settlement.';

test.stable(
  'workflow cleanup cannot duplicate unsafe cancellation orchestration',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'cleanup-harness',
      await lintRule({ assert }, 'cleanup-harness', {
        'src/features/notes/workflows/bad.ts': String.raw`import { WorkflowControl as Control } from "#server/platform/workflows/control";
function* work() {
  const control = yield* Control;
  yield* control.cancel({ id, mode: "unsafe" });
}`,
        'src/features/notes/workflows/good.ts': String.raw`import { WorkflowControl } from "#server/platform/workflows/control";
function* work() {
  const control = yield* WorkflowControl;
  yield* control.cancel({ id, mode: "safe" });
}
function* other(control: any) {
  yield* control.cancel({ id, mode: "unsafe" });
}`
      }),
      [['src/features/notes/workflows/bad.ts', message]]
    );
  }
);
