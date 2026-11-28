import { AgentRule } from '@study/contracts';
import type { AgentRules } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useState } from 'react';

import { useSettingsAutosave } from '#client/lib/settings-autosave.ts';

/** Keeps task drafts until a confirmed save, including across refetches and failed mutations. */
export function useAgentRules(locked?: AgentRule) {
  const query = rpc.settings.agentRules.useQuery({});
  const [active, setSelected] = useState<AgentRule>(AgentRule.Pages);
  const selected = locked ?? active;
  const [draft, setDraft] = useState<Partial<AgentRules>>({});
  const write = rpc.settings.saveAgentRules.useMutation();
  const autosave = useSettingsAutosave(() => rpc.settings.agentRules.read({}), write.mutateAsync);
  const mutation = { ...write, isPending: autosave.pending, isError: autosave.error };
  const confirmed = Object.keys(draft).filter(
    (key) => draft[key as keyof AgentRules] === query.data?.[key as keyof AgentRules]
  );

  if (!autosave.pending && !autosave.error && confirmed.length)
    setDraft((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !confirmed.includes(key)))
    );

  const rules = query.data ? { ...query.data, ...draft } : undefined;
  const changed =
    rules && Object.values(AgentRule).some(({ key }) => rules[key] !== query.data?.[key]);

  return {
    query,
    mutation,
    rules,
    selected,
    changed,
    retry: autosave.retry,
    select: (value: string) => {
      const rule = Object.values(AgentRule).find((rule) => rule.key === value);

      if (rule) setSelected(rule);
    },
    update: (value: string) => {
      setDraft((previous) => ({ ...previous, [selected.key]: value }));

      if (query.data) autosave.update({ [selected.key]: value });
    }
  };
}
