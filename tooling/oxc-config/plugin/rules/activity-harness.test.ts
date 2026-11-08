import { testStable } from '@study/testing/vitest';

import { assertDiagnostics, lintRule } from '../test/utils.ts';

const message =
  'Declare feature checkpoints with defineActivity; the harness owns codecs and generator adaptation.';

testStable('feature activities cannot bypass the native checkpoint harness through aliases', () => {
  assertDiagnostics(
    'activity-harness',
    lintRule('activity-harness', {
      'src/features/example/workflows/index.ts':
        "import {Activity as A} from 'effect/workflow'; const make = A.make; make({name: 'x', execute: work});",
      'src/features/example/workflows/good.ts':
        "import {defineActivity} from '#server/platform/definitions/define-activity'; defineActivity({name: 'x', execute: function* () { yield* work; }}); function f(Activity: any) { Activity.make({}); }",
      'src/platform/internal.ts': "import {Activity} from 'effect/workflow'; Activity.make({});",
      'src/features/example/workflows/index.test.ts':
        "import {Activity} from 'effect/workflow'; Activity.make({});"
    }),
    [['src/features/example/workflows/index.ts', message]]
  );
});

testStable('publication checkpoints centralize their guard wrapper', () => {
  assertDiagnostics(
    'activity-harness',
    lintRule('activity-harness', {
      'src/features/notes/workflows/bad.ts':
        "import {defineActivity} from '#server/platform/definitions/define-activity'; import {withPublicationGuard as guard} from '#server/platform/workflows/publication'; defineActivity({name: 'x', execute: guard(context, work)});",
      'src/features/notes/workflows/good.ts':
        "import {publicationActivity} from '#server/platform/definitions/define-activity'; publicationActivity(context, {name: 'x', execute: work});"
    }),
    [
      [
        'src/features/notes/workflows/bad.ts',
        'Use publicationActivity to capture publication authority inside the checkpoint.'
      ]
    ]
  );
});
