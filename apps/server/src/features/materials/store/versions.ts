/** @file Builds materials versions queries and mutations with bound store resources. */

import * as input from '@study/contracts';
import { materialVersionDetailSchema } from '@study/contracts';
import { Option, Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

import { makeGetVersion } from './get-version.ts';
import { makeListVersions } from './list-versions.ts';

export function makeMaterialVersionsStore(resources: StoreResources) {
  const { getVersion } = makeGetVersion(resources);

  const { listVersions } = makeListVersions(resources);

  return {
    queries: {
      materialVersion: storeQuery({
        role: 'required',
        input: input.materialVersionInputSchema,
        output: materialVersionDetailSchema,
        run: (value) => getVersion(value)!
      }),
      findMaterialVersion: storeQuery({
        role: 'optional',
        input: input.materialVersionInputSchema,
        output: Schema.Option(materialVersionDetailSchema),
        run: (value) => Option.fromNullishOr(getVersion(value))
      }),
      materialVersions: storeQuery({
        role: 'collection',
        input: input.materialVersionsInputSchema,
        output: input.materialVersionPageSchema,
        run: listVersions
      })
    },
    mutations: {}
  };
}
