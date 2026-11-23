import { test } from '@study/testing';
import { useState } from 'react';

import { WorkspacePanel } from './workspace-panel';

test.unit.stable(
  'supports keyboard selection and a separately named close control for each tab',
  async ({ render, screen, userEvent, vi, expect }) => {
    const close = vi.fn();

    function Panel() {
      const [active, setActive] = useState('draft');

      return (
        <WorkspacePanel
          label="Open pages"
          active={active}
          onSelect={setActive}
          tabs={[
            {
              id: 'draft',
              label: 'Draft',
              close: { label: 'Close page', onClick: () => close('draft') }
            },
            {
              id: 'source',
              label: 'Source',
              close: { label: 'Close page', onClick: () => close('source') }
            }
          ]}
          beforeTabs={<button>Back to notebook</button>}
          afterTabs={<button>Expand editor</button>}
        >
          Content for {active}
        </WorkspacePanel>
      );
    }

    const user = userEvent.setup();

    render(<Panel />);
    expect(screen.getByRole('tablist', { name: 'Open pages' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to notebook' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand editor' })).toBeInTheDocument();
    const draft = screen.getByRole('tab', { name: 'Draft', selected: true });

    draft.focus();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('tab', { name: 'Source', selected: true })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Source' })).toHaveTextContent(
      'Content for source'
    );

    const closeSource = screen.getByRole('button', { name: 'Close page', description: 'Source' });

    closeSource.focus();
    await user.keyboard('{Enter}');
    expect(close).toHaveBeenCalledExactlyOnceWith('source');
  }
);
