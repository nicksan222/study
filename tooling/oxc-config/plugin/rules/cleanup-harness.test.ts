import { testStable } from '@study/testing/vitest';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Use cleanupActivity for unsafe workflow retirement so cancellation precedes guarded cleanup and failure settlement.';

testStable('workflow cleanup cannot duplicate unsafe cancellation orchestration', async () => {
  assertDiagnostics(
    'cleanup-harness',
    await lintRule('cleanup-harness', {
      'src/features/notes/workflows/bad.ts':
        "import {WorkflowControl as Control} from '#server/platform/workflows/control'; function* work() { const control = yield* Control; yield* control.cancel({id, mode:'unsafe'}); }",
      'src/features/notes/workflows/good.ts':
        "import {WorkflowControl} from '#server/platform/workflows/control'; function* work() { const control = yield* WorkflowControl; yield* control.cancel({id, mode:'safe'}); } function* other(control: any) { yield* control.cancel({id, mode:'unsafe'}); }"
    }),
    [['src/features/notes/workflows/bad.ts', message]]
  );
});
