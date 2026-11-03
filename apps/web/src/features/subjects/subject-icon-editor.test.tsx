import { projectSchema, automaticProjectIcon } from '@study/contracts/projects/schemas';
import type { ProjectIcon } from '@study/contracts/projects/schemas';
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
  icon: automaticProjectIcon,
  examOn: null,
  createdAt: 1n,
  updatedAt: 1n
});
function mount(icon: ProjectIcon = automaticProjectIcon) {
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
    expect(save).toHaveBeenCalledExactlyOnceWith({
      id: project.id,
      icon: { kind: 'monogram', value: 'BIO', color: 'neutral' }
    })
  );
  expect(cache.getQueryData(['projects', 'collection', String(project.id)])).toMatchObject({
    icon: { kind: 'monogram', value: 'BIO', color: 'neutral' }
  });
});
it('restores automatic mode without storing the derived initials', async () => {
  save.mockResolvedValue(project);
  mount({ kind: 'monogram', value: 'BIO', color: 'neutral' });
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconAutomatic' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({ id: project.id, icon: automaticProjectIcon })
  );
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

it('saves a searched symbol with its selected color and survives reopening the editor', async () => {
  save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconSymbols' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'SubjectIconSearch' }), {
    target: { value: 'SubjectSymbolAtom' }
  });
  fireEvent.click(screen.getByRole('radio', { name: 'SubjectSymbolAtom' }));
  fireEvent.click(screen.getByRole('radio', { name: 'SubjectColorViolet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  const icon = { kind: 'symbol', value: 'atom', color: 'violet' } as const;
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith({ id: project.id, icon }));
  view.rerender(
    <QueryClientProvider client={view.cache}>
      <SubjectIconEditor project={{ ...project, icon }} />
    </QueryClientProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  expect(screen.getByRole('radio', { name: 'SubjectSymbolAtom' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  expect(screen.getByRole('radio', { name: 'SubjectColorViolet' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
});
it('saves a selected emoji as a typed icon rather than a monogram', async () => {
  save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconEmojis' }));
  fireEvent.click(screen.getByRole('radio', { name: 'SubjectIconEmojiLabel 📚' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({
      id: project.id,
      icon: { kind: 'emoji', value: '📚', color: 'neutral' }
    })
  );
});

it('retains unsaved icon choices across repeated mode clicks and switching modes', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconSymbols' }));
  fireEvent.click(screen.getByRole('radio', { name: 'SubjectSymbolAtom' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconSymbols' }));
  expect(screen.getByRole('radio', { name: 'SubjectSymbolAtom' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconEmojis' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconSymbols' }));
  expect(screen.getByRole('radio', { name: 'SubjectSymbolAtom' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
});
