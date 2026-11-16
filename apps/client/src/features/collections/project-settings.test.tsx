import { StudyError, projectSchema } from '@study/contracts';
import type { ProjectId } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __MockType0 from './project-settings';

let ProjectSettings: typeof __MockType0.ProjectSettings;

let api: ReturnType<typeof createMockState>['api'];

const first = Schema.decodeUnknownSync(projectSchema)({
  id: 9007199254740993n,
  name: 'Biology',
  icon: { kind: 'automatic', color: 'neutral' },
  examOn: null,
  createdAt: 1n,
  updatedAt: 1n
});

const second = {
  ...first,
  id: Schema.decodeUnknownSync(projectSchema)({ ...first, id: 92n }).id,
  name: 'Math 101'
};

function createMockState(mock: test.Mock) {
  return {
    api: (() => ({
      list: mock.fn(),
      rename: mock.fn(),
      remove: mock.fn(),
      icon: mock.fn()
    }))()
  };
}

test.unit.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./project-settings');

  ProjectSettings = __mockModule0.ProjectSettings;
});

test.unit.beforeEach(({ vi }) => {
  vi.resetAllMocks();
  api.list.mockResolvedValue([first, second]);
});

function mount(
  { rpcHandlersTransport, render }: Pick<test.unit.Context, 'rpcHandlersTransport' | 'render'>,
  initialProject: ProjectId | null = second.id
) {
  const harness = rpcHandlersTransport({
    'projects.projects': async () => ({ items: await api.list(), next: null }),
    'projects.project': async ({ id }) => {
      const items = await api.list();
      const item = items.find((value: typeof first) => value.id === id);

      if (!item) throw new StudyError('not_found', 'Subject unavailable');

      return item;
    },
    'projects.renameProject': api.rename,
    'projects.deleteProject': api.remove,
    'projects.setIcon': api.icon
  });

  return {
    ...render(
      <harness.wrapper>
        <ProjectSettings initialProject={initialProject ?? undefined} />
      </harness.wrapper>
    )
  };
}

test.unit.stable(
  'edits the exact selected subject and refreshes canonical sidebar data after renaming',
  async ({ screen, expect, fireEvent, waitFor, rpcHandlersTransport, render }) => {
    api.rename.mockImplementation(async () => {
      api.list.mockResolvedValue([first, { ...second, name: 'Linear algebra' }]);

      return true;
    });
    mount({ rpcHandlersTransport, render });
    const name = await screen.findByRole('textbox', { name: 'ProjectName' });

    expect(name).toHaveValue('Math 101');
    fireEvent.change(name, { target: { value: 'Linear algebra' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findAllByText('Linear algebra');
    expect(api.rename).toHaveBeenCalledExactlyOnceWith({ id: second.id, name: 'Linear algebra' });
    expect(name).toHaveValue('Linear algebra');
  }
);

test.unit.stable(
  'keeps unsaved names with their subject when navigating between list and details',
  async ({ userEvent, fireEvent, screen, expect, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();

    mount({ rpcHandlersTransport, render });
    fireEvent.change(await screen.findByRole('textbox', { name: 'ProjectName' }), {
      target: { value: 'Draft algebra' }
    });
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: 'Biology' }));
    expect(screen.getByRole('textbox', { name: 'ProjectName' })).toHaveValue('Biology');
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: 'Math 101' }));
    expect(screen.getByRole('textbox', { name: 'ProjectName' })).toHaveValue('Draft algebra');
  }
);

test.unit.stable(
  'keeps the submitted name available after a failed rename',
  async ({ fireEvent, screen, waitFor, expect, rpcHandlersTransport, render }) => {
    api.rename.mockRejectedValue(new StudyError('transient', 'Offline'));
    mount({ rpcHandlersTransport, render });
    fireEvent.change(await screen.findByRole('textbox', { name: 'ProjectName' }), {
      target: { value: 'Draft algebra' }
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('collections.mutationError');
    expect(screen.getByRole('textbox', { name: 'ProjectName' })).toHaveValue('Draft algebra');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  }
);

test.unit.stable(
  'opens the icon editor for the selected subject and persists its exact identity',
  async ({ fireEvent, screen, within, waitFor, expect, rpcHandlersTransport, render }) => {
    api.icon.mockImplementation(async (input) => ({ ...second, icon: input.icon }));
    mount({ rpcHandlersTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'SubjectIconChange' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'SubjectIconTitle' }));

    fireEvent.click(dialog.getByRole('button', { name: 'SubjectIconCustom' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'SubjectIconLetters' }), {
      target: { value: 'LA' }
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.icon).toHaveBeenCalledExactlyOnceWith({
        id: second.id,
        icon: { kind: 'monogram', value: 'LA', color: 'neutral' }
      })
    );
  }
);

test.unit.stable(
  'requires exact-name confirmation and removes only the selected subject',
  async ({ fireEvent, screen, within, expect, waitFor, rpcHandlersTransport, render }) => {
    api.remove.mockImplementation(async () => {
      api.list.mockResolvedValue([first]);

      return true;
    });
    mount({ rpcHandlersTransport, render });
    fireEvent.click(await screen.findByRole('button', { name: 'ProjectSettingsDelete' }));
    const dialog = within(screen.getByRole('alertdialog'));

    expect(dialog.getByRole('button', { name: 'ProjectSettingsDelete' })).toBeDisabled();
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'Math 101' } });
    fireEvent.click(dialog.getByRole('button', { name: 'ProjectSettingsDelete' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledExactlyOnceWith({ id: second.id }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Biology' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Math 101' })).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'shows a useful empty state without editable fields when no subjects exist',
  async ({ expect, screen, rpcHandlersTransport, render }) => {
    api.list.mockResolvedValue([]);
    mount({ rpcHandlersTransport, render });
    expect(await screen.findByText('NoProjectsYet')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'ProjectName' })).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'opens the subjects index first and drills into the chosen subject',
  async ({ expect, screen, fireEvent, rpcHandlersTransport, render }) => {
    mount({ rpcHandlersTransport, render }, null);
    expect(await screen.findByRole('button', { name: 'Biology' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Math 101' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'ProjectName' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Biology' }));
    expect(await screen.findByRole('textbox', { name: 'ProjectName' })).toHaveValue('Biology');
  }
);
