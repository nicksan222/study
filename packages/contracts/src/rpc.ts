import { AuthRpc } from './auth/rpc.ts';
import { ConversationsRpc } from './conversations/rpc.ts';
import { DocumentsRpc } from './documents/rpc.ts';
import { IntegrationsRpc } from './integrations/rpc.ts';
import { LearningRpc } from './learning/rpc.ts';
import { MaterialsRpc } from './materials/rpc.ts';
import { ProjectsRpc } from './projects/rpc.ts';
import { RecordingsRpc } from './recordings/rpc.ts';
import { SettingsRpc } from './settings/rpc.ts';
import { SourcesRpc } from './sources/rpc.ts';
import { SystemRpc } from './system/rpc.ts';
import { ThemesRpc } from './themes/rpc.ts';
import { WorkflowsRpc } from './workflows/rpc.ts';

/** The browser-safe application protocol is assembled from explicit feature contracts. */
export const StudyRpc = SourcesRpc.merge(
  IntegrationsRpc,
  MaterialsRpc,
  DocumentsRpc,
  WorkflowsRpc,
  RecordingsRpc,
  ConversationsRpc,
  LearningRpc,
  ProjectsRpc,
  SettingsRpc,
  AuthRpc,
  ThemesRpc,
  SystemRpc
);
