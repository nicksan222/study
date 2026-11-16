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

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  save = __mockState.save;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./subject-icon-editor');

  SubjectIconEditor = __mockModule0.SubjectIconEditor;
});

test.unit.afterEach(() => save.mockReset());

const project = Schema.decodeUnknownSync(projectSchema)({
  id: 91n,
  name: 'Cell Biology',
  icon: automaticProjectIcon,
  examOn: null,
  createdAt: 1n,
  updatedAt: 1n
});

function mount(
  { rpcTestTransport, render }: Pick<test.unit.Context, 'rpcTestTransport' | 'render'>,
  icon: ProjectIcon = automaticProjectIcon
) {
  const transport = rpcTestTransport(async (tag, input) => {
    if (tag !== 'projects.setIcon') throw new Error(`Unexpected ${tag}`);

    return save(input);
  });

  return render(<SubjectIconEditor project={{ ...project, icon }} />, {
    wrapper: transport.wrapper
  });
}

test.unit.stable(
  'saves a valid custom monogram with exact subject identity, closing the reviewed dialog',
  async ({ fireEvent, screen, expect, waitFor, rpcTestTransport, render }) => {
    save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
    mount({ rpcTestTransport, render });

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

test.unit.stable(
  'restores automatic mode without storing the derived initials',
  async ({ fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    save.mockResolvedValue(project);
    mount({ rpcTestTransport, render }, { kind: 'monogram', value: 'BIO', color: 'neutral' });
    fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
    fireEvent.click(screen.getByRole('button', { name: 'SubjectIconAutomatic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith({ id: project.id, icon: automaticProjectIcon })
    );
  }
);

test.unit.stable(
  'retains custom letters on save failure and allows explicit retry',
  async ({ fireEvent, screen, expect, rpcTestTransport, render }) => {
    save.mockRejectedValue(new Error('offline'));
    mount({ rpcTestTransport, render });
    fireEvent.click(screen.getByRole('button', { name: 'SubjectIconChange' }));
    fireEvent.click(screen.getByRole('button', { name: 'SubjectIconCustom' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'SubjectIconLetters' }), {
      target: { value: 'BIO' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('SubjectIconSaveFailed')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'SubjectIconLetters' })).toHaveValue('BIO');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  }
);

test.unit.stable(
  'saves a searched symbol with its selected color and survives reopening the editor',
  async ({ fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
    const view = mount({ rpcTestTransport, render });

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
    fireEvent.click(await screen.findByRole('button', { name: 'SubjectIconChange' }));
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

test.unit.stable(
  'saves a selected emoji as a typed icon rather than a monogram',
  async ({ fireEvent, screen, waitFor, expect, rpcTestTransport, render }) => {
    save.mockImplementation(async (input) => ({ ...project, icon: input.icon }));
    mount({ rpcTestTransport, render });
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
  }
);

test.unit.stable(
  'retains unsaved icon choices across repeated mode clicks and switching modes',
  ({ fireEvent, screen, expect, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render });
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
  }
);
