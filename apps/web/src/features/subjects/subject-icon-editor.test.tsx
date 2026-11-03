import { projectSchema } from '@study/contracts/projects/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { SubjectIconEditor } from './subject-icon-editor';

const save = vi.hoisted(() => vi.fn());
vi.mock('../../lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/study-client/request', () => ({
  request: (fn: (client: unknown) => unknown) => fn({ 'projects.setIcon': save })
}));
const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  save.mockReset();
});
const project = Schema.decodeUnknownSync(projectSchema)({
  id: 91n,
  name: 'Cell Biology',
  icon: null,
  examOn: null,
  createdAt: 1n,
  updatedAt: 1n
});
function mount(icon: string | null = null) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(cache);
  return {
    cache,
    ...render(
      <QueryClientProvider client={cache}>
        <SubjectIconEditor project={{ ...project, icon }} />
      </QueryClientProvider>
    )
  };
}
it('saves a valid custom monogram with exact subject identity, preserving canonical response in cache', async () => {
  save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
  const { cache } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  expect(screen.getByText('CB')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconCustom' }));
  const input = screen.getByRole('textbox', { name: 'SubjectIconLetters' });
  fireEvent.change(input, { target: { value: 'ABCD' } });
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.change(input, { target: { value: 'bio' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({ id: project.id, icon: 'BIO' })
  );
  expect(cache.getQueryData(['projects', 'collection', String(project.id)])).toMatchObject({
    icon: 'BIO'
  });
});
it('restores automatic mode without storing the derived initials', async () => {
  save.mockResolvedValue(project);
  mount('BIO');
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconAutomatic' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ id: project.id, icon: null }));
});
it('retains custom letters on save failure and allows explicit retry', async () => {
  save.mockRejectedValue(new Error('offline'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconCustom' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'SubjectIconLetters' }), {
    target: { value: 'BIO' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('SubjectIconSaveFailed')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'SubjectIconLetters' })).toHaveValue('BIO');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});
