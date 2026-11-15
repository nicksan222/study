import { rpc } from '@study/contracts/react';
import { AgentRule } from '@study/contracts/settings/schemas';
import type { AgentRules } from '@study/contracts/settings/types';
import { useState } from 'react';

/** Keeps task drafts until a confirmed save, including across refetches and failed mutations. */
export function useAgentRules() {
  const query = rpc.settings.agentRules.useQuery({});
  const [selected, setSelected] = useState<AgentRule>(AgentRule.Pages);
  const [draft, setDraft] = useState<Partial<AgentRules>>({});
  const write = rpc.settings.saveAgentRules.useMutation();
  const mutation = {
    ...write,
    mutate: (rules: AgentRules) => {
      void write
        .mutateAsync(rules)
        .then(() => setDraft({}))
        .catch(() => {});
    }
  };
  const rules = query.data ? { ...query.data, ...draft } : undefined;
  const changed =
    rules && Object.values(AgentRule).some(({ key }) => rules[key] !== query.data?.[key]);

  return {
    query,
    mutation,
    rules,
    selected,
    changed,
    select: (value: string) => {
      const rule = Object.values(AgentRule).find((rule) => rule.key === value);

      if (rule) setSelected(rule);
    },
    update: (value: string) => {
      mutation.reset();
      setDraft((previous) => ({ ...previous, [selected.key]: value }));
    }
  };
}
