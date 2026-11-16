import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

async function lint(source: string) {
  return await lintRule(
    'shared-error-state',
    { 'apps/client/src/features/example/view.tsx': source },
    true
  );
}

test.stable('rejects custom alert prose and retry controls', async () => {
  const diagnostics = await lint(`
    export function View() {
      return <div role="alert"><p>Could not load</p><button>Retry</button></div>;
    }
  `);

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test.stable('checks boolean error branches, early returns, and status comparisons', async () => {
  const diagnostics = await lint(`
    export function View({ error, state }) {
      if (state.isError) return <p>Could not load</p>;
      return <>{error && <p>Try again</p>}
        {state.status === 'error' ? <button>Retry</button> : <Content />}
        {state.status !== 'failed' ? <Content /> : <section>Could not load</section>}
      </>;
    }
  `);

  test.assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
});

test.stable('handles negation, compound guards, and error branches passed as props', async () => {
  const diagnostics = await lint(`
    export function View({ error, enabled, result }) {
      return <>{!error ? <Content /> : <p>Failed</p>}
        {enabled && result.error && <p>Failed</p>}
        <Picker status={result.isError && <button>Try again</button>} />
      </>;
    }
  `);

  test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test.stable('accepts canonical imports, aliases, namespaces, and feature wrappers', async () => {
  test
    .expect(
      await lint(`
    import { ErrorState as Failure } from '@study/ui';
    import * as Feedback from '@study/ui';
    export function NoteError() { return <Failure title="Failed" />; }
    export function View({ error, state }) {
      return <>{error && <NoteError />}
        {state.isError ? <section><Feedback.ErrorState title="Failed" /></section> : <Content />}
      </>;
    }
  `)
    )
    .toStrictEqual([]);
});

test.stable('does not trust a same-named local implementation or a shadowed import', async () => {
  const diagnostics = await lint(`
    import { ErrorState } from '@study/ui';
    function LocalErrorState() { return <p role="alert">Failed</p>; }
    export function View({ error, ErrorState }) {
      return <>{error && <ErrorState role="alert" />}</>;
    }
  `);

  test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
});

test.stable('does not let the success branch supply the canonical error presentation', async () => {
  const diagnostics = await lint(`
    import { ErrorState } from '@study/ui';
    export function View({ error }) {
      return error ? <p>Failed</p> : <ErrorState title="Failed" />;
    }
  `);

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test.stable(
  'accepts ordinary field validation, live statuses, and non-render error guards',
  async () => {
    test
      .expect(
        await lint(`
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
      )
      .toStrictEqual([]);
  }
);

test.stable('checks aliases of custom error markup and skips null recovery branches', async () => {
  const diagnostics = await lint(`
    const failure = <p>Failed</p>;
    export function View({ error }) { return error ? failure : null; }
  `);

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  test
    .expect(
      await lint(`export function View({ error }) { if (error) return null; return <Content />; }`)
    )
    .toStrictEqual([]);
});

test.stable(
  'checks custom component alerts but accepts the canonical component itself',
  async () => {
    const diagnostics = await lint(`
    import { ErrorState } from '@study/ui';
    export function View() {
      return <><Notice role={'alert'}>Failed</Notice><ErrorState role="alert" title="Failed" /></>;
    }
  `);

    test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.stable('ignores tests, server code and canonical UI implementations', async () => {
  test
    .expect(
      await lintRule(
        'shared-error-state',
        {
          'apps/client/src/example.test.tsx': 'const view = <p role="alert">Failed</p>;',
          'apps/server/src/example.tsx': 'const view = <p role="alert">Failed</p>;',
          'packages/ui/src/components/error-state.tsx': 'const view = <p role="alert">Failed</p>;'
        },
        true
      )
    )
    .toStrictEqual([]);
});

test.stable('checks shared button aliases used as a whole error presentation', async () => {
  const diagnostics = await lint(`
    import { Button as RetryButton } from '@study/ui';
    export function View({ error }) { return error && <RetryButton>{t('Retry')}</RetryButton>; }
  `);

  test.assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
});

test.stable(
  'retains canonical Sidebar.Message alerts without allowing raw sidebar implementations',
  async () => {
    test
      .expect(
        await lint(`
    import { Sidebar as AppSidebar } from '@study/ui';
    import * as UI from '@study/ui';
    export function View({ error }) { return <>{error && <AppSidebar.Message role="alert">Failed</AppSidebar.Message>}<UI.Sidebar.Message role="alert">Failed</UI.Sidebar.Message></>; }
  `)
      )
      .toStrictEqual([]);
    const diagnostics = await lint(`
    import { Sidebar } from '@study/ui';
    export function View({ error, Sidebar }) { return <>{error && <Sidebar.Message role="alert">Failed</Sidebar.Message>}<p role="alert">Failed</p></>; }
  `);

    test.assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.stable('checks named error presenters even when they omit alert semantics', async () => {
  const diagnostics = await lint(`
    function ErrorState() { return <p>Failed</p>; }
    const RouteError = () => <section>{t('Failure')}</section>;
    const NoteError = () => { return <div>Failed</div>; };
  `);

  test.assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
});

test.stable(
  'declared error presenters without function bodies do not crash traversal',
  async () => {
    test.expect(await lint('declare function NoteError(): JSX.Element;')).toStrictEqual([]);
  }
);
