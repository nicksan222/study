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

test.beforeEach(async ({ mock }) => {
  const __mockState = createMockState(mock);

  api = __mockState.api;

  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __mockModule0 = await import('./project-settings');

  ProjectSettings = __mockModule0.ProjectSettings;
});

test.beforeEach(() => {
  test.vi.resetAllMocks();
  api.list.mockResolvedValue([first, second]);
});

function mount(initialProject: ProjectId | null = second.id) {
  const harness = test.rpcHandlersTransport({
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
    ...test.render(
      <harness.wrapper>
        <ProjectSettings initialProject={initialProject ?? undefined} />
      </harness.wrapper>
    )
  };
}

test.stable(
  'edits the exact selected subject and refreshes canonical sidebar data after renaming',
  async () => {
    api.rename.mockImplementation(async () => {
      api.list.mockResolvedValue([first, { ...second, name: 'Linear algebra' }]);

      return true;
    });
    mount();
    const name = await test.screen.findByRole('textbox', { name: 'ProjectName' });

    test.expect(name).toHaveValue('Math 101');
    test.fireEvent.change(name, { target: { value: 'Linear algebra' } });
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    );
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
    await test.screen.findAllByText('Linear algebra');
    test
      .expect(api.rename)
      .toHaveBeenCalledExactlyOnceWith({ id: second.id, name: 'Linear algebra' });
    test.expect(name).toHaveValue('Linear algebra');
  }
);

test.stable(
  'keeps unsaved names with their subject when navigating between list and details',
  async () => {
    const user = test.userEvent.setup();

    mount();
    test.fireEvent.change(await test.screen.findByRole('textbox', { name: 'ProjectName' }), {
      target: { value: 'Draft algebra' }
    });
    await user.click(test.screen.getByRole('button', { name: 'Projects' }));
    await user.click(await test.screen.findByRole('button', { name: 'Biology' }));
    test.expect(test.screen.getByRole('textbox', { name: 'ProjectName' })).toHaveValue('Biology');
    await user.click(test.screen.getByRole('button', { name: 'Projects' }));
    await user.click(await test.screen.findByRole('button', { name: 'Math 101' }));
    test
      .expect(test.screen.getByRole('textbox', { name: 'ProjectName' }))
      .toHaveValue('Draft algebra');
  }
);

test.stable('keeps the submitted name available after a failed rename', async () => {
  api.rename.mockRejectedValue(new StudyError('transient', 'Offline'));
  mount();
  test.fireEvent.change(await test.screen.findByRole('textbox', { name: 'ProjectName' }), {
    target: { value: 'Draft algebra' }
  });
  await test.waitFor(() =>
    test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  );
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  await test.screen.findByText('collections.mutationError');
  test
    .expect(test.screen.getByRole('textbox', { name: 'ProjectName' }))
    .toHaveValue('Draft algebra');
  test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

test.stable(
  'opens the icon editor for the selected subject and persists its exact identity',
  async () => {
    api.icon.mockImplementation(async (input) => ({ ...second, icon: input.icon }));
    mount();
    test.fireEvent.click(await test.screen.findByRole('button', { name: 'SubjectIconChange' }));
    const dialog = test.within(
      await test.screen.findByRole('dialog', { name: 'SubjectIconTitle' })
    );

    test.fireEvent.click(dialog.getByRole('button', { name: 'SubjectIconCustom' }));
    test.fireEvent.change(dialog.getByRole('textbox', { name: 'SubjectIconLetters' }), {
      target: { value: 'LA' }
    });
    test.fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
    await test.waitFor(() =>
      test.expect(api.icon).toHaveBeenCalledExactlyOnceWith({
        id: second.id,
        icon: { kind: 'monogram', value: 'LA', color: 'neutral' }
      })
    );
  }
);

test.stable('requires exact-name confirmation and removes only the selected subject', async () => {
  api.remove.mockImplementation(async () => {
    api.list.mockResolvedValue([first]);

    return true;
  });
  mount();
  test.fireEvent.click(await test.screen.findByRole('button', { name: 'ProjectSettingsDelete' }));
  const dialog = test.within(test.screen.getByRole('alertdialog'));

  test.expect(dialog.getByRole('button', { name: 'ProjectSettingsDelete' })).toBeDisabled();
  test.fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'Math 101' } });
  test.fireEvent.click(dialog.getByRole('button', { name: 'ProjectSettingsDelete' }));
  await test.waitFor(() =>
    test.expect(api.remove).toHaveBeenCalledExactlyOnceWith({ id: second.id })
  );
  await test.waitFor(() =>
    test.expect(test.screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  );
  test.expect(await test.screen.findByRole('button', { name: 'Biology' })).toBeVisible();
  test.expect(test.screen.queryByRole('button', { name: 'Math 101' })).not.toBeInTheDocument();
});

test.stable(
  'shows a useful empty state without editable fields when no subjects exist',
  async () => {
    api.list.mockResolvedValue([]);
    mount();
    test.expect(await test.screen.findByText('NoProjectsYet')).toBeVisible();
    test
      .expect(test.screen.queryByRole('textbox', { name: 'ProjectName' }))
      .not.toBeInTheDocument();
  }
);

test.stable('opens the subjects index first and drills into the chosen subject', async () => {
  mount(null);
  test.expect(await test.screen.findByRole('button', { name: 'Biology' })).toBeVisible();
  test.expect(test.screen.getByRole('button', { name: 'Math 101' })).toBeVisible();
  test.expect(test.screen.queryByRole('textbox', { name: 'ProjectName' })).not.toBeInTheDocument();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Biology' }));
  test
    .expect(await test.screen.findByRole('textbox', { name: 'ProjectName' }))
    .toHaveValue('Biology');
});
