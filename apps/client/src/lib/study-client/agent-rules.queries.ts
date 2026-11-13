import type { AgentRules } from '@study/contracts/settings/types';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { request } from '#client/lib/study-client/request.ts';

export const agentRulesOptions = () =>
  queryOptions({
    queryKey: ['agent-rules'],
    queryFn: ({ signal }) => request((client) => client['settings.agentRules']({}), signal)
  });

export const saveAgentRulesOptions = () =>
  mutationOptions({
    mutationFn: (rules: AgentRules) => request((client) => client['settings.saveAgentRules'](rules))
  });
