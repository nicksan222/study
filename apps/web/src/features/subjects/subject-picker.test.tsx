import { projectSchema } from '@study/contracts/projects/schemas';
import { Sidebar } from '@study/ui/sidebar';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { useState } from 'react';
import { expect, it } from 'vite-plus/test';

import { SubjectIdentity } from './subject-identity';

const subjects = [
  Schema.decodeUnknownSync(projectSchema)({
    id: 1n,
    name: 'Cell Biology',
    icon: 'BIO',
    examOn: null,
    createdAt: 1n,
    updatedAt: 1n
  }),
  Schema.decodeUnknownSync(projectSchema)({
    id: 2n,
    name: 'History of Art',
    icon: null,
    examOn: null,
    createdAt: 1n,
    updatedAt: 1n
  })
];
function Picker() {
  const [value, setValue] = useState(subjects[0]!);
  const [open, setOpen] = useState(false);
  return (
    <Sidebar.Picker
      items={subjects}
      value={value}
      getLabel={(item) => item.name}
      getValue={(item) => String(item.id)}
      getIcon={(item) => <SubjectIdentity name={item.name} icon={item.icon} />}
      onValueChange={setValue}
      open={open}
      onOpenChange={setOpen}
      collapsed={false}
      label="Subject"
      searchLabel="Find subject"
    />
  );
}
it('uses the same custom/automatic identity in the trigger and searchable keyboard picker', async () => {
  const user = userEvent.setup();
  render(<Picker />);
  const trigger = screen.getByRole('combobox', { name: 'Cell Biology' });
  expect(within(trigger).getByText('BIO')).toBeVisible();
  await user.click(trigger);
  await user.type(await screen.findByRole('combobox', { name: 'Find subject' }), 'History');
  const choice = await screen.findByRole('option', { name: 'History of Art' });
  expect(within(choice).getByText('HA')).toBeVisible();
  await user.keyboard('{ArrowDown}{Enter}');
  expect(await screen.findByRole('combobox', { name: 'History of Art' })).toBeVisible();
});
