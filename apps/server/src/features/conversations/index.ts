/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Re-exports the conversation service as the feature’s public entry point.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exposes the service layer while keeping stores and workflow machinery private.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversation persistence remains private to the feature; callers use the service or      │
 * │ typed RPC boundary.                                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export {
  prepareMaterialDeletion,
  scrubMaterialDeletion,
  inspectMaterialDeletion
} from './material-deletion.ts';

export { Conversations } from './service/index.ts';
