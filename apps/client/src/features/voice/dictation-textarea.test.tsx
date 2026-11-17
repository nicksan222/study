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

    expect(input.closest('label')?.querySelector('button')).toBeNull();
    await userEvent.click(screen.getByText('Annotation text', { exact: true }));
    expect(input).toHaveFocus();
  }
);
