import { agentRulesSchema, defaultAgentRules } from '@study/contracts';
import type { AgentRules } from '@study/contracts';
import { test } from '@study/testing';
import { Schema } from 'effect';

import type * as __StudyMockType0 from '#client/pages/settings/ai/agent-rules.tsx';

function createApi(mock: test.Mock) {
  return {
    read: mock.fn<() => Promise<AgentRules>>(),
    save: mock.fn<(rules: AgentRules) => Promise<object>>()
  };
}

let api: ReturnType<typeof createApi>;

let AgentRulesSettings: typeof __StudyMockType0.AgentRulesSettings;

test.unit.beforeEach(async ({ mock }) => {
  api = createApi(mock);
  mock('#client/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
  const __studyMockModule0 = await import('./agent-rules');

  AgentRulesSettings = __studyMockModule0.AgentRulesSettings;
});

test.unit.beforeEach(({ vi }) => {
  vi.clearAllMocks();
  api.read.mockResolvedValue(defaultAgentRules);
  api.save.mockResolvedValue({});
});

function mount({
  rpcTestTransport,
  render
}: Pick<test.unit.Context, 'rpcTestTransport' | 'render'>) {
  const fixture = rpcTestTransport(async (tag, input) => {
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

test.unit.stable(
  'keeps drafts when switching tasks and automatically saves each category',
  async ({ userEvent, screen, expect, fireEvent, waitFor, rpcTestTransport, render }) => {
    mount({ rpcTestTransport, render });
    const user = userEvent.setup();
    const pages = await screen.findByRole('textbox', { name: 'AgentRulesPages' });

    expect(pages).toHaveAttribute('maxlength', '8000');
    fireEvent.change(pages, { target: { value: 'Use clear headings.' } });

    await user.click(screen.getByRole('combobox', { name: 'AgentRulesTask' }));
    await user.click(await screen.findByRole('option', { name: 'AgentRulesTitles' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'AgentRulesTitles' }), {
      target: { value: 'Use short titles.' }
    });
    await waitFor(() =>
      expect(api.save).toHaveBeenLastCalledWith({
        ...defaultAgentRules,
        pages: 'Use clear headings.',
        titles: 'Use short titles.'
      })
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'AgentRulesUseDefault' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenLastCalledWith({
        ...defaultAgentRules,
        pages: 'Use clear headings.'
      })
    );
  }
);

test.unit.stable(
  'preserves unsaved text after failure and retries the same change',
  async ({ screen, fireEvent, expect, waitFor, rpcTestTransport, render }) => {
    api.save.mockRejectedValueOnce(new Error('Unavailable'));
    mount({ rpcTestTransport, render });
    const input = await screen.findByRole('textbox', { name: 'AgentRulesPages' });

    fireEvent.change(input, { target: { value: 'Keep examples.' } });
    expect(await screen.findByText('AgentRulesSaveFailed')).toBeInTheDocument();
    expect(input).toHaveValue('Keep examples.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('AgentRulesSaveFailed')).toBeNull());
    expect(api.save).toHaveBeenLastCalledWith({ ...defaultAgentRules, pages: 'Keep examples.' });
  }
);

test.unit.stable(
  'shows a recoverable load failure without editable defaults',
  async ({ expect, screen, fireEvent, rpcTestTransport, render }) => {
    api.read.mockRejectedValueOnce(new Error('Unavailable'));
    mount({ rpcTestTransport, render });
    expect(await screen.findByText('AgentRulesLoadFailed')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('textbox', { name: 'AgentRulesPages' })).toBeEnabled();
  }
);
