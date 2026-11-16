import { test } from '@study/testing';

import { lintRule } from '../test/utils.ts';

async function lint({ assert: assertions }: Pick<test.unit.Context, 'assert'>, source: string) {
  const assert: test.Assert = assertions;

  return await lintRule(
    { assert },
    'shared-error-state',
    { 'apps/client/src/features/example/view.tsx': source },
    true
  );
}

test.unit.stable(
  'rejects custom alert prose and retry controls',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    export function View() {
      return <div role="alert"><p>Could not load</p><button>Retry</button></div>;
    }
  `
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'checks boolean error branches, early returns, and status comparisons',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    export function View({ error, state }) {
      if (state.isError) return <p>Could not load</p>;
      return <>{error && <p>Try again</p>}
        {state.status === 'error' ? <button>Retry</button> : <Content />}
        {state.status !== 'failed' ? <Content /> : <section>Could not load</section>}
      </>;
    }
  `
    );

    assert.strictEqual(diagnostics.length, 4, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'handles negation, compound guards, and error branches passed as props',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    export function View({ error, enabled, result }) {
      return <>{!error ? <Content /> : <p>Failed</p>}
        {enabled && result.error && <p>Failed</p>}
        <Picker status={result.isError && <button>Try again</button>} />
      </>;
    }
  `
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'accepts canonical imports, aliases, namespaces, and feature wrappers',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `
    import { ErrorState as Failure } from '@study/ui';
    import * as Feedback from '@study/ui';
    export function NoteError() { return <Failure title="Failed" />; }
    export function View({ error, state }) {
      return <>{error && <NoteError />}
        {state.isError ? <section><Feedback.ErrorState title="Failed" /></section> : <Content />}
      </>;
    }
  `
      )
    ).toStrictEqual([]);
  }
);

test.unit.stable(
  'does not trust a same-named local implementation or a shadowed import',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    import { ErrorState } from '@study/ui';
    function LocalErrorState() { return <p role="alert">Failed</p>; }
    export function View({ error, ErrorState }) {
      return <>{error && <ErrorState role="alert" />}</>;
    }
  `
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'does not let the success branch supply the canonical error presentation',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    import { ErrorState } from '@study/ui';
    export function View({ error }) {
      return error ? <p>Failed</p> : <ErrorState title="Failed" />;
    }
  `
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'accepts ordinary field validation, live statuses, and non-render error guards',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `
    export function View({ fieldError, state, error }) {
      function retry() { if (error) return; }
      return <form><input aria-invalid={!!fieldError} aria-describedby="name-error" />
        {fieldError && <p id="name-error" role="alert">Enter a name</p>}
        <p role="status">Saved</p>
        {state.isError && <input aria-invalid />}
        {!error && <Content />}
      </form>;
    }
  `
      )
    ).toStrictEqual([]);
  }
);

test.unit.stable(
  'checks aliases of custom error markup and skips null recovery branches',
  async ({ assert: assertions, expect }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    const failure = <p>Failed</p>;
    export function View({ error }) { return error ? failure : null; }
  `
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
    expect(
      await lint(
        { assert },
        `export function View({ error }) { if (error) return null; return <Content />; }`
      )
    ).toStrictEqual([]);
  }
);

test.unit.stable(
  'checks custom component alerts but accepts the canonical component itself',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    import { ErrorState } from '@study/ui';
    export function View() {
      return <><Notice role={'alert'}>Failed</Notice><ErrorState role="alert" title="Failed" /></>;
    }
  `
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'ignores tests, server code and canonical UI implementations',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lintRule(
        { assert },
        'shared-error-state',
        {
          'apps/client/src/example.test.tsx': 'const view = <p role="alert">Failed</p>;',
          'apps/server/src/example.tsx': 'const view = <p role="alert">Failed</p>;',
          'packages/ui/src/components/error-state.tsx': 'const view = <p role="alert">Failed</p>;'
        },
        true
      )
    ).toStrictEqual([]);
  }
);

test.unit.stable(
  'checks shared button aliases used as a whole error presentation',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    import { Button as RetryButton } from '@study/ui';
    export function View({ error }) { return error && <RetryButton>{t('Retry')}</RetryButton>; }
  `
    );

    assert.strictEqual(diagnostics.length, 1, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'retains canonical Sidebar.Message alerts without allowing raw sidebar implementations',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(
      await lint(
        { assert },
        `
    import { Sidebar as AppSidebar } from '@study/ui';
    import * as UI from '@study/ui';
    export function View({ error }) { return <>{error && <AppSidebar.Message role="alert">Failed</AppSidebar.Message>}<UI.Sidebar.Message role="alert">Failed</UI.Sidebar.Message></>; }
  `
      )
    ).toStrictEqual([]);
    const diagnostics = await lint(
      { assert },
      `
    import { Sidebar } from '@study/ui';
    export function View({ error, Sidebar }) { return <>{error && <Sidebar.Message role="alert">Failed</Sidebar.Message>}<p role="alert">Failed</p></>; }
  `
    );

    assert.strictEqual(diagnostics.length, 2, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'checks named error presenters even when they omit alert semantics',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const diagnostics = await lint(
      { assert },
      `
    function ErrorState() { return <p>Failed</p>; }
    const RouteError = () => <section>{t('Failure')}</section>;
    const NoteError = () => { return <div>Failed</div>; };
  `
    );

    assert.strictEqual(diagnostics.length, 3, JSON.stringify(diagnostics));
  }
);

test.unit.stable(
  'declared error presenters without function bodies do not crash traversal',
  async ({ expect, assert: assertions }) => {
    const assert: test.Assert = assertions;

    expect(await lint({ assert }, 'declare function NoteError(): JSX.Element;')).toStrictEqual([]);
  }
);
