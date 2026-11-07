/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds provider discovery and durable imports to typed RPC contracts.               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Adapts declared integration operations to service calls.                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Transport handlers delegate application policy to the owning integrations service.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { IntegrationsRpc } from '@study/contracts/integrations/rpc';
import { Effect } from 'effect';

import { Integrations } from '#server/features/integrations/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const IntegrationsRpcLive = defineRpc(
  IntegrationsRpc,
  Effect.gen(function* () {
    const integrations = yield* Integrations;

    return {
      'integrations.providers': () => integrations.providers(),
      'integrations.previewImport': (input) => integrations.previewImport(input),
      'integrations.startImport': (input) => integrations.startImport(input),
      'integrations.import': (input) => integrations.import(input),
      'integrations.imports': (input) => integrations.imports(input),
      'integrations.cancelImport': (input) => integrations.cancelImport(input),
      'integrations.retryImport': (input) => integrations.retryImport(input)
    };
  })
);
