import { pageIdSchema, pageVersionIdSchema } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { MergePagesDialog } from './merge';

const api = vi.hoisted(() => ({ merge: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'italian' })
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

testStable(
  'merge explains archival, requires a title and submits selected exact versions in the UI language',
  async () => {
    const user = userEvent.setup();
    const harness = rpcTestTransport(async (tag, input) => {
      if (tag === 'pages.merge') return api.merge(input);

      throw new Error(tag);
    });
    const close = vi.fn();

    api.merge.mockResolvedValue({
      id: 'document/merge/test',
      contextRequestId: 'merge-context',
      title: 'Combined notes',
      operations: ['summarize'],
      noteId: null,
      eventId: 'merge-event',
      instruction: 'Keep the examples',
      cancelled: false,
      errorKind: null,
      resultVersionId: null,
      report: null
    });
    const pages = [1n, 2n].map((id) => ({
      id: pageIdSchema.make(id),
      title: `Document ${id}`,
      description: null,
      headVersionId: pageVersionIdSchema.make(id + 10n),
      createdAt: 1n,
      updatedAt: 1n,
      archivedAt: null,
      projectIds: []
    }));

    render(
      <harness.wrapper>
        <MergePagesDialog pages={pages} onClose={close} />
      </harness.wrapper>
    );
    expect(screen.getByText('PagesMergeHelp')).toBeInTheDocument();
    expect(screen.getByText('Document 1')).toBeInTheDocument();
    expect(screen.getByText('Document 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PagesMerge' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'PagesMergeTitle' }), 'Combined notes');
    await user.type(
      screen.getByRole('textbox', { name: 'PagesMergeInstruction' }),
      'Keep the examples'
    );
    await user.click(screen.getByRole('button', { name: 'PagesMerge' }));
    await waitFor(() =>
      expect(api.merge).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Combined notes',
          instruction: 'Keep the examples',
          versions: [11n, 12n],
          language: 'italian'
        })
      )
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  }
);
