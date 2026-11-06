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

testStable('standardizes selected-item headings using imported aliases', () => {
  expect(
    lint(
      `import { SelectionSurface as Surface } from '@study/ui/selection'; const view = <Surface.Header><h2>Archive</h2></Surface.Header>;`
    )
  ).toHaveLength(1);
  expect(lint(`const view = <header><h2>Article heading</h2></header>;`)).toHaveLength(0);
});

testStable('standardizes selection empty states without banning content containers', () => {
  expect(
    lint(
      `import { SelectionSurface as Surface } from '@study/ui/selection'; const view = <Surface.Empty><strong>Empty</strong></Surface.Empty>;`
    )
  ).toHaveLength(1);
  expect(
    lint(
      `import { SelectionSurface as Surface } from '@study/ui/selection'; const view = <Surface.EmptyState title="Empty" />;`
    )
  ).toHaveLength(0);
});

testStable('standardizes search scaffolding only on selection surfaces', () => {
  expect(
    lint(
      `import { SelectionSurface as S } from '@study/ui/selection'; const view = <S.Search><input type="search" /></S.Search>;`
    )
  ).toHaveLength(1);
  expect(lint(`const view = <input type="search" aria-label="Find in document" />;`)).toHaveLength(
    0
  );
});

testStable('requires shared selectable rows rather than assembling labels and icons', () => {
  expect(
    lint(
      `import { SelectionSurface as S } from '@study/ui/selection'; const view = <S.Material><FileText /><span>Title</span></S.Material>;`
    )
  ).toHaveLength(1);
  expect(
    lint(
      `import { SelectionSurface as S } from '@study/ui/selection'; const view = <S.Item label="Title" icon={<FileText />} />;`
    )
  ).toHaveLength(0);
});

testStable('requires primitive-backed shared dialog dismissal', () => {
  expect(
    lint(
      `import { DialogClose as Close } from '@study/ui/dialog'; const view = <Close render={<Button />}>Close</Close>;`
    )
  ).toHaveLength(1);
  expect(
    lint(
      `import { DialogDismissButton } from '@study/ui/dialog-form-actions'; const view = <DialogDismissButton label="Close" />;`
    )
  ).toHaveLength(0);
});

testStable('standardizes labelled text controls but permits native document inputs', () => {
  expect(lint(`const view = <label>Name<Input /></label>;`)).toHaveLength(1);
  expect(lint(`const view = <label><input type="checkbox" />Choice</label>;`)).toHaveLength(0);
});

testStable('standardizes directional actions while keeping unrelated icons available', () => {
  expect(
    lint(
      `import { Button } from '@study/ui/button'; const view = <Button>Next<ArrowRight /></Button>;`
    )
  ).toHaveLength(1);
  expect(
    lint(
      `import { Button } from '@study/ui/button'; const view = <Button>Open<ArrowUpRight /></Button>;`
    )
  ).toHaveLength(0);
});

testStable('standardizes dialog heading composition using imported aliases', () => {
  expect(
    lint(
      `import { DialogHeader as Header } from '@study/ui/dialog'; const view = <Header><DialogTitle>Title</DialogTitle></Header>;`
    )
  ).toHaveLength(1);
  expect(lint(`const view = <header><h1>Document content</h1></header>;`)).toHaveLength(0);
});

testStable('standardizes settings switches without banning custom setting actions', () => {
  expect(
    lint(
      `import { Settings as S } from '@study/ui/settings'; const view = <S.Row title="Title"><SwitchControl /></S.Row>;`
    )
  ).toHaveLength(1);
  expect(
    lint(
      `import { Settings as S } from '@study/ui/settings'; const view = <S.Row title="Title"><CustomAction /></S.Row>;`
    )
  ).toHaveLength(0);
});
