import { catalogs } from '@study/localization';
import { test } from '@study/testing';

import { AgentActivityDetails } from './activity-details';

const copy = catalogs.english;

test.unit.stable(
  'terminal runs without model activity explain the empty history',
  async ({ rpc, react, expect }) => {
    rpc.given({ 'workflows.agentProgress': [] });
    const { screen } = react;

    react.render(
      <AgentActivityDetails
        correlationId="completed"
        title="Completed work"
        status="completed"
        open
        onOpenChange={() => {}}
      />
    );
    expect(await screen.findByText(copy.AgentActivityEmpty)).toBeVisible();
    expect(screen.queryByText(copy.AgentActivityWaiting)).not.toBeInTheDocument();
  }
);

test.unit.stable(
  'live runs without recorded activity keep waiting for their first step',
  async ({ rpc, react, expect }) => {
    rpc.given({ 'workflows.agentProgress': [] });
    const { screen } = react;

    react.render(
      <AgentActivityDetails
        correlationId="running"
        title="Active work"
        status="running"
        open
        onOpenChange={() => {}}
      />
    );
    expect(await screen.findByText(copy.AgentActivityWaiting)).toBeVisible();
    expect(screen.queryByText(copy.AgentActivityEmpty)).not.toBeInTheDocument();
  }
);
