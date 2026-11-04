import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, vi } from 'vite-plus/test';

import { DangerDialog } from './danger-dialog';

const labels = {
  title: 'Delete backup',
  description: 'This permanently removes the selected backup.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
  confirmation: { identity: 'backup-1', value: 'delete', label: 'Type delete to confirm.' }
};

testStable(
  'focuses Cancel, uses alert semantics and leaves confirmation ownership with the caller',
  async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    const change = vi.fn();

    render(<DangerDialog open {...labels} onOpenChange={change} onConfirm={confirm} />);
    const dialog = await screen.findByRole('alertdialog', { name: labels.title });

    expect(dialog).toHaveAccessibleDescription(labels.description);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute(
      'data-variant',
      'destructive'
    );
    const field = screen.getByRole('textbox', { name: 'Type delete to confirm.' });

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).not.toHaveBeenCalled();
    await user.type(field, 'DELETE');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, 'delete');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(change).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
  }
);

testStable(
  'blocks duplicate confirm, Cancel and Escape while the operation is pending',
  async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    const change = vi.fn();

    render(<DangerDialog open pending {...labels} onOpenChange={change} onConfirm={confirm} />);
    const dialog = await screen.findByRole('alertdialog');

    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    await user.keyboard('{Escape}');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(change).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  }
);

testStable(
  'does not dismiss on outside pointer interaction and returns focus after Cancel',
  async () => {
    const user = userEvent.setup();

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

    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });

    await user.click(opener);
    await screen.findByRole('alertdialog');
    const backdrop = document.querySelector('.ui-danger-backdrop')!;

    await user.click(backdrop);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  }
);

testStable(
  'resets exact confirmation when the target, required phrase or open session changes',
  async () => {
    const user = userEvent.setup();
    const confirm = vi.fn();
    const change = vi.fn();
    const view = render(
      <DangerDialog open {...labels} onOpenChange={change} onConfirm={confirm} />
    );

    await user.type(screen.getByRole('textbox'), 'delete');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    view.rerender(
      <DangerDialog
        open
        {...labels}
        confirmation={{ ...labels.confirmation, identity: 'backup-2' }}
        onOpenChange={change}
        onConfirm={confirm}
      />
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'delete');
    view.rerender(
      <DangerDialog
        open
        {...labels}
        confirmation={{ ...labels.confirmation, identity: 'backup-2', value: 'Biology' }}
        onOpenChange={change}
        onConfirm={confirm}
      />
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.type(screen.getByRole('textbox'), 'Biology');
    view.rerender(
      <DangerDialog open={false} {...labels} onOpenChange={change} onConfirm={confirm} />
    );
    view.rerender(<DangerDialog open {...labels} onOpenChange={change} onConfirm={confirm} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(confirm).not.toHaveBeenCalled();
    view.unmount();
    render(<DangerDialog open {...labels} onOpenChange={change} onConfirm={confirm} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  }
);

testStable(
  'does not accept leading or trailing whitespace as the exact confirmation phrase',
  () => {
    const confirm = vi.fn();

    render(<DangerDialog open {...labels} onOpenChange={() => {}} onConfirm={confirm} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'delete ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  }
);

testStable(
  'keeps Cancel focused without scrolling long reviewed content away on open',
  async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');

    render(
      <DangerDialog open {...labels} onOpenChange={() => {}} onConfirm={() => {}}>
        <div style={{ height: 2000 }}>Reviewed content begins here</div>
      </DangerDialog>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(screen.getByRole('heading', { name: labels.title })).toBeVisible();
    expect(screen.getByText(labels.description)).toBeVisible();
  }
);

testStable('review-only dialogs hide typed intent and cannot invoke deletion', async () => {
  const confirm = vi.fn();
  const view = render(
    <DangerDialog open {...labels} confirmation={null} onOpenChange={vi.fn()} onConfirm={confirm} />
  );
  expect(await screen.findByRole('alertdialog')).toBeVisible();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
  view.rerender(<DangerDialog open {...labels} onOpenChange={vi.fn()} onConfirm={confirm} />);
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
});
