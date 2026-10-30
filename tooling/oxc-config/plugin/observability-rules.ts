import operationConventions from './rules/operation-conventions.ts';
import structuredLogging from './rules/structured-logging.ts';
import workflowBoundary from './rules/workflow-boundary.ts';

export default {
  'operation-conventions': operationConventions,
  'structured-logging': structuredLogging,
  'workflow-boundary': workflowBoundary
};
