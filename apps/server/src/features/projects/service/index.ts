/** @file Composes projects application operations behind the feature boundary. */

import { defineService } from '#server/platform/definitions/define-service';

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
