import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, vi } from 'vite-plus/test';

import { NotebookComposer } from './notebook-composer';

testStable('keeps capture controlled and delegates saving to its owner', () => {
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
});
