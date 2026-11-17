import { AuthRpc, authEndpoints } from './auth/rpc.ts';
import { IntegrationsRpc, integrationsEndpoints } from './integrations/rpc.ts';
import { LearningRpc, learningEndpoints } from './learning/rpc.ts';
import { MaterialsRpc, materialsEndpoints } from './materials/rpc.ts';
import { NotesRpc, notesEndpoints } from './notes/rpc.ts';
import { PagesRpc, pagesEndpoints } from './pages/rpc.ts';
import { ProjectsRpc, projectsEndpoints } from './projects/rpc.ts';
import { RecordingsRpc, recordingsEndpoints } from './recordings/rpc.ts';
import { SettingsRpc, settingsEndpoints } from './settings/rpc.ts';
import { SourcesRpc, sourcesEndpoints } from './sources/rpc.ts';
import { SystemRpc, systemEndpoints } from './system/rpc.ts';
import { ThemesRpc, themesEndpoints } from './themes/rpc.ts';
import { VoiceRpc, voiceEndpoints } from './voice/rpc.ts';
import { WorkflowsRpc, workflowsEndpoints } from './workflows/rpc.ts';

/** The browser-safe application protocol is assembled from explicit feature contracts. */
export const StudyRpc = SourcesRpc.merge(
  IntegrationsRpc,
  MaterialsRpc,
  PagesRpc,
  WorkflowsRpc,
  RecordingsRpc,
  NotesRpc,
  LearningRpc,
  ProjectsRpc,
  SettingsRpc,
  AuthRpc,
  ThemesRpc,
  SystemRpc,
  VoiceRpc
);

/** Canonical endpoint inventory; the optional React facade is derived from these declarations. */
export const endpoints = {
  voice: voiceEndpoints,
  auth: authEndpoints,
  integrations: integrationsEndpoints,
  learning: learningEndpoints,
  materials: materialsEndpoints,
  notes: notesEndpoints,
  pages: pagesEndpoints,
  projects: projectsEndpoints,
  recordings: recordingsEndpoints,
  settings: settingsEndpoints,
  sources: sourcesEndpoints,
  system: systemEndpoints,
  themes: themesEndpoints,
  workflows: workflowsEndpoints
};
