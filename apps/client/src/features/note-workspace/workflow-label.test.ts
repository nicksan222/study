import { test } from '@study/testing';

import { workflowLabel } from './workflow-label';

test.stable('labels versioned workflow identities from the runtime', () => {
  test.expect(workflowLabel('conversation-reply/v1')).toBe('workspace.task.conversation-reply');
  test.expect(workflowLabel('document-transform/v2')).toBe('workspace.task.document-transform');
  test.expect(workflowLabel('unknown/v1')).toBe('workspace.task.other');
});
