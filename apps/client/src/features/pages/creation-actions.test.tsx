import { projectIdSchema, pageIdSchema } from '@study/contracts';
import { test } from '@study/testing';

import { NewBlankPage } from './creation-actions';

const api = test.hoisted(() => ({
  create: test.vi.fn(),
  owner: test.vi.fn(),
  navigate: test.vi.fn()
}));

test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
test.mock('@tanstack/react-router', () => ({ useNavigate: () => api.navigate }));
test.mock('../note-workspace', () => ({ useBlankPageCreation: api.owner }));

test.beforeEach(() => {
  test.vi.resetAllMocks();
  api.owner.mockReturnValue({ create: api.create, pending: false, error: undefined });
  api.create.mockResolvedValue({ id: pageIdSchema.make(5n) });
  api.navigate.mockResolvedValue(undefined);
});
test.afterEach(test.cleanup);

test.stable('opens a subject-owned blank page directly in the shared editor', async () => {
  const project = projectIdSchema.make(2n);

  test.render(<NewBlankPage project={project} />);
  await test.userEvent.click(test.screen.getByRole('button', { name: 'PageNew' }));
  test.expect(api.owner).toHaveBeenCalledWith({ kind: 'project', projectId: project });
  test.expect(api.create).toHaveBeenCalledExactlyOnceWith('NoteNewPage');
  await test.waitFor(() =>
    test.expect(api.navigate).toHaveBeenCalledWith({
      to: '/pages/$pageId',
      params: { pageId: '5' },
      search: { project: '2' }
    })
  );
  test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test.stable(
  'reopens the known document after a navigation failure without creating a duplicate',
  async () => {
    api.navigate.mockRejectedValueOnce(new Error('Navigation unavailable'));
    test.render(<NewBlankPage />);
    await test.userEvent.click(test.screen.getByRole('button', { name: 'PageNew' }));
    await test.userEvent.click(await test.screen.findByRole('button', { name: 'Retry' }));
    await test.waitFor(() => test.expect(api.navigate).toHaveBeenCalledTimes(2));
    test.expect(api.create).toHaveBeenCalledTimes(1);
  }
);
