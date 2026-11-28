/** @file Composes integrations application operations behind the feature boundary. */

import { defineService } from '@study/server';

import { integrationImportOperations } from './imports.ts';

export const Integrations = defineService('study/Integrations', integrationImportOperations);
