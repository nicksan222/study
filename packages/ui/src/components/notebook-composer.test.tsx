import { test } from '@study/testing';

import { NotebookComposer } from './notebook-composer';

test.stable('keeps capture controlled and delegates saving to its owner', () => {
  const change = test.vi.fn();
  const submit = test.vi.fn();

  test.render(
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
  test.fireEvent.change(test.screen.getByRole('textbox', { name: 'Capture' }), {
    target: { value: 'Edited' }
  });
  test.expect(change).toHaveBeenCalledWith('Edited');
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  test.expect(submit).toHaveBeenCalledTimes(1);
});
