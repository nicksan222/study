import { projectSchema, automaticProjectIcon } from '@study/contracts';
import type { ProjectIcon } from '@study/contracts';
import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Schema } from 'effect';
import { afterEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport } from '#client/test/rpc.tsx';

import { SubjectIconEditor } from './subject-icon-editor';

const save = vi.hoisted(() => vi.fn());

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(() => save.mockReset());

const project = Schema.decodeUnknownSync(projectSchema)({
  id: 91n,
  name: 'Cell Biology',
  icon: automaticProjectIcon,
  examOn: null,
  createdAt: 1n,
  updatedAt: 1n
});

function mount(icon: ProjectIcon = automaticProjectIcon) {
  const transport = rpcTestTransport(async (tag, input) => {
    if (tag !== 'projects.setIcon') throw new Error(`Unexpected ${tag}`);

    return save(input);
  });

  return render(<SubjectIconEditor project={{ ...project, icon }} />, {
    wrapper: transport.wrapper
  });
}

testStable(
  'saves a valid custom monogram with exact subject identity, closing the reviewed dialog',
  async () => {
    save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
    mount();

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
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }
);

testStable('restores automatic mode without storing the derived initials', async () => {
  save.mockResolvedValue(project);
  mount({ kind: 'monogram', value: 'BIO', color: 'neutral' });
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
  fireEvent.click(screen.getByRole('button', { name: 'SubjectIconAutomatic' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith({ id: project.id, icon: automaticProjectIcon })
  );
});

testStable('retains custom letters on save failure and allows explicit retry', async () => {
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

testStable(
  'saves a searched symbol with its selected color and survives reopening the editor',
  async () => {
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
    view.rerender(<SubjectIconEditor project={{ ...project, icon }} />);
    fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
    expect(screen.getByRole('radio', { name: 'SubjectSymbolAtom' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('radio', { name: 'SubjectColorViolet' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  }
);

testStable('saves a selected emoji as a typed icon rather than a monogram', async () => {
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

testStable('retains unsaved icon choices across repeated mode clicks and switching modes', () => {
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
