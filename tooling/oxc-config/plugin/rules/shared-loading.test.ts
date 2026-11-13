import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

async function lint(source: string, path = 'apps/client/src/features/example/example.tsx') {
  return await lintRule('shared-loading', { [path]: source }, true);
}

testStable('allows component loading indicators and isLoading usage', async () => {
  expect(
    await lint(`
    import { Loading as Wait } from '@study/ui/loading';
    import { Spinner } from '@study/ui/spinner';
    export function Preview({ query, saving }) {
      if (query.isLoading) return <Wait label="Loading" />;
      return <button disabled={saving}>{saving && <Spinner label="Saving" />}</button>;
    }
  `)
  ).toStrictEqual([]);
});

testStable('rejects initial page loading returns including imported aliases', async () => {
  assert.strictEqual(
    (
      await lint(`
    import { Loading as Wait } from '@study/ui/loading';
    export function LibraryPage({ query }) {
      if (query.isLoading) return <section><Wait label="Loading" /></section>;
      return <Content />;
    }
  `)
    ).length,
    1
  );
  assert.strictEqual(
    (
      await lint(`
    export const LibraryPage = ({ query }) => {
      return query.isPending ? <Spinner /> : <Content />;
    };
  `)
    ).length,
    1
  );
});

testStable('allows page data guards and contextual component indicators', async () => {
  expect(
    await lint(`
    export function LibraryPage({ query, saving }) {
      if (query.isPending) return null;
      return <main><Content /><button disabled={saving}>{saving && <Spinner />}</button></main>;
    }
  `)
  ).toStrictEqual([]);
});

testStable('rejects custom loading text and raw animation in initial page returns', async () => {
  assert.strictEqual(
    (
      await lint(`
    export function ReaderPage({ query, t }) {
      if (query.isPending) return <p>{t('LoadingStudy')}</p>;
      return <Content />;
    }
  `)
    ).length,
    1
  );
  assert.strictEqual(
    (
      await lint(`
    export function ReaderPage({ query }) {
      if (query.isLoading) return <svg className="animate-spin" />;
      return <Content />;
    }
  `)
    ).length,
    1
  );
});

testStable('keeps the shared route pending boundary free of visual loading', async () => {
  const path = 'apps/client/src/app/shell/route-feedback.tsx';

  assert.strictEqual(
    (await lint('export function RoutePending() { return <Spinner />; }', path)).length,
    1
  );
  expect(await lint('export function RoutePending() { return null; }', path)).toStrictEqual([]);
});

testStable('requires route definitions to reuse the shared pending boundary', async () => {
  const path = 'apps/client/src/routes/library.tsx';

  assert.strictEqual(
    (await lint('const route = { pendingComponent: () => <Spinner /> };', path)).length,
    1
  );
  expect(await lint('const route = { pendingComponent: RoutePending };', path)).toStrictEqual([]);
});

testStable('does not enforce loading presentation in server code or test examples', async () => {
  for (const path of ['apps/server/src/example.tsx', 'apps/client/src/example.test.tsx'])
    expect(
      await lint(
        'export function ReaderPage({query}) { if (query.isLoading) return <Spinner />; return null; }',
        path
      )
    ).toStrictEqual([]);
});

testStable('rejects initial page loading in concise arrows and page JSX', async () => {
  assert.strictEqual(
    (
      await lint(
        'export const ReaderPage = ({ query }) => query.isLoading ? <Spinner /> : <Content />;'
      )
    ).length,
    1
  );
  assert.strictEqual(
    (
      await lint(
        'export function ReaderPage({query}) { return <main>{query.isPending && <Spinner />}</main>; }'
      )
    ).length,
    1
  );
});
