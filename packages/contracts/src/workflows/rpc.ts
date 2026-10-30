import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  executionIdSchema,
  executionSchema,
  executionsInputSchema,
  executionsPageSchema,
  cancelExecutionInputSchema
} from './schemas.ts';

export const WorkflowsRpc = RpcGroup.make(
  Rpc.make('execution', {
    payload: { id: executionIdSchema },
    success: executionSchema,
    error: failureSchema
  }),
  Rpc.make('findExecution', {
    payload: { id: executionIdSchema },
    success: Schema.Option(executionSchema),
    error: failureSchema
  }),
  Rpc.make('executions', {
    payload: executionsInputSchema,
    success: executionsPageSchema,
    error: failureSchema
  }),
  Rpc.make('subscribeExecutions', {
    payload: executionsInputSchema,
    success: executionsPageSchema,
    error: failureSchema,
    stream: true
  }),
  Rpc.make('cancelExecution', {
    payload: cancelExecutionInputSchema,
    success: executionSchema,
    error: failureSchema
  })
).prefix('workflows.');
