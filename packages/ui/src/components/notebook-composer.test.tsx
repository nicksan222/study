import { test } from '@study/testing';

import { NotebookComposer } from './notebook-composer';

test.unit.stable(
  'keeps capture controlled and delegates saving to its owner',
  ({ vi, render, fireEvent, screen, expect }) => {
    const change = vi.fn();
    const submit = vi.fn();

    render(
      <NotebookComposer
        inputId="capture"
        label="Capture"
        hint="Local draft"
        submitLabel="Save"
        value="Initial"
        onChange={change}
        onSubmit={submit}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Capture' }), {
      target: { value: 'Edited' }
    });
    expect(change).toHaveBeenCalledWith('Edited');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(submit).toHaveBeenCalledTimes(1);
  }
);
