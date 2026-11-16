import { test } from '@study/testing';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Declare feature checkpoints with defineActivity; the harness owns codecs and generator adaptation.';

test.unit.stable(
  'feature activities cannot bypass the native checkpoint harness through aliases',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'activity-harness',
      await lintRule({ assert }, 'activity-harness', {
        'src/features/example/workflows/index.ts': String.raw`import { Activity as A } from "effect/workflow";
const make = A.make;
make({ name: "x", execute: work });`,
        'src/features/example/workflows/good.ts': String.raw`import { defineActivity } from "#server/platform/definitions/define-activity";
defineActivity({
  name: "x",
  execute: function* () {
    yield* work;
  },
});
function f(Activity: any) {
  Activity.make({});
}`,
        'src/platform/internal.ts': "import {Activity} from 'effect/workflow'; Activity.make({});",
        'src/features/example/workflows/index.test.ts':
          "import {Activity} from 'effect/workflow'; Activity.make({});"
      }),
      [['src/features/example/workflows/index.ts', message]]
    );
  }
);

test.unit.stable(
  'publication checkpoints centralize their guard wrapper',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'activity-harness',
      await lintRule({ assert }, 'activity-harness', {
        'src/features/notes/workflows/bad.ts': String.raw`import { defineActivity } from "#server/platform/definitions/define-activity";
import { withPublicationGuard as guard } from "#server/platform/workflows/publication";
defineActivity({ name: "x", execute: guard(context, work) });`,
        'src/features/notes/workflows/good.ts': String.raw`import { publicationActivity } from "#server/platform/definitions/define-activity";
publicationActivity(context, { name: "x", execute: work });`
      }),
      [
        [
          'src/features/notes/workflows/bad.ts',
          'Use publicationActivity to capture publication authority inside the checkpoint.'
        ]
      ]
    );
  }
);

test.unit.stable(
  'durable retries use the checkpoint harness',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    assertDiagnostics(
      { assert, expect },
      'activity-harness',
      await lintRule({ assert }, 'activity-harness', {
        'src/features/notes/workflows/bad.ts': String.raw`import { defineActivity } from "#server/platform/definitions/define-activity";
import { retryResumableActivity as retry } from "#server/platform/workflows/retry";
retry(defineActivity({ name: "x", execute: work }));`,
        'src/features/notes/workflows/good.ts': String.raw`import { resumableActivity } from "#server/platform/definitions/define-activity";
resumableActivity({
  name: "x",
  execute: function* () {
    yield* work;
  },
});`
      }),
      [
        [
          'src/features/notes/workflows/bad.ts',
          'Use resumableActivity to keep retry policy and checkpoint construction in one harness.'
        ]
      ]
    );
  }
);
