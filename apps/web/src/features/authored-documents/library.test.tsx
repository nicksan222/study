import { testStable } from '@study/testing/vitest';
import { screen, within } from '@testing-library/react';
import { Effect } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { authoredDocument } from '../document-editing/test-support';
import { materialRpc, mountLibraryRoute, importedSource } from '../material-library/test/support';

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

testStable('shows authored outputs in the main library with their own document route', async () => {
  const rpc = materialRpc();
  rpc['documents.documents'].mockReturnValue(
    Effect.succeed({
      items: [{ ...authoredDocument(41n), title: 'Authored notebook' }],
      nextCursor: null
    })
  );
  mountLibraryRoute('/library', rpc);
  expect(
    await within(await screen.findByRole('main')).findByRole('link', { name: /Authored notebook/ })
  ).toHaveAttribute('href', '/documents/41');
});

testStable('shows source uploads directly without waiting for a Material projection', async () => {
  const rpc = materialRpc();
  rpc['sources.sources'].mockReturnValue(
    Effect.succeed({ items: [{ ...importedSource, name: 'Original upload' }], next: null })
  );
  mountLibraryRoute('/library', rpc);
  const main = within(await screen.findByRole('main'));
  expect(await main.findByRole('link', { name: /Original upload/ })).toHaveAttribute(
    'href',
    `/sources/${importedSource.id}`
  );
});
