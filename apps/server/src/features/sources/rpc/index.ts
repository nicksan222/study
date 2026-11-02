/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds the source RPC contract to source service operations and export queries.     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - RPC handlers adapt declared schemas to the owning feature service; transport wiring    │
 * │   stays here.                                                                            │
 * │ - Maps declared operations to the feature service.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Leaves input validation and domain behavior to contracts and service.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { SourcesRpc } from '@study/contracts/sources/rpc';
import { Effect } from 'effect';

import { Sources } from '#server/features/sources/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const SourcesRpcLive = defineRpc(
  SourcesRpc,
  Effect.gen(function* () {
    const sources = yield* Sources;

    return {
      'sources.importCapability': (value) => sources.importCapability(value),
      'sources.sourceExport': ({ id }) => sources.sourceExport(id),
      'sources.source': ({ id }) => sources.source(id),
      'sources.findSource': ({ id }) => sources.findSource(id),
      'sources.sources': (input) => sources.sources(input),
      'sources.sourceProcessing': ({ id }) => sources.sourceProcessing(id),
      'sources.addLink': (input) => sources.addLink(input),
      'sources.createSource': (input) => sources.createSource(input),
      'sources.replaceSource': (input) => sources.replaceSource(input),
      'sources.setSourceProject': (input) => sources.setSourceProject(input),
      'sources.correctBlock': (input) => sources.correctBlock(input),
      'sources.deleteSource': (input) => sources.deleteSource(input),
      'sources.requestSourceProcessing': (input) => sources.requestSourceProcessing(input)
    };
  })
);
