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

import { Sources } from '#server/features/sources/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const SourcesRpcLive = defineRpc(SourcesRpc, { sources: Sources }, ({ sources }) => ({
  'sources.previewHistory': sources.previewHistory,
  'sources.retireHistory': sources.retireHistory,
  'sources.extractions': sources.extractions,
  'sources.exportRevision': sources.exportRevision,
  'sources.currentExtraction': sources.currentExtraction,
  'sources.extraction': sources.extraction,
  'sources.conversionStrategies': () => sources.conversionStrategies(),
  'sources.noteSources': sources.noteSources,
  'sources.attachSource': sources.attachSource,
  'sources.detachSource': sources.detachSource,
  'sources.importCapability': sources.importCapability,
  'sources.sourceExport': ({ id }) => sources.sourceExport(id),
  'sources.source': ({ id }) => sources.source(id),
  'sources.findSource': ({ id }) => sources.findSource(id),
  'sources.sources': sources.sources,
  'sources.sourceProcessing': ({ id }) => sources.sourceProcessing(id),
  'sources.addLink': sources.addLink,
  'sources.createSource': sources.createSource,
  'sources.replaceSource': sources.replaceSource,
  'sources.setSourceProject': sources.setSourceProject,
  'sources.correctBlock': sources.correctBlock,
  'sources.previewDeletion': sources.previewDeletion,
  'sources.deleteSource': sources.deleteSource,
  'sources.requestSourceProcessing': sources.requestSourceProcessing
}));
