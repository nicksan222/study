import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

async function lint(
  { assert: assertions }: Pick<test.unit.Context, 'assert'>,
  source: string,
  path = 'apps/client/src/features/example/example.tsx'
) {
  const assert: test.Assert = assertions;

  return await lintRule({ assert }, 'shared-ui-patterns', { [path]: source }, true);
}

test.unit.stable(
  'enforces shared recovery actions including imported aliases',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Button as Action } from '@study/ui'; const view = <Action onClick={retry}>{t('Retry')}</Action>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { RetryButton } from '@study/ui'; const view = <RetryButton label={t('Retry')} onClick={retry} />;`
      )
    ).toHaveLength(0);
    expect(
      await lint({ assert }, `const Button = Custom; const view = <Button>{t('Retry')}</Button>;`)
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'enforces shared pagination while allowing owner-specific action labels',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Button } from '@study/ui'; const view = <Button disabled={pending}>{t('LibraryMore')}</Button>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { Button } from '@study/ui'; const view = <Button>{t('PageEdit')}</Button>;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'requires tooltip-backed icon actions without confusing text buttons',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Button } from '@study/ui'; const view = <Button size="icon-sm" aria-label={t('Close')}><X /></Button>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { Button } from '@study/ui'; const view = <Button aria-label={label}>Visible action</Button>;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes operation announcements while preserving prose',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(await lint({ assert }, `const view = <p role="status">Saved</p>;`)).toHaveLength(1);
    expect(await lint({ assert }, `const view = <p>Document paragraph</p>;`)).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes expandable sections and permits the package implementation',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint({ assert }, `const view = <details><summary>History</summary>Content</details>;`)
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `const view = <details><summary>History</summary>Content</details>;`,
        'packages/ui/src/components/example.tsx'
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes selected-item headings using imported aliases',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { SelectionSurface as Surface } from '@study/ui'; const view = <Surface.Header><h2>Archive</h2></Surface.Header>;`
      )
    ).toHaveLength(1);
    expect(
      await lint({ assert }, `const view = <header><h2>Article heading</h2></header>;`)
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes selection empty states without banning content containers',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { SelectionSurface as Surface } from '@study/ui'; const view = <Surface.Empty><strong>Empty</strong></Surface.Empty>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { SelectionSurface as Surface } from '@study/ui'; const view = <Surface.EmptyState title="Empty" />;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes search scaffolding only on selection surfaces',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { SelectionSurface as S } from '@study/ui'; const view = <S.Search><input type="search" /></S.Search>;`
      )
    ).toHaveLength(1);
    expect(
      await lint({ assert }, `const view = <input type="search" aria-label="Find in document" />;`)
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'requires shared selectable rows rather than assembling labels and icons',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { SelectionSurface as S } from '@study/ui'; const view = <S.Material><FileText /><span>Title</span></S.Material>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { SelectionSurface as S } from '@study/ui'; const view = <S.Item label="Title" icon={<FileText />} />;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'requires primitive-backed shared dialog dismissal',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { DialogClose as Close } from '@study/ui'; const view = <Close render={<Button />}>Close</Close>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { DialogDismissButton } from '@study/ui'; const view = <DialogDismissButton label="Close" />;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes labelled text controls but permits native document inputs',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Input } from '@study/ui'; const view = <label>Name<Input /></label>;`
      )
    ).toHaveLength(1);
    expect(
      await lint({ assert }, `const view = <label><input type="checkbox" />Choice</label>;`)
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes directional actions while keeping unrelated icons available',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Button } from '@study/ui'; import { NextIcon } from '@study/icons'; const view = <Button>Next<NextIcon /></Button>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { Button } from '@study/ui'; const view = <Button>Open<ArrowUpRight /></Button>;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes dialog heading composition using imported aliases',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { DialogHeader as Header } from '@study/ui'; const view = <Header><DialogTitle>Title</DialogTitle></Header>;`
      )
    ).toHaveLength(1);
    expect(
      await lint({ assert }, `const view = <header><h1>Document content</h1></header>;`)
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes settings switches without banning custom setting actions',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Settings as S } from '@study/ui'; import { SwitchControl } from '@study/ui'; const view = <S.Row title="Title"><SwitchControl /></S.Row>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { Settings as S } from '@study/ui'; const view = <S.Row title="Title"><CustomAction /></S.Row>;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes settings selects and retains custom compound rows',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Settings } from '@study/ui'; import { SelectControl } from '@study/ui'; const view = <Settings.Row title="Title"><SelectControl /></Settings.Row>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { Settings } from '@study/ui'; const view = <Settings.SelectRow title="Title" value="one" />;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes numeric preferences without moving persistence into UI',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Settings } from '@study/ui'; import { NumberControl } from '@study/ui'; const view = <Settings.Row title="Title"><NumberControl /></Settings.Row>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { Settings } from '@study/ui'; const view = <Settings.NumberRow title="Title" onSubmit={save} />;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'resolves aliases and namespaces without flagging shadowed or unrelated controls',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import * as UI from '@study/ui'; const view = <UI.Button>{t('Retry')}</UI.Button>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { Button } from '@study/ui'; function Custom({ Button }) { return <Button>{t('Retry')}</Button>; }`
      )
    ).toHaveLength(0);
    expect(
      await lint(
        { assert },
        `import { Button } from '@study/ui'; const view = <Button>{format('Retry')}</Button>;`
      )
    ).toHaveLength(0);
    expect(
      await lint(
        { assert },
        `import { Settings as S } from '@study/ui'; const view = <S.Row title="Title"><SwitchControl /></S.Row>;`
      )
    ).toHaveLength(0);
  }
);

test.unit.stable(
  'standardizes labelled settings ranges while allowing embedded range editors',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `import { Settings } from '@study/ui'; import { RangeControl } from '@study/ui'; const view = <Settings.Row title="Title"><RangeControl /></Settings.Row>;`
      )
    ).toHaveLength(1);
    expect(
      await lint(
        { assert },
        `import { RangeControl } from '@study/ui'; const view = <RangeControl label="Zoom" />;`
      )
    ).toHaveLength(0);
  }
);
