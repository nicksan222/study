import type { sessionSchema, titleSourceSchema } from './schemas.ts';

export type TitleSource = typeof titleSourceSchema.Type;

export type ChatSession = typeof sessionSchema.Type;
