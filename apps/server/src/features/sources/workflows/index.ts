/** @file Composes sources workflow definitions and registrations behind the feature boundary. */

export {
  sourceCorrectionHandler,
  sourceCorrectionRegistration,
  sourceCorrectionWorkflow
} from './correction.ts';
export {
  sourceIngestionHandler,
  sourceIngestionRegistration,
  sourceIngestionWorkflow
} from './ingestion.ts';
