import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

async function lint(
  { assert: assertions }: Pick<test.Context, 'assert'>,
  source: string,
  path = 'apps/client/src/features/example/example.tsx'
) {
  const assert: test.Assert = assertions;

  return await lintRule({ assert }, 'shared-loading', { [path]: source }, true);
}

test.stable(
  'allows component loading indicators and isLoading usage',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `
    import { Loading as Wait } from '@study/ui';
    import { Spinner } from '@study/ui';
    export function Preview({ query, saving }) {
      if (query.isLoading) return <Wait label="Loading" />;
      return <button disabled={saving}>{saving && <Spinner label="Saving" />}</button>;
    }
  `
      )
    ).toStrictEqual([]);
  }
);

test.stable(
  'rejects initial page loading returns including imported aliases',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    assert.strictEqual(
      (
        await lint(
          { assert },
          `
    import { Loading as Wait } from '@study/ui';
    export function LibraryPage({ query }) {
      if (query.isLoading) return <section><Wait label="Loading" /></section>;
      return <Content />;
    }
  `
        )
      ).length,
      1
    );
    assert.strictEqual(
      (
        await lint(
          { assert },
          `
    export const LibraryPage = ({ query }) => {
      return query.isPending ? <Spinner /> : <Content />;
    };
  `
        )
      ).length,
      1
    );
  }
);

test.stable(
  'allows page data guards and contextual component indicators',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `
    export function LibraryPage({ query, saving }) {
      if (query.isPending) return null;
      return <main><Content /><button disabled={saving}>{saving && <Spinner />}</button></main>;
    }
  `
      )
    ).toStrictEqual([]);
  }
);

test.stable(
  'rejects custom loading text and raw animation in initial page returns',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    assert.strictEqual(
      (
        await lint(
          { assert },
          `
    export function ReaderPage({ query, t }) {
      if (query.isPending) return <p>{t('LoadingStudy')}</p>;
      return <Content />;
    }
  `
        )
      ).length,
      1
    );
    assert.strictEqual(
      (
        await lint(
          { assert },
          `
    export function ReaderPage({ query }) {
      if (query.isLoading) return <svg className="animate-spin" />;
      return <Content />;
    }
  `
        )
      ).length,
      1
    );
  }
);

test.stable(
  'keeps the shared route pending boundary free of visual loading',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const path = 'apps/client/src/app/shell/route-feedback.tsx';

    assert.strictEqual(
      (await lint({ assert }, 'export function RoutePending() { return <Spinner />; }', path))
        .length,
      1
    );
    expect(
      await lint({ assert }, 'export function RoutePending() { return null; }', path)
    ).toStrictEqual([]);
  }
);

test.stable(
  'requires route definitions to reuse the shared pending boundary',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const path = 'apps/client/src/routes/library.tsx';

    assert.strictEqual(
      (await lint({ assert }, 'const route = { pendingComponent: () => <Spinner /> };', path))
        .length,
      1
    );
    expect(
      await lint({ assert }, 'const route = { pendingComponent: RoutePending };', path)
    ).toStrictEqual([]);
  }
);

test.stable(
  'does not enforce loading presentation in server code or test examples',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    for (const path of ['apps/server/src/example.tsx', 'apps/client/src/example.test.tsx'])
      expect(
        await lint(
          { assert },
          'export function ReaderPage({query}) { if (query.isLoading) return <Spinner />; return null; }',
          path
        )
      ).toStrictEqual([]);
  }
);

test.stable(
  'rejects initial page loading in concise arrows and page JSX',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    assert.strictEqual(
      (
        await lint(
          { assert },
          'export const ReaderPage = ({ query }) => query.isLoading ? <Spinner /> : <Content />;'
        )
      ).length,
      1
    );
    assert.strictEqual(
      (
        await lint(
          { assert },
          'export function ReaderPage({query}) { return <main>{query.isPending && <Spinner />}</main>; }'
        )
      ).length,
      1
    );
  }
);
