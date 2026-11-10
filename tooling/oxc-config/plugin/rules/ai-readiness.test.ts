import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

const path = 'apps/web/src/features/example/action.tsx';

testStable('requires guarded app AI buttons, including aliases and namespace imports', () => {
  for (const source of [
    "import { AiButton } from '@study/ui/ai-button';",
    "import { AiButton as Generate } from '@study/ui/ai-button';",
    "import * as Ai from '@study/ui/ai-button';",
    "export { AiButton as Generate } from '@study/ui/ai-button';",
    "export * from '@study/ui/ai-button';",
    "const primitives = import('@study/ui/ai-button');"
  ])
    expect(lintRule('ai-readiness', { [path]: source }, true)).toHaveLength(1);
});

testStable('allows the guarded component and presentation-only activity indicators', () => {
  for (const source of [
    "import { AiActionButton } from '#web/lib/ai-action-button.tsx'; const action = <AiActionButton tier='medium' label='Generate' />;",
    "import { AiIcon, AiActivity } from '@study/ui/ai-button';",
    "import type { AiButton } from '@study/ui/ai-button';",
    "export { type AiButton } from '@study/ui/ai-button';"
  ])
    expect(lintRule('ai-readiness', { [path]: source }, true)).toHaveLength(0);

  expect(
    lintRule(
      'ai-readiness',
      {
        'apps/web/src/lib/ai-action-button.tsx': "import { AiButton } from '@study/ui/ai-button';"
      },
      true
    )
  ).toHaveLength(0);
});
