import { test } from '@study/testing';

import { DictationTextarea } from './dictation-textarea';

test.unit.stable(
  'keeps dictation actions outside the text field label and preserves label focus',
  async ({ react, rpc, screen, userEvent, expect }) => {
    rpc.givenWorkspace();
    react.render(
      <DictationTextarea label="Annotation text" value="Draft" onValueChange={() => {}} />
    );
    const input = screen.getByRole('textbox', { name: 'Annotation text' });
    const trigger = screen.getByRole('button');

    expect(input.closest('label')).not.toContainElement(trigger);
    await userEvent.click(screen.getByText('Annotation text', { exact: true }));
    expect(input).toHaveFocus();
  }
);
