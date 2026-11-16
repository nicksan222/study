import { pageIdSchema, pageVersionIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import { MergePagesDialog } from './merge';

const api = test.hoisted(() => ({ merge: test.vi.fn() }));

test.mock('#client/lib/i18n.tsx', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'italian' })
}));
test.afterEach(() => {
  test.cleanup();
  test.vi.clearAllMocks();
});

test.stable(
  'merge explains archival, requires a title and submits selected exact versions in the UI language',
  async () => {
    const user = test.userEvent.setup();
    const harness = test.rpcTestTransport(async (tag, input) => {
      if (tag === 'pages.merge') return api.merge(input);

      throw new Error(tag);
    });
    const close = test.vi.fn();

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

    test.render(
      <harness.wrapper>
        <MergePagesDialog pages={pages} onClose={close} />
      </harness.wrapper>
    );
    test.expect(test.screen.getByText('PagesMergeHelp')).toBeInTheDocument();
    test.expect(test.screen.getByText('Document 1')).toBeInTheDocument();
    test.expect(test.screen.getByText('Document 2')).toBeInTheDocument();
    test.expect(test.screen.getByRole('button', { name: 'PagesMerge' })).toBeDisabled();
    await user.type(
      test.screen.getByRole('textbox', { name: 'PagesMergeTitle' }),
      'Combined notes'
    );
    await user.type(
      test.screen.getByRole('textbox', { name: 'PagesMergeInstruction' }),
      'Keep the examples'
    );
    await user.click(test.screen.getByRole('button', { name: 'PagesMerge' }));
    await test.waitFor(() =>
      test.expect(api.merge).toHaveBeenCalledWith(
        test.expect.objectContaining({
          title: 'Combined notes',
          instruction: 'Keep the examples',
          versions: [11n, 12n],
          language: 'italian'
        })
      )
    );
    await test.waitFor(() => test.expect(close).toHaveBeenCalledOnce());
  }
);
