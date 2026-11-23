import type { recordingSchema } from '../recordings/schemas.ts';
import type { chatMessageSchema, messageVersionSchema } from './schemas.ts';

export type ChatMessage = typeof chatMessageSchema.Type;

export type MessageVersion = typeof messageVersionSchema.Type;

export type Recording = typeof recordingSchema.Type;
