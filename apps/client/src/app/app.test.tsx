import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { App } from './app';

test.stable.for(['/', '/unknown'])('opens the note starter for %s', async (url, { rpc }) => {
  history.replaceState(null, '', url);
  rpc.givenWorkspace();

  test.render(<App transport={rpc.transport} />);
  test
    .expect(await test.screen.findByRole('heading', { name: catalogs.english.Notes }))
    .toBeInTheDocument();
});

test.stable('opens a lowercase deep link without hash routing', async ({ rpc }) => {
  history.replaceState(null, '', '/notes?project=9007199254740993');
  rpc.givenWorkspace();

  test.render(<App transport={rpc.transport} />);
  await test.screen.findByRole('heading', { name: catalogs.english.Notes });
  test.expect(location.pathname).toBe('/projects/9007199254740993/notes');
  test.expect(location.search).toBe('');
  test.expect(location.hash).toBe('');
});
