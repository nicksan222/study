import { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import { projectSchema } from '@study/contracts/projects/schemas';
import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { ProjectSettings } from './project-settings';

const api = vi.hoisted(() => ({ list: vi.fn(), rename: vi.fn(), remove: vi.fn(), icon: vi.fn() }));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

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

beforeEach(() => {
  vi.resetAllMocks();
  api.list.mockResolvedValue([first, second]);
});

function mount(initialProject: ProjectId | null = second.id) {
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

testStable(
  'edits the exact selected subject and refreshes canonical sidebar data after renaming',
  async () => {
    api.rename.mockImplementation(async () => {
      api.list.mockResolvedValue([first, { ...second, name: 'Linear algebra' }]);

      return true;
    });
    mount();
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

testStable(
  'keeps unsaved names with their subject when navigating between list and details',
  async () => {
    const user = userEvent.setup();

    mount();
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

testStable('keeps the submitted name available after a failed rename', async () => {
  api.rename.mockRejectedValue(new StudyError('transient', 'Offline'));
  mount();
  fireEvent.change(await screen.findByRole('textbox', { name: 'ProjectName' }), {
    target: { value: 'Draft algebra' }
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('collections.mutationError');
  expect(screen.getByRole('textbox', { name: 'ProjectName' })).toHaveValue('Draft algebra');
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});

testStable(
  'opens the icon editor for the selected subject and persists its exact identity',
  async () => {
    api.icon.mockImplementation(async (input) => ({ ...second, icon: input.icon }));
    mount();
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

testStable('requires exact-name confirmation and removes only the selected subject', async () => {
  api.remove.mockImplementation(async () => {
    api.list.mockResolvedValue([first]);

    return true;
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'ProjectSettingsDelete' }));
  const dialog = within(screen.getByRole('alertdialog'));

  expect(dialog.getByRole('button', { name: 'ProjectSettingsDelete' })).toBeDisabled();
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'Math 101' } });
  fireEvent.click(dialog.getByRole('button', { name: 'ProjectSettingsDelete' }));
  await waitFor(() => expect(api.remove).toHaveBeenCalledExactlyOnceWith({ id: second.id }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(await screen.findByRole('button', { name: 'Biology' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Math 101' })).not.toBeInTheDocument();
});

testStable(
  'shows a useful empty state without editable fields when no subjects exist',
  async () => {
    api.list.mockResolvedValue([]);
    mount();
    expect(await screen.findByText('NoProjectsYet')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'ProjectName' })).not.toBeInTheDocument();
  }
);

testStable('opens the subjects index first and drills into the chosen subject', async () => {
  mount(null);
  expect(await screen.findByRole('button', { name: 'Biology' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Math 101' })).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'ProjectName' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Biology' }));
  expect(await screen.findByRole('textbox', { name: 'ProjectName' })).toHaveValue('Biology');
});
