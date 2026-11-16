import { projectSchema, automaticProjectIcon } from '@study/contracts';
import type { ProjectIcon } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './subject-icon-editor';

let SubjectIconEditor: typeof __MockType0.SubjectIconEditor;

let save: ReturnType<typeof createMockState>['save'];

function createMockState(mock: test.Mock) {
  return {
    save: (() => mock.fn())()
  };
}

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  save = __mockState.save;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./subject-icon-editor');

  SubjectIconEditor = __mockModule0.SubjectIconEditor;
});

test.afterEach(() => save.mockReset());

const project = Schema.decodeUnknownSync(projectSchema)({
  id: 91n,
  name: 'Cell Biology',
  icon: automaticProjectIcon,
  examOn: null,
  createdAt: 1n,
  updatedAt: 1n
});

function mount(icon: ProjectIcon = automaticProjectIcon) {
  const transport = test.rpcTestTransport(async (tag, input) => {
    if (tag !== 'projects.setIcon') throw new Error(`Unexpected ${tag}`);

    return save(input);
  });

  return test.render(<SubjectIconEditor project={{ ...project, icon }} />, {
    wrapper: transport.wrapper
  });
}

test.stable(
  'saves a valid custom monogram with exact subject identity, closing the reviewed dialog',
  async () => {
    save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
    mount();

    test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconChange' }));
    test.expect(test.screen.getByText('CB')).toBeVisible();
    test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconCustom' }));
    const input = test.screen.getByRole('textbox', { name: 'SubjectIconLetters' });

    test.fireEvent.change(input, { target: { value: 'ABCD' } });
    test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    test.fireEvent.change(input, { target: { value: 'bio' } });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
    await test.waitFor(() =>
      test.expect(save).toHaveBeenCalledExactlyOnceWith({
        id: project.id,
        icon: { kind: 'monogram', value: 'BIO', color: 'neutral' }
      })
    );
    await test.waitFor(() =>
      test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  }
);

test.stable('restores automatic mode without storing the derived initials', async () => {
  save.mockResolvedValue(project);
  mount({ kind: 'monogram', value: 'BIO', color: 'neutral' });
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconChange' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconAutomatic' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  await test.waitFor(() =>
    test
      .expect(save)
      .toHaveBeenCalledExactlyOnceWith({ id: project.id, icon: automaticProjectIcon })
  );
});

test.stable('retains custom letters on save failure and allows explicit retry', async () => {
  save.mockRejectedValue(new Error('offline'));
  mount();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconChange' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconCustom' }));
  test.fireEvent.change(test.screen.getByRole('textbox', { name: 'SubjectIconLetters' }), {
    target: { value: 'BIO' }
  });
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  test.expect(await test.screen.findByText('SubjectIconSaveFailed')).toBeVisible();
  test.expect(test.screen.getByRole('textbox', { name: 'SubjectIconLetters' })).toHaveValue('BIO');
  test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test.stable(
  'saves a searched symbol with its selected color and survives reopening the editor',
  async () => {
    save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
    const view = mount();

    test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconChange' }));
    test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconSymbols' }));
    test.fireEvent.change(test.screen.getByRole('textbox', { name: 'SubjectIconSearch' }), {
      target: { value: 'SubjectSymbolAtom' }
    });
    test.fireEvent.click(test.screen.getByRole('radio', { name: 'SubjectSymbolAtom' }));
    test.fireEvent.click(test.screen.getByRole('radio', { name: 'SubjectColorViolet' }));
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
    const icon = { kind: 'symbol', value: 'atom', color: 'violet' } as const;

    await test.waitFor(() =>
      test.expect(save).toHaveBeenCalledExactlyOnceWith({ id: project.id, icon })
    );
    view.rerender(<SubjectIconEditor project={{ ...project, icon }} />);
    test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconChange' }));
    test
      .expect(test.screen.getByRole('radio', { name: 'SubjectSymbolAtom' }))
      .toHaveAttribute('aria-checked', 'true');
    test
      .expect(test.screen.getByRole('radio', { name: 'SubjectColorViolet' }))
      .toHaveAttribute('aria-checked', 'true');
  }
);

test.stable('saves a selected emoji as a typed icon rather than a monogram', async () => {
  save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
  mount();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconChange' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconEmojis' }));
  test.fireEvent.click(test.screen.getByRole('radio', { name: 'SubjectIconEmojiLabel 📚' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  await test.waitFor(() =>
    test.expect(save).toHaveBeenCalledExactlyOnceWith({
      id: project.id,
      icon: { kind: 'emoji', value: '📚', color: 'neutral' }
    })
  );
});

test.stable('retains unsaved icon choices across repeated mode clicks and switching modes', () => {
  mount();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconChange' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconSymbols' }));
  test.fireEvent.click(test.screen.getByRole('radio', { name: 'SubjectSymbolAtom' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconSymbols' }));
  test
    .expect(test.screen.getByRole('radio', { name: 'SubjectSymbolAtom' }))
    .toHaveAttribute('aria-checked', 'true');
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconEmojis' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'SubjectIconSymbols' }));
  test
    .expect(test.screen.getByRole('radio', { name: 'SubjectSymbolAtom' }))
    .toHaveAttribute('aria-checked', 'true');
});
