import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

const path = 'apps/client/src/features/example/action.tsx';

test.stable(
  'requires guarded app AI buttons, including aliases and namespace imports',
  async () => {
    for (const source of [
      "import { AiButton } from '@study/ui';",
      "import { AiButton as Generate } from '@study/ui';",
      "import * as Ai from '@study/ui'; const view = <Ai.AiButton />;",
      "import * as UI from '@study/ui'; const { AiButton: Generate } = UI; const view = <Generate />;",
      "import * as UI from '@study/ui'; const Alias = UI; const view = <Alias.AiButton />;",
      "import * as UI from '@study/ui'; const Alias = UI; const Generate = Alias.AiButton;",
      "const module = await import('@study/ui'); const Generate = module.AiButton;",
      "const { AiButton: Generate } = await import('@study/ui'); const view = <Generate />;",
      "export { AiButton as Generate } from '@study/ui';",
      "export * from '@study/ui';"
    ])
      test.expect(await lintRule('ai-readiness', { [path]: source }, true), source).toHaveLength(1);
  }
);

test.stable('allows the guarded component and presentation-only activity indicators', async () => {
  for (const source of [
    "import { AiActionButton } from '#client/lib/ai-action-button.tsx'; const action = <AiActionButton tier='medium' label='Generate' />;",
    "import { AiIcon, AiActivity } from '@study/ui';",
    "import * as UI from '@study/ui'; const view = <UI.Button />;",
    "const module = await import('@study/ui'); const Button = module.Button;",
    "import type { AiButton } from '@study/ui';",
    "export { type AiButton } from '@study/ui';"
  ])
    test.expect(await lintRule('ai-readiness', { [path]: source }, true)).toHaveLength(0);

  test
    .expect(
      await lintRule(
        'ai-readiness',
        {
          'apps/client/src/lib/ai-action-button.tsx': "import { AiButton } from '@study/ui';"
        },
        true
      )
    )
    .toHaveLength(0);
});
