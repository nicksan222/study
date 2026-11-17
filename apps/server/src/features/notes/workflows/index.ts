/** @file Collects notes workflow registrations and their required execution exports. */

export {
  noteAttachmentWakeHandler,
  noteAttachmentWakeRegistration,
  noteAttachmentWakeWorkflow
} from './attachment-wake.ts';
export { noteDeletionRegistration } from './deletion.ts';
export { noteQuestionRegistration } from './question.ts';
export { noteReplyHandler, noteReplyRegistration, noteReplyWorkflow } from './reply.ts';
export { noteTitleRegistration } from './title.ts';
export { transformSuggestionRegistration } from './transform-suggestion.ts';

export { noteSectionTitleRegistration } from './section-title.ts';
