import { Schema } from 'effect';

import { agentProgressInputSchema, agentProgressPageSchema } from '../ai/progress.ts';
import { failureSchema } from '../errors.ts';
import {
  allDependencies,
  dependency,
  endpointGroup,
  eventStream,
  liveQuery,
  mutation
} from '../protocol.ts';
import {
  executionIdSchema,
  executionSchema,
  executionsInputSchema,
  executionsPageSchema,
  cancelExecutionInputSchema
} from './schemas.ts';

export const workflowsEndpoints = {
  agentProgress: liveQuery(
    'workflows.agentProgress',
    {
      payload: agentProgressInputSchema,
      success: agentProgressPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  subscribeAgentProgress: eventStream('workflows.subscribeAgentProgress', {
    payload: agentProgressInputSchema,
    success: agentProgressPageSchema,
    error: failureSchema
  }),
  execution: liveQuery(
    'workflows.execution',
    {
      payload: { id: executionIdSchema },
      success: executionSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  findExecution: liveQuery(
    'workflows.findExecution',
    {
      payload: { id: executionIdSchema },
      success: Schema.Option(executionSchema),
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  executions: liveQuery(
    'workflows.executions',
    {
      payload: executionsInputSchema,
      success: executionsPageSchema,
      error: failureSchema
    },
    { dependencies: allDependencies, refresh: 'database' }
  ),
  subscribeExecutions: eventStream('workflows.subscribeExecutions', {
    payload: executionsInputSchema,
    success: executionsPageSchema,
    error: failureSchema
  }),
  cancelExecution: mutation(
    'workflows.cancelExecution',
    {
      payload: cancelExecutionInputSchema,
      success: executionSchema,
      error: failureSchema
    },
    { changes: [dependency.workflows] }
  )
};

export const WorkflowsRpc = endpointGroup(workflowsEndpoints);
