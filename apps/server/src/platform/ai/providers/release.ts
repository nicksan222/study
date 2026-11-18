/** @file Comparable release information from the provider catalogs. */
import { Schema } from 'effect';

const ordinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const modelReleaseSchema = Schema.Struct({
  provider: Schema.String,
  family: Schema.String,
  model: Schema.String,
  generation: ordinal,
  revision: ordinal
});

export type ModelRelease = typeof modelReleaseSchema.Type;

export interface ModelSelection {
  readonly modelId: string;
  readonly release?: ModelRelease;
}

export function compareModelReleases(
  first: Pick<ModelRelease, 'generation' | 'revision'>,
  second: Pick<ModelRelease, 'generation' | 'revision'>
) {
  return first.generation - second.generation || first.revision - second.revision;
}
