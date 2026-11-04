import type { StaticMessageKey } from '@study/localization';

const workflowLabels: Readonly<Partial<Record<string, StaticMessageKey>>> = {
  'source-ingestion': 'workspace.task.source-ingestion',
  'source-correction': 'workspace.task.source-correction',
  'source-material-projection': 'workspace.task.source-material-projection',
  'document-transform': 'workspace.task.document-transform',
  'material-generation': 'workspace.task.material-generation',
  'conversation-reply': 'workspace.task.conversation-reply',
  'conversation-title': 'workspace.task.conversation-title',
  'conversation-attachment-wake': 'workspace.task.conversation-attachment-wake',
  'recording-post': 'workspace.task.recording-post',
  'quiz-grading': 'workspace.task.quiz-grading',
  'practice-slot': 'workspace.task.practice-slot',
  'practice-failure': 'workspace.task.practice-failure',
  'practice-publication': 'workspace.task.practice-publication',
  'material-history-prune': 'workspace.task.material-history-prune',
  'session-deletion': 'workspace.task.session-deletion',
  'material-deletion': 'workspace.task.material-deletion'
};

export function workflowLabel(workflow: string): StaticMessageKey {
  return workflowLabels[workflow.replace(/\/v[1-9]\d*$/, '')] ?? 'workspace.task.other';
}
