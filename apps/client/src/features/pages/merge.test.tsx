import { pageIdSchema, pageVersionIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import type * as __MockType0 from './merge';

let MergePagesDialog: typeof __MockType0.MergePagesDialog;

let api: ReturnType<typeof createMockState>['api'];

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({ merge: mock.fn() }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({
    useI18n: () => ({ t: (key: string) => key, locale: 'italian' })
  }));
  const __mockModule0 = await import('./merge');

  MergePagesDialog = __mockModule0.MergePagesDialog;
});

test.unit.afterEach(({ cleanup, vi }) => {
  cleanup();
  vi.clearAllMocks();
});

test.unit.stable(
  'merge explains archival, requires a title and submits selected exact versions in the UI language',
  async ({ userEvent, rpcTestTransport, vi, render, expect, screen, waitFor }) => {
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
