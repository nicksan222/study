/** @file Composes learning workflow definitions and registrations behind the feature boundary. */

export { quizGradingHandler, quizGradingRegistration, quizGradingWorkflow } from './grading.ts';
export {
  practiceFailureHandler,
  practiceFailureRegistration,
  practiceFailureWorkflow
} from './practice-failure.ts';
export {
  practicePublicationHandler,
  practicePublicationRegistration,
  practicePublicationWorkflow
} from './practice-publication.ts';
export {
  practiceSlotHandler,
  practiceSlotRegistration,
  practiceSlotWorkflow
} from './practice-slot.ts';
