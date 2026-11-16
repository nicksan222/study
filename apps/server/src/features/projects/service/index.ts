/** @file Composes projects application operations behind the feature boundary. */

import { defineService } from '@study/server';

import { projectOperations } from './projects.ts';

export const Projects = defineService(
  'study/Projects',
  function* () {
    return {
      ...(yield* projectOperations())
    };
  },
  {}
);
