import { Schema } from 'effect';

export const promptInputSchema = Schema.Struct({ prompt: Schema.String });

export const textOutputSchema = Schema.String;
