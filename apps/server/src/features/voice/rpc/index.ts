/** @file Typed speech transport delegates lifecycle and inference to the feature service. */
import { VoiceRpc } from '@study/contracts';
import { defineRpc } from '@study/server';

import { Voice } from '#server/features/voice/service/index';

export const VoiceRpcLive = defineRpc(VoiceRpc, { voice: Voice }, ({ voice }) => ({
  'voice.status': () => voice.status(),
  'voice.install': () => voice.install(),
  'voice.cancelInstall': () => voice.cancelInstall(),
  'voice.remove': () => voice.remove(),
  'voice.transcribe': voice.transcribe
}));
