import { testStable } from '@study/testing/vitest';
import { assert, expect } from 'vite-plus/test';

import { lintRule } from '../test/utils.ts';

function lint(source: string) {
  return lintRule('shared-error-state', { 'apps/web/src/features/example/view.tsx': source }, true);
}

testStable('rejects custom alert prose and retry controls', () => {
  const diagnostics = lint(`
    export function View() {
      return <div role="alert"><p>Could not load</p><button>Retry</button></div>;
    }
  `);

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('checks boolean error branches, early returns, and status comparisons', () => {
  const diagnostics = lint(`
    export function View({ error, state }) {
      if (state.isError) return <p>Could not load</p>;
      return <>{error && <p>Try again</p>}
        {state.status === 'error' ? <button>Retry</button> : <Content />}
        {state.status !== 'failed' ? <Content /> : <section>Could not load</section>}
      </>;
    }
  `);

  assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

testStable('handles negation, compound guards, and error branches passed as props', () => {
  const diagnostics = lint(`
    export function View({ error, enabled, result }) {
      return <>{!error ? <Content /> : <p>Failed</p>}
        {enabled && result.error && <p>Failed</p>}
        <Picker status={result.isError && <button>Try again</button>} />
      </>;
    }
  `);

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable('accepts canonical imports, aliases, namespaces, and feature wrappers', () => {
  expect(
    lint(`
    import { ErrorState as Failure } from '@study/ui/error-state';
    import * as Feedback from '@study/ui/error-state';
    export function SessionError() { return <Failure title="Failed" />; }
    export function View({ error, state }) {
      return <>{error && <SessionError />}
        {state.isError ? <section><Feedback.ErrorState title="Failed" /></section> : <Content />}
      </>;
    }
  `)
  ).toStrictEqual([]);
});

testStable('does not trust a same-named local implementation or a shadowed import', () => {
  const diagnostics = lint(`
    import { ErrorState } from '@study/ui/error-state';
    function LocalErrorState() { return <p role="alert">Failed</p>; }
    export function View({ error, ErrorState }) {
      return <>{error && <ErrorState role="alert" />}</>;
    }
  `);

  assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

testStable('does not let the success branch supply the canonical error presentation', () => {
  const diagnostics = lint(`
    import { ErrorState } from '@study/ui/error-state';
    export function View({ error }) {
      return error ? <p>Failed</p> : <ErrorState title="Failed" />;
    }
  `);

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('accepts ordinary field validation, live statuses, and non-render error guards', () => {
  expect(
    lint(`
    export function View({ fieldError, state, error }) {
      function retry() { if (error) return; }
      return <form><input aria-invalid={!!fieldError} aria-describedby="name-error" />
        {fieldError && <p id="name-error" role="alert">Enter a name</p>}
        <p role="status">Saved</p>
        {state.isError && <input aria-invalid />}
        {!error && <Content />}
      </form>;
    }
  `)
  ).toStrictEqual([]);
});

testStable('checks aliases of custom error markup and skips null recovery branches', () => {
  const diagnostics = lint(`
    const failure = <p>Failed</p>;
    export function View({ error }) { return error ? failure : null; }
  `);

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  expect(
    lint(`export function View({ error }) { if (error) return null; return <Content />; }`)
  ).toStrictEqual([]);
});

testStable('checks custom component alerts but accepts the canonical component itself', () => {
  const diagnostics = lint(`
    import { ErrorState } from '@study/ui/error-state';
    export function View() {
      return <><Notice role={'alert'}>Failed</Notice><ErrorState role="alert" title="Failed" /></>;
    }
  `);

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable('ignores tests, server code and canonical UI implementations', () => {
  expect(
    lintRule(
      'shared-error-state',
      {
        'apps/web/src/example.test.tsx': 'const view = <p role="alert">Failed</p>;',
        'apps/server/src/example.tsx': 'const view = <p role="alert">Failed</p>;',
        'packages/ui/src/components/error-state.tsx': 'const view = <p role="alert">Failed</p>;'
      },
      true
    )
  ).toStrictEqual([]);
});

testStable('checks shared button aliases used as a whole error presentation', () => {
  const diagnostics = lint(`
    import { Button as RetryButton } from '@study/ui/button';
    export function View({ error }) { return error && <RetryButton>{t('Retry')}</RetryButton>; }
  `);

  assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

testStable(
  'retains canonical Sidebar.Message alerts without allowing raw sidebar implementations',
  () => {
    expect(
      lint(`
    import { Sidebar as AppSidebar } from '@study/ui/sidebar';
    import * as UI from '@study/ui/sidebar';
    export function View({ error }) { return <>{error && <AppSidebar.Message role="alert">Failed</AppSidebar.Message>}<UI.Sidebar.Message role="alert">Failed</UI.Sidebar.Message></>; }
  `)
    ).toStrictEqual([]);
    const diagnostics = lint(`
    import { Sidebar } from '@study/ui/sidebar';
    export function View({ error, Sidebar }) { return <>{error && <Sidebar.Message role="alert">Failed</Sidebar.Message>}<p role="alert">Failed</p></>; }
  `);

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

testStable('checks named error presenters even when they omit alert semantics', () => {
  const diagnostics = lint(`
    function ErrorState() { return <p>Failed</p>; }
    const RouteError = () => <section>{t('Failure')}</section>;
    const SessionError = () => { return <div>Failed</div>; };
  `);

  assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

testStable('declared error presenters without function bodies do not crash traversal', () => {
  expect(lint('declare function SessionError(): JSX.Element;')).toStrictEqual([]);
});
