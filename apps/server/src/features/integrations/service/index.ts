/** @file Composes integrations application operations behind the feature boundary. */

import { defineService } from '#server/platform/definitions/define-service';

import { integrationImportOperations } from './imports.ts';

export const Integrations = defineService('study/Integrations', function* () {
  return {
    ...(yield* integrationImportOperations())
  };
});
