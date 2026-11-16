import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

async function lint(source: string, path = 'apps/client/src/features/example/example.tsx') {
  return await lintRule('shared-ui-patterns', { [path]: source }, true);
}

test.stable('enforces shared recovery actions including imported aliases', async () => {
  test
    .expect(
      await lint(
        `import { Button as Action } from '@study/ui'; const view = <Action onClick={retry}>{t('Retry')}</Action>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { RetryButton } from '@study/ui'; const view = <RetryButton label={t('Retry')} onClick={retry} />;`
      )
    )
    .toHaveLength(0);
  test
    .expect(await lint(`const Button = Custom; const view = <Button>{t('Retry')}</Button>;`))
    .toHaveLength(0);
});

test.stable('enforces shared pagination while allowing owner-specific action labels', async () => {
  test
    .expect(
      await lint(
        `import { Button } from '@study/ui'; const view = <Button disabled={pending}>{t('LibraryMore')}</Button>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { Button } from '@study/ui'; const view = <Button>{t('PageEdit')}</Button>;`
      )
    )
    .toHaveLength(0);
});

test.stable('requires tooltip-backed icon actions without confusing text buttons', async () => {
  test
    .expect(
      await lint(
        `import { Button } from '@study/ui'; const view = <Button size="icon-sm" aria-label={t('Close')}><X /></Button>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { Button } from '@study/ui'; const view = <Button aria-label={label}>Visible action</Button>;`
      )
    )
    .toHaveLength(0);
});

test.stable('standardizes operation announcements while preserving prose', async () => {
  test.expect(await lint(`const view = <p role="status">Saved</p>;`)).toHaveLength(1);
  test.expect(await lint(`const view = <p>Document paragraph</p>;`)).toHaveLength(0);
});

test.stable('standardizes expandable sections and permits the package implementation', async () => {
  test
    .expect(await lint(`const view = <details><summary>History</summary>Content</details>;`))
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `const view = <details><summary>History</summary>Content</details>;`,
        'packages/ui/src/components/example.tsx'
      )
    )
    .toHaveLength(0);
});

test.stable('standardizes selected-item headings using imported aliases', async () => {
  test
    .expect(
      await lint(
        `import { SelectionSurface as Surface } from '@study/ui'; const view = <Surface.Header><h2>Archive</h2></Surface.Header>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(await lint(`const view = <header><h2>Article heading</h2></header>;`))
    .toHaveLength(0);
});

test.stable('standardizes selection empty states without banning content containers', async () => {
  test
    .expect(
      await lint(
        `import { SelectionSurface as Surface } from '@study/ui'; const view = <Surface.Empty><strong>Empty</strong></Surface.Empty>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { SelectionSurface as Surface } from '@study/ui'; const view = <Surface.EmptyState title="Empty" />;`
      )
    )
    .toHaveLength(0);
});

test.stable('standardizes search scaffolding only on selection surfaces', async () => {
  test
    .expect(
      await lint(
        `import { SelectionSurface as S } from '@study/ui'; const view = <S.Search><input type="search" /></S.Search>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(await lint(`const view = <input type="search" aria-label="Find in document" />;`))
    .toHaveLength(0);
});

test.stable('requires shared selectable rows rather than assembling labels and icons', async () => {
  test
    .expect(
      await lint(
        `import { SelectionSurface as S } from '@study/ui'; const view = <S.Material><FileText /><span>Title</span></S.Material>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { SelectionSurface as S } from '@study/ui'; const view = <S.Item label="Title" icon={<FileText />} />;`
      )
    )
    .toHaveLength(0);
});

test.stable('requires primitive-backed shared dialog dismissal', async () => {
  test
    .expect(
      await lint(
        `import { DialogClose as Close } from '@study/ui'; const view = <Close render={<Button />}>Close</Close>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { DialogDismissButton } from '@study/ui'; const view = <DialogDismissButton label="Close" />;`
      )
    )
    .toHaveLength(0);
});

test.stable('standardizes labelled text controls but permits native document inputs', async () => {
  test
    .expect(
      await lint(`import { Input } from '@study/ui'; const view = <label>Name<Input /></label>;`)
    )
    .toHaveLength(1);
  test
    .expect(await lint(`const view = <label><input type="checkbox" />Choice</label>;`))
    .toHaveLength(0);
});

test.stable(
  'standardizes directional actions while keeping unrelated icons available',
  async () => {
    test
      .expect(
        await lint(
          `import { Button } from '@study/ui'; import { NextIcon } from '@study/icons'; const view = <Button>Next<NextIcon /></Button>;`
        )
      )
      .toHaveLength(1);
    test
      .expect(
        await lint(
          `import { Button } from '@study/ui'; const view = <Button>Open<ArrowUpRight /></Button>;`
        )
      )
      .toHaveLength(0);
  }
);

test.stable('standardizes dialog heading composition using imported aliases', async () => {
  test
    .expect(
      await lint(
        `import { DialogHeader as Header } from '@study/ui'; const view = <Header><DialogTitle>Title</DialogTitle></Header>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(await lint(`const view = <header><h1>Document content</h1></header>;`))
    .toHaveLength(0);
});

test.stable('standardizes settings switches without banning custom setting actions', async () => {
  test
    .expect(
      await lint(
        `import { Settings as S } from '@study/ui'; import { SwitchControl } from '@study/ui'; const view = <S.Row title="Title"><SwitchControl /></S.Row>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { Settings as S } from '@study/ui'; const view = <S.Row title="Title"><CustomAction /></S.Row>;`
      )
    )
    .toHaveLength(0);
});

test.stable('standardizes settings selects and retains custom compound rows', async () => {
  test
    .expect(
      await lint(
        `import { Settings } from '@study/ui'; import { SelectControl } from '@study/ui'; const view = <Settings.Row title="Title"><SelectControl /></Settings.Row>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { Settings } from '@study/ui'; const view = <Settings.SelectRow title="Title" value="one" />;`
      )
    )
    .toHaveLength(0);
});

test.stable('standardizes numeric preferences without moving persistence into UI', async () => {
  test
    .expect(
      await lint(
        `import { Settings } from '@study/ui'; import { NumberControl } from '@study/ui'; const view = <Settings.Row title="Title"><NumberControl /></Settings.Row>;`
      )
    )
    .toHaveLength(1);
  test
    .expect(
      await lint(
        `import { Settings } from '@study/ui'; const view = <Settings.NumberRow title="Title" onSubmit={save} />;`
      )
    )
    .toHaveLength(0);
});

test.stable(
  'resolves aliases and namespaces without flagging shadowed or unrelated controls',
  async () => {
    test
      .expect(
        await lint(
          `import * as UI from '@study/ui'; const view = <UI.Button>{t('Retry')}</UI.Button>;`
        )
      )
      .toHaveLength(1);
    test
      .expect(
        await lint(
          `import { Button } from '@study/ui'; function Custom({ Button }) { return <Button>{t('Retry')}</Button>; }`
        )
      )
      .toHaveLength(0);
    test
      .expect(
        await lint(
          `import { Button } from '@study/ui'; const view = <Button>{format('Retry')}</Button>;`
        )
      )
      .toHaveLength(0);
    test
      .expect(
        await lint(
          `import { Settings as S } from '@study/ui'; const view = <S.Row title="Title"><SwitchControl /></S.Row>;`
        )
      )
      .toHaveLength(0);
  }
);

test.stable(
  'standardizes labelled settings ranges while allowing embedded range editors',
  async () => {
    test
      .expect(
        await lint(
          `import { Settings } from '@study/ui'; import { RangeControl } from '@study/ui'; const view = <Settings.Row title="Title"><RangeControl /></Settings.Row>;`
        )
      )
      .toHaveLength(1);
    test
      .expect(
        await lint(
          `import { RangeControl } from '@study/ui'; const view = <RangeControl label="Zoom" />;`
        )
      )
      .toHaveLength(0);
  }
);
