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

testStable('enforces shared pagination while allowing owner-specific action labels', () => {
  expect(
    lint(
      `import { Button } from '@study/ui/button'; const view = <Button disabled={pending}>{t('LibraryMore')}</Button>;`
    )
  ).toHaveLength(1);
  expect(
    lint(
      `import { Button } from '@study/ui/button'; const view = <Button>{t('DocumentEdit')}</Button>;`
    )
  ).toHaveLength(0);
});

testStable('requires tooltip-backed icon actions without confusing text buttons', () => {
  expect(
    lint(
      `import { Button } from '@study/ui/button'; const view = <Button size="icon-sm" aria-label={t('Close')}><X /></Button>;`
    )
  ).toHaveLength(1);
  expect(
    lint(
      `import { Button } from '@study/ui/button'; const view = <Button aria-label={label}>Visible action</Button>;`
    )
  ).toHaveLength(0);
});

testStable('standardizes operation announcements while preserving prose', () => {
  expect(lint(`const view = <p role="status">Saved</p>;`)).toHaveLength(1);
  expect(lint(`const view = <p>Document paragraph</p>;`)).toHaveLength(0);
});

testStable('standardizes expandable sections and permits the package implementation', () => {
  expect(lint(`const view = <details><summary>History</summary>Content</details>;`)).toHaveLength(
    1
  );
  expect(
    lint(
      `const view = <details><summary>History</summary>Content</details>;`,
      'packages/ui/src/components/example.tsx'
    )
  ).toHaveLength(0);
});
