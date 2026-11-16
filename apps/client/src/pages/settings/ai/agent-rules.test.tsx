import { agentRulesSchema, defaultAgentRules } from '@study/contracts';
import type { AgentRules } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import { AgentRulesSettings } from './agent-rules';

const api = test.hoisted(() => ({
  read: test.vi.fn<() => Promise<AgentRules>>(),
  save: test.vi.fn<(rules: AgentRules) => Promise<object>>()
}));

test.mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

test.beforeEach(() => {
  test.vi.clearAllMocks();
  api.read.mockResolvedValue(defaultAgentRules);
  api.save.mockResolvedValue({});
});

function mount() {
  const fixture = test.rpcTestTransport(async (tag, input) => {
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

  test.render(<AgentRulesSettings />, { wrapper: fixture.wrapper });

  return fixture;
}

test.stable('keeps drafts when switching tasks and saves all categories explicitly', async () => {
  mount();
  const user = test.userEvent.setup();
  const pages = await test.screen.findByRole('textbox', { name: 'AgentRulesPages' });

  test.expect(pages).toHaveAttribute('maxlength', '8000');
  test.fireEvent.change(pages, { target: { value: 'Use clear headings.' } });
  test.expect(api.save).not.toHaveBeenCalled();
  await user.click(test.screen.getByRole('combobox', { name: 'AgentRulesTask' }));
  await user.click(await test.screen.findByRole('option', { name: 'AgentRulesTitles' }));
  test.fireEvent.change(test.screen.getByRole('textbox', { name: 'AgentRulesTitles' }), {
    target: { value: 'Use short titles.' }
  });
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenCalledExactlyOnceWith({
      ...defaultAgentRules,
      pages: 'Use clear headings.',
      titles: 'Use short titles.'
    })
  );
  test.expect(await test.screen.findByText('AgentRulesSaved')).toBeInTheDocument();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'AgentRulesUseDefault' }));
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  await test.waitFor(() =>
    test.expect(api.save).toHaveBeenLastCalledWith({
      ...defaultAgentRules,
      pages: 'Use clear headings.'
    })
  );
});

test.stable('preserves unsaved text after failure and retries the same change', async () => {
  api.save.mockRejectedValueOnce(new Error('Unavailable'));
  mount();
  const input = await test.screen.findByRole('textbox', { name: 'AgentRulesPages' });

  test.fireEvent.change(input, { target: { value: 'Keep examples.' } });
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  test.expect(await test.screen.findByText('AgentRulesSaveFailed')).toBeInTheDocument();
  test.expect(input).toHaveValue('Keep examples.');
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Save' }));
  test.expect(await test.screen.findByText('AgentRulesSaved')).toBeInTheDocument();
});

test.stable('shows a recoverable load failure without editable defaults', async () => {
  api.read.mockRejectedValueOnce(new Error('Unavailable'));
  mount();
  test.expect(await test.screen.findByText('AgentRulesLoadFailed')).toBeInTheDocument();
  test.expect(test.screen.queryByRole('textbox')).not.toBeInTheDocument();
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
  test.expect(await test.screen.findByRole('textbox', { name: 'AgentRulesPages' })).toBeEnabled();
});
