import { agentRulesSchema } from '@study/contracts/settings/schemas';
import { defaultAgentRules } from '@study/contracts/settings/types';
import type { AgentRules } from '@study/contracts/settings/types';
import { testStable } from '@study/testing/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Schema } from 'effect';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { rpcTestTransport as settingsTransport } from '#client/test/rpc.tsx';

import { AgentRulesSettings } from './agent-rules';

const api = vi.hoisted(() => ({
  read: vi.fn<() => Promise<AgentRules>>(),
  save: vi.fn<(rules: AgentRules) => Promise<object>>()
}));

vi.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(defaultAgentRules);
  api.save.mockResolvedValue({});
});

function mount() {
  const fixture = settingsTransport(async (tag, input) => {
    if (tag === 'settings.agentRules') return api.read();

    if (tag === 'settings.saveAgentRules') {
      const value = Schema.decodeUnknownSync(agentRulesSchema)(input);

      await api.save(value);

      api.read.mockResolvedValue(value);
      await fixture.notify();

      return {};
    }

    throw new Error(`Unexpected endpoint ${tag}`);
  });

  render(<AgentRulesSettings />, { wrapper: fixture.wrapper });

  return fixture;
}

testStable('keeps drafts when switching tasks and saves all categories explicitly', async () => {
  mount();
  const user = userEvent.setup();
  const pages = await screen.findByRole('textbox', { name: 'AgentRulesPages' });

  expect(pages).toHaveAttribute('maxlength', '8000');
  fireEvent.change(pages, { target: { value: 'Use clear headings.' } });
  expect(api.save).not.toHaveBeenCalled();
  await user.click(screen.getByRole('combobox', { name: 'AgentRulesTask' }));
  await user.click(await screen.findByRole('option', { name: 'AgentRulesTitles' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'AgentRulesTitles' }), {
    target: { value: 'Use short titles.' }
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledExactlyOnceWith({
      ...defaultAgentRules,
      pages: 'Use clear headings.',
      titles: 'Use short titles.'
    })
  );
  expect(await screen.findByText('AgentRulesSaved')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'AgentRulesUseDefault' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(api.save).toHaveBeenLastCalledWith({
      ...defaultAgentRules,
      pages: 'Use clear headings.'
    })
  );
});

testStable('preserves unsaved text after failure and retries the same change', async () => {
  api.save.mockRejectedValueOnce(new Error('Unavailable'));
  mount();
  const input = await screen.findByRole('textbox', { name: 'AgentRulesPages' });

  fireEvent.change(input, { target: { value: 'Keep examples.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('AgentRulesSaveFailed')).toBeInTheDocument();
  expect(input).toHaveValue('Keep examples.');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('AgentRulesSaved')).toBeInTheDocument();
});

testStable('shows a recoverable load failure without editable defaults', async () => {
  api.read.mockRejectedValueOnce(new Error('Unavailable'));
  mount();
  expect(await screen.findByText('AgentRulesLoadFailed')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('textbox', { name: 'AgentRulesPages' })).toBeEnabled();
});
