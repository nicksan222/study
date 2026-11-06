import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

function lint(source: string, path = 'apps/web/src/features/example/example.tsx') {
  return lintRule('shared-ui-patterns', { [path]: source }, true);
}

testStable('enforces shared recovery actions including imported aliases', () => {
  expect(
    lint(
      `import { Button as Action } from '@study/ui/button'; const view = <Action onClick={retry}>{t('Retry')}</Action>;`
    )
  ).toHaveLength(1);
  expect(
    lint(
      `import { RetryButton } from '@study/ui/action-button'; const view = <RetryButton label={t('Retry')} onClick={retry} />;`
    )
  ).toHaveLength(0);
  expect(lint(`const Button = Custom; const view = <Button>{t('Retry')}</Button>;`)).toHaveLength(
    0
  );
});
