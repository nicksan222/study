import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { TargetPicker, EvidenceTarget } from './annotation-target';
vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

function setup(handlers: Parameters<typeof rpcHandlersTransport>[0], child: ReactNode) {
  const harness = rpcHandlersTransport(handlers);

  return { ...render(<harness.wrapper>{child}</harness.wrapper>), ...harness };
}

testStable('selects one canonical block and rejects a split UTF-16 surrogate pair', async () => {
  const owner = authoredPage(41n, 'A😀BC', 101n);
  const doc = owner.version!;
  const pick = vi.fn();

  setup(
    {
      'pages.versions': () => Promise.resolve({ items: [], nextCursor: null }),
      'pages.version': () => Promise.resolve(doc)
    },
    <TargetPicker pageId={owner.id} initialVersion={doc.id} onPick={pick} />
  );
  await userEvent.setup().click(await screen.findByLabelText('PageBlock'));
  await userEvent.setup().click(await screen.findByRole('option', { name: '1 · A😀BC' }));
  const field = screen.getByLabelText<HTMLTextAreaElement>('PageSelectPassage');

  field.setSelectionRange(1, 2);
  fireEvent.select(field);
  expect(pick).toHaveBeenLastCalledWith(undefined);
  field.setSelectionRange(1, 3);
  fireEvent.select(field);
  expect(pick).toHaveBeenLastCalledWith({
    pageId: owner.id,
    range: {
      versionId: doc.id,
      snapshotId: doc.snapshotId,
      blockId: doc.document.blocks[0]!.id,
      start: 1,
      end: 3
    }
  });
  expect(screen.getByLabelText('AnnotationPreview')).toHaveTextContent('😀');
});

function retainedTarget() {
  const owner = authoredPage(41n, 'Retained private evidence', 101n);
  const version = owner.version!;
  const target = {
    pageId: owner.id,
    range: {
      versionId: version.id,
      snapshotId: version.snapshotId,
      blockId: version.document.blocks[0]!.id,
      start: 0,
      end: 8
    }
  };

  return { owner, version, target };
}

testStable('a retained reference never follows a different document identity', async () => {
  const { version, target } = retainedTarget();

  setup(
    {
      'pages.version': async () => ({
        ...version,
        snapshotId: authoredPage(41n, 'Replacement', 102n).version!.snapshotId
      })
    },
    <EvidenceTarget preview reference={{ kind: 'range', target }} />
  );
  expect(await screen.findByText('ReaderUnavailable')).toBeVisible();
  expect(screen.queryByText('Retained private evidence')).toBeNull();
});

testStable(
  'a mounted retained reference discards its body after a committed retirement hint',
  async () => {
    const { version, target } = retainedTarget();
    const read = vi.fn().mockResolvedValue(version);
    const view = setup(
      { 'pages.version': read },
      <EvidenceTarget preview reference={{ kind: 'range', target }} />
    );

    await screen.findByText('Retained');
    read.mockRejectedValue(new StudyError('not_found', 'Retired'));
    await act(() => view.notify());
    await waitFor(() => expect(screen.queryByText('Retained')).toBeNull());
    expect(await screen.findByText('ReaderUnavailable')).toBeVisible();
  }
);
