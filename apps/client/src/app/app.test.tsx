import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { App } from './app';

test.stable.for(['/', '/unknown'])(
  'opens the note starter for %s',
  async (url, { rpc, render, expect, screen }) => {
    history.replaceState(null, '', url);
    rpc.givenWorkspace();

    render(<App transport={rpc.transport} />);
    expect(
      await screen.findByRole('heading', { name: catalogs.english.Notes })
    ).toBeInTheDocument();
  }
);

test.stable(
  'opens a lowercase deep link without hash routing',
  async ({ rpc, render, screen, expect }) => {
    history.replaceState(null, '', '/notes?project=9007199254740993');
    rpc.givenWorkspace();

    render(<App transport={rpc.transport} />);
    await screen.findByRole('heading', { name: catalogs.english.Notes });
    expect(location.pathname).toBe('/projects/9007199254740993/notes');
    expect(location.search).toBe('');
    expect(location.hash).toBe('');
  }
);
