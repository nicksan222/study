/** @file Owns generation schemas within this feature. */

import type { materialGenerationInputSchema } from '@study/contracts';
import { materialGenerationPayloadSchema } from '@study/contracts';
import { Schema } from 'effect';

export const codec = Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema));

export type Scope = {
  scopeId: string;
  projectId: NonNullable<(typeof materialGenerationInputSchema.Type)['projectId']>;
};
