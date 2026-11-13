import { projectIdSchema, pageIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { NewBlankPage } from './creation-actions';

const api = vi.hoisted(() => ({ create: vi.fn(), owner: vi.fn(), navigate: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => api.navigate }));
vi.mock('../note-workspace', () => ({ useBlankPageCreation: api.owner }));

beforeEach(() => {
  vi.resetAllMocks();
  api.owner.mockReturnValue({ create: api.create, pending: false, error: undefined });
  api.create.mockResolvedValue({ id: pageIdSchema.make(5n) });
  api.navigate.mockResolvedValue(undefined);
});
afterEach(cleanup);

testStable('opens a subject-owned blank page directly in the shared editor', async () => {
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
});

testStable(
  'reopens the known document after a navigation failure without creating a duplicate',
  async () => {
    api.navigate.mockRejectedValueOnce(new Error('Navigation unavailable'));
    render(<NewBlankPage />);
    await userEvent.click(screen.getByRole('button', { name: 'PageNew' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.navigate).toHaveBeenCalledTimes(2));
    expect(api.create).toHaveBeenCalledTimes(1);
  }
);
