import { test } from '@study/testing';
import { useState } from 'react';

import { DangerDialog } from './danger-dialog';

const labels = {
  title: 'Delete backup',
  description: 'This permanently removes the selected backup.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  confirmation: { identity: 'backup-1', value: 'delete', label: 'Type delete to confirm.' }
};

test.stable(
  'focuses Cancel, uses alert semantics and leaves confirmation ownership with the caller',
  async () => {
    const user = test.userEvent.setup();
    const confirm = test.vi.fn();
    const change = test.vi.fn();

    test.render(<DangerDialog open {...labels} onOpenChange={change} onConfirm={confirm} />);
    const dialog = await test.screen.findByRole('alertdialog', { name: labels.title });

    test.expect(dialog).toHaveAccessibleDescription(labels.description);
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    );
    test.expect(test.screen.queryByRole('button', { name: 'Close' })).toBeNull();
    test
      .expect(test.screen.getByRole('button', { name: 'Delete' }))
      .toHaveAttribute('data-variant', 'destructive');
    const field = test.screen.getByRole('textbox', { name: 'Type delete to confirm.' });

    test.expect(test.screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.click(test.screen.getByRole('button', { name: 'Delete' }));
    test.expect(confirm).not.toHaveBeenCalled();
    await user.type(field, 'DELETE');
    test.expect(test.screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, 'delete');
    await user.click(test.screen.getByRole('button', { name: 'Delete' }));
    test.expect(confirm).toHaveBeenCalledOnce();
    test.expect(change).not.toHaveBeenCalled();
    test.expect(dialog).toBeInTheDocument();
  }
);

test.stable(
  'blocks duplicate confirm, Cancel and Escape while the operation is pending',
  async () => {
    const user = test.userEvent.setup();
    const confirm = test.vi.fn();
    const change = test.vi.fn();

    test.render(
      <DangerDialog open pending {...labels} onOpenChange={change} onConfirm={confirm} />
    );
    const dialog = await test.screen.findByRole('alertdialog');

    test.expect(dialog).toHaveAttribute('aria-busy', 'true');
    test.expect(test.screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    test.expect(test.screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    test.expect(test.screen.getByRole('textbox')).toBeDisabled();
    await user.keyboard('{Escape}');
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Delete' }));
    test.expect(change).not.toHaveBeenCalled();
    test.expect(confirm).not.toHaveBeenCalled();
  }
);

test.stable(
  'does not dismiss on outside pointer interaction and returns focus after Cancel',
  async () => {
    const user = test.userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <DangerDialog open={open} {...labels} onOpenChange={setOpen} onConfirm={() => {}} />
        </>
      );
    }

    test.render(<Harness />);
    const opener = test.screen.getByRole('button', { name: 'Open' });

    await user.click(opener);
    await test.screen.findByRole('alertdialog');
    const backdrop = document.querySelector('.ui-danger-backdrop')!;

    await user.click(backdrop);
    test.expect(test.screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(test.screen.getByRole('button', { name: 'Cancel' }));
    await test.waitFor(() => test.expect(test.screen.queryByRole('alertdialog')).toBeNull());
    await test.waitFor(() => test.expect(opener).toHaveFocus());
  }
);

test.stable(
  'resets exact confirmation when the target, required phrase or open note changes',
  async () => {
    const user = test.userEvent.setup();
    const confirm = test.vi.fn();
    const change = test.vi.fn();
    const view = test.render(
      <DangerDialog open {...labels} onOpenChange={change} onConfirm={confirm} />
    );

    await user.type(test.screen.getByRole('textbox'), 'delete');
    test.expect(test.screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    view.rerender(
      <DangerDialog
        open
        {...labels}
        confirmation={{ ...labels.confirmation, identity: 'backup-2' }}
        onOpenChange={change}
        onConfirm={confirm}
      />
    );
    test.expect(test.screen.getByRole('textbox')).toHaveValue('');
    test.expect(test.screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.type(test.screen.getByRole('textbox'), 'delete');
    view.rerender(
      <DangerDialog
        open
        {...labels}
        confirmation={{ ...labels.confirmation, identity: 'backup-2', value: 'Biology' }}
        onOpenChange={change}
        onConfirm={confirm}
      />
    );
    test.expect(test.screen.getByRole('textbox')).toHaveValue('');
    await user.type(test.screen.getByRole('textbox'), 'Biology');
    view.rerender(
      <DangerDialog open={false} {...labels} onOpenChange={change} onConfirm={confirm} />
    );
    view.rerender(<DangerDialog open {...labels} onOpenChange={change} onConfirm={confirm} />);
    test.expect(test.screen.getByRole('textbox')).toHaveValue('');
    test.expect(confirm).not.toHaveBeenCalled();
    view.unmount();
    test.render(<DangerDialog open {...labels} onOpenChange={change} onConfirm={confirm} />);
    test.expect(test.screen.getByRole('textbox')).toHaveValue('');
  }
);

test.stable(
  'does not accept leading or trailing whitespace as the exact confirmation phrase',
  () => {
    const confirm = test.vi.fn();

    test.render(<DangerDialog open {...labels} onOpenChange={() => {}} onConfirm={confirm} />);
    test.fireEvent.change(test.screen.getByRole('textbox'), { target: { value: 'delete ' } });
    test.fireEvent.click(test.screen.getByRole('button', { name: 'Delete' }));
    test.expect(confirm).not.toHaveBeenCalled();
    test.expect(test.screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  }
);

test.stable(
  'keeps Cancel focused without scrolling long reviewed content away on open',
  async () => {
    const focus = test.vi.spyOn(HTMLElement.prototype, 'focus');

    test.render(
      <DangerDialog open {...labels} onOpenChange={() => {}} onConfirm={() => {}}>
        <div style={{ height: 2000 }}>Reviewed content begins here</div>
      </DangerDialog>
    );
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    );
    test.expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    test.expect(test.screen.getByRole('heading', { name: labels.title })).toBeVisible();
    test.expect(test.screen.getByText(labels.description)).toBeVisible();
  }
);

test.stable('review-only dialogs hide typed intent and cannot invoke deletion', async () => {
  const confirm = test.vi.fn();
  const view = test.render(
    <DangerDialog
      open
      {...labels}
      confirmation={null}
      onOpenChange={test.vi.fn()}
      onConfirm={confirm}
    />
  );

  test.expect(await test.screen.findByRole('alertdialog')).toBeVisible();
  test.expect(test.screen.queryByRole('textbox')).not.toBeInTheDocument();
  test.expect(test.screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  test.expect(confirm).not.toHaveBeenCalled();
  view.rerender(<DangerDialog open {...labels} onOpenChange={test.vi.fn()} onConfirm={confirm} />);
  test.expect(test.screen.getByRole('textbox')).toHaveValue('');
  test.expect(test.screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
});
