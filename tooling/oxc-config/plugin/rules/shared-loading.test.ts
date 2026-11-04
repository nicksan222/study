import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';

import { lintRule } from '../test/utils.ts';

function lint(source: string, path = 'apps/web/src/features/example/example.tsx') {
  return lintRule('shared-loading', { [path]: source }, true);
}

testStable('allows component loading indicators and isLoading usage', () => {
  assert.deepEqual(
    lint(`
    import { Loading as Wait } from '@study/ui/loading';
    import { Spinner } from '@study/ui/spinner';
    export function Preview({ query, saving }) {
      if (query.isLoading) return <Wait label="Loading" />;
      return <button disabled={saving}>{saving && <Spinner label="Saving" />}</button>;
    }
  `),
    []
  );
});

testStable('rejects initial page loading returns including imported aliases', () => {
  assert.equal(
    lint(`
    import { Loading as Wait } from '@study/ui/loading';
    export function LibraryPage({ query }) {
      if (query.isLoading) return <section><Wait label="Loading" /></section>;
      return <Content />;
    }
  `).length,
    1
  );
  assert.equal(
    lint(`
    export const LibraryPage = ({ query }) => {
      return query.isPending ? <Spinner /> : <Content />;
    };
  `).length,
    1
  );
});

testStable('allows page data guards and contextual component indicators', () => {
  assert.deepEqual(
    lint(`
    export function LibraryPage({ query, saving }) {
      if (query.isPending) return null;
      return <main><Content /><button disabled={saving}>{saving && <Spinner />}</button></main>;
    }
  `),
    []
  );
});

testStable('rejects custom loading text and raw animation in initial page returns', () => {
  assert.equal(
    lint(`
    export function ReaderPage({ query, t }) {
      if (query.isPending) return <p>{t('LoadingStudy')}</p>;
      return <Content />;
    }
  `).length,
    1
  );
  assert.equal(
    lint(`
    export function ReaderPage({ query }) {
      if (query.isLoading) return <svg className="animate-spin" />;
      return <Content />;
    }
  `).length,
    1
  );
});

testStable('keeps the shared route pending boundary free of visual loading', () => {
  const path = 'apps/web/src/app/shell/route-feedback.tsx';
  assert.equal(lint('export function RoutePending() { return <Spinner />; }', path).length, 1);
  assert.deepEqual(lint('export function RoutePending() { return null; }', path), []);
});

testStable('requires route definitions to reuse the shared pending boundary', () => {
  const path = 'apps/web/src/routes/library.tsx';
  assert.equal(lint('const route = { pendingComponent: () => <Spinner /> };', path).length, 1);
  assert.deepEqual(lint('const route = { pendingComponent: RoutePending };', path), []);
});

testStable('does not enforce loading presentation in server code or test examples', () => {
  for (const path of ['apps/server/src/example.tsx', 'apps/web/src/example.test.tsx'])
    assert.deepEqual(
      lint(
        'export function ReaderPage({query}) { if (query.isLoading) return <Spinner />; return null; }',
        path
      ),
      []
    );
});

testStable('rejects initial page loading in concise arrows and page JSX', () => {
  assert.equal(
    lint('export const ReaderPage = ({ query }) => query.isLoading ? <Spinner /> : <Content />;')
      .length,
    1
  );
  assert.equal(
    lint(
      'export function ReaderPage({query}) { return <main>{query.isPending && <Spinner />}</main>; }'
    ).length,
    1
  );
});
