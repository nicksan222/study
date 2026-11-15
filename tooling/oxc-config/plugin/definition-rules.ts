import agentDefinition from './rules/agent-definition.ts';
import contractSchema from './rules/contract-schema.ts';
import effectLazyBoundary from './rules/effect-lazy-boundary.ts';
import nativeCombinators from './rules/effect-native-combinators.ts';
import environmentBoundary from './rules/environment-boundary.ts';
import noDoubleAssertion from './rules/no-double-assertion.ts';

export default {
  'effect-native-combinators': nativeCombinators,
  'contract-schema': contractSchema,
  'agent-definition': agentDefinition,
  'no-double-assertion': noDoubleAssertion,
  'effect-lazy-boundary': effectLazyBoundary,
  'environment-boundary': environmentBoundary
};
