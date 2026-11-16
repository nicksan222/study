import { projectIdSchema, pageIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import type * as __MockType0 from './creation-actions';

let NewBlankPage: typeof __MockType0.NewBlankPage;

let api: ReturnType<typeof createMockState>['api'];

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      create: mock.fn(),
      owner: mock.fn(),
      navigate: mock.fn()
    }))()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  mock('@tanstack/react-router', () => ({ useNavigate: () => api.navigate }));
  mock('#client/features/note-workspace', () => ({ useBlankPageCreation: api.owner }));
  const __mockModule0 = await import('./creation-actions');

  NewBlankPage = __mockModule0.NewBlankPage;
});

test.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  api.owner.mockReturnValue({ create: api.create, pending: false, error: undefined });
  api.create.mockResolvedValue({ id: pageIdSchema.make(5n) });
  api.navigate.mockResolvedValue(undefined);
});
test.afterEach(({ cleanup }) => cleanup());

test.stable(
  'opens a subject-owned blank page directly in the shared editor',
  async ({ render, userEvent, screen, expect, waitFor }) => {
    const project = projectIdSchema.make(2n);

    render(<NewBlankPage project={project} />);
    await userEvent.click(screen.getByRole('button', { name: 'PageNew' }));
    expect(api.owner).toHaveBeenCalledWith({ kind: 'project', projectId: project });
    expect(api.create).toHaveBeenCalledExactlyOnceWith('NoteNewPage');
    await waitFor(() =>
      expect(api.navigate).toHaveBeenCalledWith({
        to: '/pages/$pageId',
        params: { pageId: '5' },
        search: { project: '2' }
      })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);

test.stable(
  'reopens the known document after a navigation failure without creating a duplicate',
  async ({ render, userEvent, screen, waitFor, expect }) => {
    api.navigate.mockRejectedValueOnce(new Error('Navigation unavailable'));
    render(<NewBlankPage />);
    await userEvent.click(screen.getByRole('button', { name: 'PageNew' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.navigate).toHaveBeenCalledTimes(2));
    expect(api.create).toHaveBeenCalledTimes(1);
  }
);
