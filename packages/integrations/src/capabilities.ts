/** Independent capabilities keep provider code separate from Study's execution and storage. */
import type {
  integrationInputSchema,
  integrationPlanSchema
} from '@study/contracts/integrations/schemas';
import type { Document } from '@study/contracts/sources/document';

export type ImportCapability = {
  plan(input: typeof integrationInputSchema.Type): typeof integrationPlanSchema.Type;
};

export type ExportCapability = {
  encode(
    input: readonly { key: string; title: string; document: Document }[]
  ): typeof integrationInputSchema.Type;
};

export type IntegrationProvider = {
  readonly id: string;
  readonly capabilities: {
    readonly import?: ImportCapability;
    readonly export?: ExportCapability;
  };
};
