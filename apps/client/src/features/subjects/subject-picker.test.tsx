import { projectSchema } from '@study/contracts';
import { test } from '@study/testing';
import { Sidebar } from '@study/ui';
import { Schema } from 'effect';
import { useState } from 'react';

import { SubjectIdentity } from './subject-identity';

const subjects = [
  Schema.decodeUnknownSync(projectSchema)({
    id: 1n,
    name: 'Cell Biology',
    icon: { kind: 'monogram', value: 'BIO', color: 'neutral' },
    examOn: null,
    createdAt: 1n,
    updatedAt: 1n
  }),
  Schema.decodeUnknownSync(projectSchema)({
    id: 2n,
    name: 'History of Art',
    icon: { kind: 'automatic', color: 'neutral' },
    examOn: null,
    createdAt: 1n,
    updatedAt: 1n
  })
];

function subjectIcon(item: (typeof subjects)[number]) {
  return <SubjectIdentity name={item.name} icon={item.icon} />;
}

function Picker() {
  const [value, setValue] = useState(subjects[0]!);
  const [open, setOpen] = useState(false);

  return (
    <Sidebar.Picker
      items={subjects}
      value={value}
      getLabel={(item) => item.name}
      getValue={(item) => String(item.id)}
      getIcon={subjectIcon}
      onValueChange={setValue}
      open={open}
      onOpenChange={setOpen}
      collapsed={false}
      label="Subject"
      searchLabel="Find subject"
    />
  );
}

test.stable(
  'uses the same custom/automatic identity in the trigger and searchable keyboard picker',
  async ({ react, expect, within }) => {
    react.render(<Picker />);
    const trigger = react.screen.getByRole('combobox', { name: 'Cell Biology' });

    expect(within(trigger).getByText('BIO')).toBeVisible();
    await react.user.click(trigger);
    await react.user.type(
      await react.screen.findByRole('combobox', { name: 'Find subject' }),
      'History'
    );
    const choice = await react.screen.findByRole('option', { name: 'History of Art' });

    expect(within(choice).getByText('HA')).toBeVisible();
    await react.user.keyboard('{ArrowDown}{Enter}');
    expect(await react.screen.findByRole('combobox', { name: 'History of Art' })).toBeVisible();
  }
);
