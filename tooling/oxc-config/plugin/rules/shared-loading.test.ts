import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lintRule } from '../test/utils.ts';

function lint(source: string) {
  return lintRule(
    'shared-loading',
    { 'apps/web/src/features/example/example.view.tsx': source },
    true
  );
}

test('requires shared loading UI in boolean and status-based JSX branches', () => {
  const diagnostics = lint(`
    export function View({ isLoading, state, pending, isFetching }) {
      if (isLoading) return <p>Wait</p>;
      if (state.status === 'loading') { return null; }
      return <><div>{pending && <p>Wait</p>}</div>{isFetching ? <p>Wait</p> : <Content />}</>;
    }
  `);

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('checks negated branches, reversed comparisons, and compound loading conditions', () => {
  const diagnostics = lint(`
    export function View({ isLoading, state, enabled }) {
      return <>{!isLoading ? <Content /> : <p>Wait</p>}
        {'pending' !== state.status ? <Content /> : null}
        {enabled && state.status === 'loading' && <p>Wait</p>}
        {(state.status === 'idle' || state.status === 'loading') ? <p>Wait</p> : <Content />}
      </>;
    }
  `);

  assert.equal(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test('accepts imported loading components, aliases, namespaces, and wrapped indicators', () => {
  assert.deepEqual(
    lint(`
    import { Loading as Wait, LoadingSkeleton } from '@study/ui/loading';
    import * as Indicators from '@study/ui/loading';
    import { Spinner as Busy } from '@study/ui/spinner';
    export function View({ isLoading, state, pending, fetching }) {
      if (isLoading) return <section><Wait label="Loading" /></section>;
      return <>{state.status === 'loading' ? <LoadingSkeleton label="Loading" /> : <Content />}
        {pending && <Indicators.Loading label="Loading" />}
        {fetching && <Busy label="Loading" />}
      </>;
    }
  `),
    []
  );
});

test('a shared component in the success branch cannot satisfy the loading branch', () => {
  const diagnostics = lint(`
    import { Loading } from '@study/ui/loading';
    export function View({ loading }) {
      return loading ? null : <Loading label="Loading" />;
    }
  `);

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('local lookalikes and shadowed imports cannot satisfy loading enforcement', () => {
  const diagnostics = lint(`
    import { Loading } from '@study/ui/loading';
    import { Spinner } from 'other-library';
    export function First({ loading, Loading }) { return loading ? <Loading /> : null; }
    export function Second({ pending }) { return pending ? <Spinner /> : null; }
  `);

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('requires shared Suspense fallbacks and resolves React aliases', () => {
  const diagnostics = lint(`
    import { Suspense as Boundary } from 'react';
    import * as React from 'react';
    export function View() {
      return <><Boundary fallback={<p>Wait</p>}><Content /></Boundary>
        <React.Suspense fallback={null}><Content /></React.Suspense></>;
    }
  `);

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('accepts shared Suspense fallbacks and unrelated fallback props', () => {
  assert.deepEqual(
    lint(`
    import { Suspense } from 'react';
    import { Loading } from '@study/ui/loading';
    export function View() {
      return <><Suspense fallback={<Loading label="Loading" />}><Content /></Suspense>
        <Image fallback={null} /></>;
    }
  `),
    []
  );
});

test('bans raw loading icons and animation utilities in application code', () => {
  const diagnostics = lint(`
    import { LoaderCircle as Busy } from 'lucide-react';
    export function View() {
      return <><Busy /><div className="motion-safe:animate-spin" />
        <span className="rounded animate-pulse" /></>;
    }
  `);

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('requires shared indicators for busy regions and localized loading messages', () => {
  const diagnostics = lint(`
    export function View({ busy }) {
      return <><section aria-busy={busy}><Content /></section>
        <p role="status">{t('LoadingSubjects')}</p><p>{t('Searching')}</p></>;
    }
  `);

  assert.equal(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test('allows ordinary status messages, non-render guards, and success-only branches', () => {
  assert.deepEqual(
    lint(`
    export function View({ ready, loading, state }) {
      function handleClick() { if (loading) return; }
      return <><p role="status">{t('SearchNoResults')}</p>
        <p role="status">{t('SubjectNotFound')}</p>
        {!loading && <Content />}{ready ? <Content /> : null}
        {state.status === 'error' ? <Error /> : <Content />}
        <section aria-busy={false}><Content /></section></>;
    }
  `),
    []
  );
});

test('ignores tests and keeps canonical loading implementations legal', () => {
  assert.deepEqual(
    lintRule(
      'shared-loading',
      {
        'apps/web/src/example.test.tsx': `import { LoaderCircle } from 'lucide-react'; const x = <p className="animate-spin" />;`,
        'packages/ui/src/components/spinner.tsx': `import { LoaderCircleIcon } from 'lucide-react'; const x = <LoaderCircleIcon className="motion-safe:visible-animate-spin" />;`,
        'packages/ui/src/components/loading.tsx': `const x = <div className="animate-pulse" />;`
      },
      true
    ),
    []
  );
});

test('accepts conditional indicators in busy regions and localized button labels', () => {
  assert.deepEqual(
    lint(`
    import { Loading } from '@study/ui/loading';
    import { Spinner } from '@study/ui/spinner';
    export function View({ canSearch, result, creating }) {
      return <><section aria-busy={canSearch && !result}>
        {canSearch && !result && <Loading label={t('Searching')} />}
      </section><button>{creating && <Spinner label={t('Saving')} />}
        {t(creating ? 'Saving' : 'CreateProject')}</button></>;
    }
  `),
    []
  );
});

test('checks loading branches passed as component props', () => {
  const diagnostics = lint(`
    export function View({ loading }) {
      return <Picker status={loading && <p>Wait</p>} />;
    }
  `);

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('does not mistake computed data lookups or boolean props for loading content', () => {
  assert.deepEqual(
    lint(`
    export function View({ loading, values, state }) {
      return <><Button disabled={loading ? true : false} />
        {values[state] ? <Content /> : null}</>;
    }
  `),
    []
  );
});

test('checks namespace loader icons and template animation classes', () => {
  const source = [
    "import * as Icons from 'lucide-react';",
    'export function View({ size }) {',
    'return <><Icons.LoaderCircle /><p className={`motion-safe:animate-pulse ${size}`} /></>;',
    '}'
  ].join('\n');
  const diagnostics = lint(source);

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('checks default React Suspense imports and missing Suspense fallbacks', () => {
  const diagnostics = lint(`
    import React, { Suspense } from 'react';
    export function View() {
      return <><React.Suspense fallback={null}><Content /></React.Suspense>
        <Suspense><Content /></Suspense></>;
    }
  `);

  assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test('checks aliased loading expressions in logical branches', () => {
  const diagnostics = lint(`
    const placeholder = <p>Please wait</p>;
    export function View({ loading }) { return <>{loading && placeholder}</>; }
  `);

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('also rejects namespace loader icons inside shared UI components', () => {
  const diagnostics = lintRule(
    'shared-loading',
    {
      'packages/ui/src/components/busy.tsx': `
      import * as Icons from 'lucide-react';
      export function Busy() { return <Icons.LoaderCircle />; }
    `
    },
    true
  );

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test('does not treat a computed property key as a loading flag', () => {
  assert.deepEqual(
    lint(`
    export function View({ values, loading }) {
      return values[loading] ? <Content /> : null;
    }
  `),
    []
  );
});

test('accepts a busy region whose matching loading branch uses a shared indicator', () => {
  assert.deepEqual(
    lint(`
    import { Loading } from '@study/ui/loading';
    export function View({ loading }) {
      return <section aria-busy={loading}>
        {loading ? <Loading label="Loading" /> : <Content />}
      </section>;
    }
  `),
    []
  );
});

test('a busy region cannot put its shared indicator only in the ready branch', () => {
  const diagnostics = lint(`
    import { Loading } from '@study/ui/loading';
    export function View({ busy }) {
      return <section aria-busy={busy}>
        {busy ? <Content /> : <Loading label="Loading" />}
      </section>;
    }
  `);

  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
});
