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

import { Integrations } from '#server/features/integrations/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const IntegrationsRpcLive = defineRpc(
  IntegrationsRpc,
  { integrations: Integrations },
  ({ integrations }) => ({
    'integrations.providers': () => integrations.providers(),
    'integrations.previewImport': integrations.previewImport,
    'integrations.startImport': integrations.startImport,
    'integrations.import': integrations.import,
    'integrations.imports': integrations.imports,
    'integrations.cancelImport': integrations.cancelImport,
    'integrations.retryImport': integrations.retryImport
  })
);
