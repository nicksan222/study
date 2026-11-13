import { AgentRule } from '@study/contracts/settings/schemas';
import type { AgentRules } from '@study/contracts/settings/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  agentRulesOptions,
  saveAgentRulesOptions
} from '#client/lib/study-client/agent-rules.queries.ts';

/** Keeps task drafts until a confirmed save, including across refetches and failed mutations. */
export function useAgentRules() {
  const client = useQueryClient();
  const query = useQuery(agentRulesOptions());
  const [selected, setSelected] = useState<AgentRule>(AgentRule.Pages);
  const [draft, setDraft] = useState<Partial<AgentRules>>({});
  const mutation = useMutation({
    ...saveAgentRulesOptions(),
    onSuccess: (_, saved) => {
      client.setQueryData(agentRulesOptions().queryKey, saved);
      setDraft({});
    }
  });
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
